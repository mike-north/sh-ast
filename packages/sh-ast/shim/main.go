//go:build js && wasm

// sh-ast shim: parses shell source with mvdan/sh and returns a
// typedjson-encoded AST.
//
// The whole result envelope — including any error message — is marshaled with
// Go's encoding/json, not a hand-rolled string escaper. A hand-rolled escaper
// that only handles `"`, `\`, and `\n` corrupts any other JSON-significant
// byte (e.g. other control characters) that shows up in a parse error
// message; encoding/json.Marshal escapes the full JSON string grammar
// correctly. This is the fix for the spike's escaper bug.
//
// # ABI: linear-memory exports, not syscall/js
//
// The shim exposes three WASM exports — alloc/process/free — instead of
// registering a syscall/js global function. syscall/js's js.FuncOf callback
// marshals every string argument and the JSON return value through
// wasm_exec.js's reflective JS<->Go value bridge, which dominates the parse
// cost for anything but tiny input (measured: 280 ms of a ~300 ms warm parse
// for a 700-line fixture, see design/ARCHITECTURE.md's "Performance"). The
// linear-memory ABI instead lets the JS side write UTF-8 bytes directly into
// WASM memory and read the result back with a single `TextDecoder.decode`
// call — no per-character JS<->Go marshaling.
//
// `alloc`/`free` reserve and release buffers in WASM linear memory; `process`
// takes three (pointer, length) pairs — decomposed automatically by the
// go:wasmexport ABI from ordinary Go `string` parameters, since a `string`
// argument to a wasmexport function is passed as (ptr, len) directly
// referencing caller-supplied memory (see
// https://pkg.go.dev/cmd/compile#hdr-WebAssembly_Export, "go:wasmexport") —
// and returns a pointer to a NUL-terminated JSON buffer. `pinned` keeps every
// buffer crossing the boundary reachable from a GC root: the JS side holds a
// raw linear-memory offset, which is invisible to Go's garbage collector, so
// without `pinned` a collection between `alloc` and the buffer's last use
// could free memory JS still intends to read from or write into.
//
// # AST encoding: internal/nodeencode, not typedjson directly
//
// The successful-parse path encodes with this package's own
// internal/nodeencode.Encode rather than calling
// mvdan.cc/sh/v3/syntax/typedjson.Encode directly. nodeencode is a
// performance fork of typedjson's encode path — see its package doc comment
// for the measured reason (typedjson's reflection-based encoder rebuilds an
// identical synthetic struct type per node *instance*; nodeencode caches it
// per node *type*, cutting a 700-line fixture's encode time roughly 5x) —
// verified to produce byte-identical output to typedjson.Encode in
// internal/nodeencode/encode_test.go.
package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"sync"
	"unsafe"

	"mvdan.cc/sh/v3/syntax"

	"eslint-sh-shim/internal/nodeencode"
)

// parseErrorInfo carries a structured parse failure: the message mvdan
// produced plus the exact position it reported (byte offset and 1-based
// line/column), so the JS side can build ShParseError with real positions
// instead of 1:1 placeholders.
type parseErrorInfo struct {
	Message  string `json:"message"`
	Filename string `json:"filename"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Offset   int    `json:"offset"`
}

// errorInfo carries a non-positional failure — e.g. an unrecognized dialect
// name passed to LangVariant.Set — which has no source position to report.
type errorInfo struct {
	Message string `json:"message"`
}

// resultEnvelope is the single JSON document returned per parse call. Exactly
// one of File, ParseError, or Error is populated.
type resultEnvelope struct {
	File       json.RawMessage `json:"file,omitempty"`
	ParseError *parseErrorInfo `json:"parseError,omitempty"`
	Error      *errorInfo      `json:"error,omitempty"`
}

// toParseErrorInfo extracts filename/line/column/offset from the mvdan error
// types that carry a source position. Errors without a position (e.g. an
// invalid LangVariant name) fall through to the generic errorInfo path.
func toParseErrorInfo(err error) *parseErrorInfo {
	switch e := err.(type) {
	case syntax.ParseError:
		return &parseErrorInfo{
			Message:  e.Error(),
			Filename: e.Filename,
			Line:     int(e.Pos.Line()),
			Column:   int(e.Pos.Col()),
			Offset:   int(e.Pos.Offset()),
		}
	case syntax.LangError:
		return &parseErrorInfo{
			Message:  e.Error(),
			Filename: e.Filename,
			Line:     int(e.Pos.Line()),
			Column:   int(e.Pos.Col()),
			Offset:   int(e.Pos.Offset()),
		}
	default:
		return nil
	}
}

// pinned keeps every buffer handed across the WASM boundary — both the input
// buffers `alloc` reserves for the JS side to fill, and the output buffer
// `process` allocates for its JSON result — reachable from a GC root by
// pointer, keyed by that pointer's linear-memory address. JS's `free` call
// deletes the entry once it has finished reading (for `process`'s result) or
// writing (for an `alloc`ed input) the buffer, letting the GC reclaim it.
var (
	pinnedMu sync.Mutex
	pinned   = map[uintptr][]byte{}
)

func pin(buf []byte) uintptr {
	ptr := uintptr(unsafe.Pointer(&buf[0]))
	pinnedMu.Lock()
	pinned[ptr] = buf
	pinnedMu.Unlock()
	return ptr
}

// alloc reserves a buffer of size bytes in WASM linear memory for the JS side
// to write into (e.g. a UTF-8-encoded string argument to process), and
// returns its address. size 0 is rounded up to 1 so `&buf[0]` never indexes
// an empty slice; callers only ever read/write the byte count they asked
// for, so the one padding byte is never observed.
//
//go:wasmexport alloc
func alloc(size int32) uintptr {
	n := int(size)
	if n < 1 {
		n = 1
	}
	return pin(make([]byte, n))
}

// free releases a buffer previously returned by alloc or process, letting the
// GC reclaim it. A pointer not present in pinned (already freed, or never
// pinned) is a no-op rather than a panic — the JS wrapper always frees its
// three input buffers and the result buffer exactly once per call, but a
// defensive double-free must not wedge the shared instance.
//
//go:wasmexport free
func free(ptr uintptr) {
	pinnedMu.Lock()
	delete(pinned, ptr)
	pinnedMu.Unlock()
}

// encodeResult marshals env, appends a NUL sentinel (valid JSON from
// encoding/json never contains a raw 0x00 byte — every control character is
// \u escaped — so the JS side can find the end of the buffer without a
// separate length channel, exactly as sh-syntax's own `process` export
// does), pins the buffer, and returns its address. Used for the
// error/parseError paths, which are small and rare — correctness-obvious
// encoding/json.Marshal is worth more here than the couple of
// microseconds a hand-rolled encoder would save.
func encodeResult(env resultEnvelope) uintptr {
	out, err := json.Marshal(env)
	if err != nil {
		// Marshaling our own struct should never fail; surface it plainly
		// rather than returning malformed JSON to the JS side.
		out, _ = json.Marshal(resultEnvelope{Error: &errorInfo{Message: err.Error()}})
	}
	out = append(out, 0)
	return pin(out)
}

// encodeFileResult wraps an already-encoded nodeencode.Encode buffer as
// `{"file":<buf>}` by byte concatenation instead of round-tripping it
// through encoding/json.Marshal(resultEnvelope{File: json.RawMessage(...)}) —
// which re-validates and re-copies the whole (often ~900 KB) buffer via
// json.Compact, measured at ~9 ms of a ~30 ms total warm parse for a
// 700-line fixture, a bigger share once nodeencode's own caching brought the
// rest of the call down. buf must be exactly what nodeencode.Encode wrote:
// a JSON object (`{...}`) followed by json.Encoder's trailing newline, which
// this function overwrites with the envelope's closing brace.
func encodeFileResult(buf *bytes.Buffer) uintptr {
	out := buf.Bytes()
	if len(out) == 0 || out[len(out)-1] != '\n' {
		// Should never happen — nodeencode.Encode always uses
		// json.Encoder.Encode, which always appends exactly one trailing
		// newline. Fall back to the safe, general-purpose path rather than
		// silently emitting a malformed envelope.
		return encodeResult(resultEnvelope{File: json.RawMessage(append([]byte(nil), out...))})
	}
	envelope := make([]byte, 0, len(out)+len(`{"file":`))
	envelope = append(envelope, []byte(`{"file":`)...)
	envelope = append(envelope, out[:len(out)-1]...)
	envelope = append(envelope, '}')
	envelope = append(envelope, 0)
	return pin(envelope)
}

// process parses text as dialect (mvdan/sh's LangVariant string name) and
// returns a pointer to a NUL-terminated JSON resultEnvelope. text, dialect,
// and filename each arrive as a native Go string whose backing bytes live in
// a buffer the JS side previously reserved via alloc and wrote into
// directly — the go:wasmexport ABI decomposes each string parameter into a
// (pointer, length) pair at the WASM function-signature level, so there is
// no additional Go-side copy of the argument bytes.
//
//go:wasmexport process
func process(text string, dialect string, filename string) uintptr {
	var variant syntax.LangVariant
	if err := variant.Set(dialect); err != nil {
		return encodeResult(resultEnvelope{Error: &errorInfo{Message: err.Error()}})
	}

	parser := syntax.NewParser(syntax.KeepComments(true), syntax.Variant(variant))
	file, err := parser.Parse(strings.NewReader(text), filename)
	if err != nil {
		if info := toParseErrorInfo(err); info != nil {
			return encodeResult(resultEnvelope{ParseError: info})
		}
		return encodeResult(resultEnvelope{Error: &errorInfo{Message: err.Error()}})
	}

	var buf bytes.Buffer
	if err := nodeencode.Encode(&buf, file); err != nil {
		return encodeResult(resultEnvelope{Error: &errorInfo{Message: err.Error()}})
	}
	return encodeFileResult(&buf)
}

func main() {
	// Nothing to schedule: `alloc`/`process`/`free` are called directly as
	// WASM exports and need no running Go goroutine to service them. The
	// empty select still keeps the Go runtime's scheduler alive for the
	// lifetime of the instance rather than letting `main` return — matching
	// every other long-lived Go/WASM module (including the previous
	// syscall/js version of this shim) and avoiding relying on
	// exported-function calls continuing to work after `main` exits, which
	// is unspecified for the js/wasm runtime.
	select {}
}
