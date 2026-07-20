import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../shim/wasm_exec.js';
// Type-only side-effect import: pulls `wasm-globals.d.ts`'s `declare global`
// augmentation (the `Go` constructor) into any program that includes this
// file, even for tools (e.g. tsd) that compute their own root-file set from
// import graphs rather than directory globbing.
import type {} from './wasm-globals.js';
import { ShInternalError } from './errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// `shim/` is a sibling of both `src/` (test-time) and `dist/` (build-time).
const wasmPath = path.join(here, '..', 'shim', 'sh-ast.wasm');

/**
 * The shim's linear-memory ABI (see `shim/main.go`'s module doc): `alloc`
 * reserves a buffer of the given byte length and returns its address;
 * `process` takes three (pointer, length) pairs — Go's `go:wasmexport`
 * decomposes each `string` parameter into one automatically — and returns
 * the address of a NUL-terminated JSON result buffer; `free` releases a
 * buffer previously returned by `alloc` or `process`. `mem` is Go's
 * wasm/js linear memory export (always named `mem`, not `memory`).
 *
 * @internal
 */
interface ShimExports {
  mem: WebAssembly.Memory;
  alloc: (size: number) => number;
  free: (ptr: number) => void;
  process: (
    textPtr: number,
    textLen: number,
    dialectPtr: number,
    dialectLen: number,
    filenamePtr: number,
    filenameLen: number,
  ) => number;
}

function isShimExports(value: WebAssembly.Exports): value is WebAssembly.Exports & ShimExports {
  const candidate = value as Partial<ShimExports>;
  return (
    candidate.mem instanceof WebAssembly.Memory &&
    typeof candidate.alloc === 'function' &&
    typeof candidate.free === 'function' &&
    typeof candidate.process === 'function'
  );
}

let wasmModule: WebAssembly.Module | undefined;
let shimExports: ShimExports | undefined;

/**
 * Instantiates the WASM shim synchronously in Node, exactly once, and
 * reuses the instance across parses (see design/ARCHITECTURE.md,
 * "Synchronous parse: solved, two mechanisms"). Node imposes no size limit
 * on synchronous `WebAssembly.Module` compilation — that restriction is
 * browser-main-thread-only.
 */
function ensureInstance(): ShimExports {
  if (shimExports) return shimExports;
  wasmModule ??= new WebAssembly.Module(fs.readFileSync(wasmPath));
  const go = new Go();
  const instance = new WebAssembly.Instance(wasmModule, go.importObject);
  void go.run(instance);
  if (!isShimExports(instance.exports)) {
    throw new ShInternalError(
      'bridge: WASM shim did not export the expected alloc/process/free/mem linear-memory ABI',
    );
  }
  shimExports = instance.exports;
  return shimExports;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Writes `text` (UTF-8 encoded) into a freshly `alloc`ed buffer and returns
 * its (pointer, length). The caller owns the buffer and must `free` it once
 * `process` has consumed it.
 */
function writeString(exports: ShimExports, text: string): { ptr: number; len: number } {
  const bytes = encoder.encode(text);
  const ptr = exports.alloc(bytes.length);
  // `exports.mem.buffer` is re-read here rather than cached across calls:
  // a Go-side allocation can grow WASM linear memory, which detaches any
  // previously created `ArrayBuffer` view (see `callParse` below for the
  // same reasoning on the read side).
  new Uint8Array(exports.mem.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

/**
 * Calls into the WASM shim's `process` export, instantiating the shim on
 * first use. Encodes `text`/`dialect`/`filename` into shim-owned linear
 * memory, reads the NUL-terminated JSON result back via `TextDecoder`
 * (rather than syscall/js's `js.ValueOf(string)`, which dominated the parse
 * cost — see design/ARCHITECTURE.md's "Performance"), and frees every buffer
 * the call allocated.
 *
 * @internal
 */
export function callParse(text: string, dialect: string, filename: string): string {
  const exports = ensureInstance();
  const t = writeString(exports, text);
  const d = writeString(exports, dialect);
  const f = writeString(exports, filename);
  const resultPtr = exports.process(t.ptr, t.len, d.ptr, d.len, f.ptr, f.len);
  exports.free(t.ptr);
  exports.free(d.ptr);
  exports.free(f.ptr);

  if (resultPtr === 0) {
    throw new ShInternalError('bridge: WASM shim returned a null result pointer');
  }

  // Re-read `mem.buffer` fresh (see `writeString`'s comment) and scan for the
  // shim's NUL sentinel — valid JSON from Go's encoding/json never contains
  // a raw 0x00 byte, since every control character is \u-escaped.
  const memory = new Uint8Array(exports.mem.buffer);
  let end = resultPtr;
  while (memory[end] !== 0) end++;
  const json = decoder.decode(memory.subarray(resultPtr, end));
  exports.free(resultPtr);
  return json;
}
