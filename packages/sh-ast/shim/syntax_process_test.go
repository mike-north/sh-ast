//go:build js && wasm

package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

// resultBuffer observes the ABI's owned NUL-terminated result allocation, rather
// than bypassing the bridge to test only its native operation implementation.
func resultBuffer(t *testing.T, ptr uintptr) []byte {
	t.Helper()
	pinnedMu.Lock()
	buffer, ok := pinned[ptr]
	pinnedMu.Unlock()
	if !ok || len(buffer) == 0 || buffer[len(buffer)-1] != 0 {
		t.Fatal("result is not a pinned NUL-terminated buffer")
	}
	return buffer[:len(buffer)-1]
}

func TestSyntaxProcessPreservesRawBytesAndOwnedResult(t *testing.T) {
	ptr := syntaxProcess("parse", string([]byte{'e', 'c', 'h', 'o', ' ', 0xff}), `{}`)
	data := resultBuffer(t, ptr)
	if !json.Valid(data) || !bytes.Contains(data, []byte(`"Kind":"ParseError"`)) || !bytes.Contains(data, []byte(`invalid UTF-8 encoding`)) {
		t.Fatalf("unexpected response %s", data)
	}
	free(ptr)
	pinnedMu.Lock()
	_, retained := pinned[ptr]
	pinnedMu.Unlock()
	if retained {
		t.Fatal("free retained the syntax result buffer")
	}
}

func TestLegacyProcessRemainsAvailableAlongsideSyntaxProcess(t *testing.T) {
	legacy := process("echo hi", "bash", "input.sh")
	defer free(legacy)
	if !bytes.Contains(resultBuffer(t, legacy), []byte(`"file":`)) {
		t.Fatal("legacy ABI changed")
	}
	faithful := syntaxProcess("parse", "echo hi", `{}`)
	defer free(faithful)
	if !bytes.Contains(resultBuffer(t, faithful), []byte(`"File":`)) {
		t.Fatal("faithful ABI missing")
	}
}
