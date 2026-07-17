// Regression test: this package's whole purpose is to produce byte-identical
// output to mvdan.cc/sh/v3/syntax/typedjson.Encode while being much faster
// (see encode.go's package doc comment). This test parses the same
// kitchen-sink fixtures the TypeScript-level golden test
// (test/kitchen-sink.test.ts) uses — one per dialect, covering every mvdan/sh
// node type reachable through this shim — and asserts nodeencode.Encode's
// output matches the real typedjson.Encode's output byte for byte. A
// mismatch here would mean the cache introduced above changed the emitted
// JSON shape, which would silently corrupt every rule's AST.
package nodeencode

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"mvdan.cc/sh/v3/syntax"
	"mvdan.cc/sh/v3/syntax/typedjson"
)

// variantByName resolves a LangVariant the same way shim/main.go does — via
// LangVariant.Set by name — rather than hand-picking bit-flag constants,
// since v3.13 turned LangVariant into bit flags (see
// design/ARCHITECTURE.md's "Parse errors and dialects").
func variantByName(t *testing.T, name string) syntax.LangVariant {
	t.Helper()
	var v syntax.LangVariant
	if err := v.Set(name); err != nil {
		t.Fatalf("LangVariant.Set(%q): %v", name, err)
	}
	return v
}

func mustParse(t *testing.T, path string, variant syntax.LangVariant) *syntax.File {
	t.Helper()
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading fixture %s: %v", path, err)
	}
	parser := syntax.NewParser(syntax.KeepComments(true), syntax.Variant(variant))
	file, err := parser.Parse(bytes.NewReader(src), filepath.Base(path))
	if err != nil {
		t.Fatalf("parsing fixture %s: %v", path, err)
	}
	return file
}

func TestEncodeMatchesUpstreamTypedjson(t *testing.T) {
	fixtures := []struct {
		name        string
		path        string
		dialectName string
	}{
		{"bash", "../../../test/fixtures/kitchen-sink.bash.sh", "bash"},
		{"zsh", "../../../test/fixtures/kitchen-sink.zsh.sh", "zsh"},
		{"bats", "../../../test/fixtures/kitchen-sink.bats.sh", "bats"},
	}

	for _, f := range fixtures {
		t.Run(f.name, func(t *testing.T) {
			variant := variantByName(t, f.dialectName)
			file := mustParse(t, f.path, variant)

			var upstream bytes.Buffer
			if err := typedjson.Encode(&upstream, file); err != nil {
				t.Fatalf("upstream typedjson.Encode: %v", err)
			}

			// Re-parse for a second, independent *syntax.File — nodeencode's
			// structTypeCache is a package-level sync.Map, and reusing the
			// same *syntax.File for both encoders wouldn't exercise anything
			// a fresh, real second parse doesn't already cover in practice
			// (the shim always encodes a freshly parsed file per call).
			file2 := mustParse(t, f.path, variant)

			var forked bytes.Buffer
			if err := Encode(&forked, file2); err != nil {
				t.Fatalf("nodeencode.Encode: %v", err)
			}

			if upstream.String() != forked.String() {
				t.Fatalf(
					"nodeencode.Encode output diverged from upstream typedjson.Encode for %s\nupstream len=%d forked len=%d",
					f.name, upstream.Len(), forked.Len(),
				)
			}
		})
	}
}

// TestEncodeCacheIsPerTypeNotPerInstance guards the actual optimization:
// encoding the same fixture twice must reuse the same synthetic struct type
// for a given source node type (e.g. syntax.Stmt) rather than constructing a
// fresh one on the second parse — otherwise the point of this fork (avoiding
// a fresh reflect.StructOf per node instance) would be lost the moment a
// second, differently-addressed *syntax.File of the same shape is encoded,
// which is exactly what happens across repeated real parses in the shim.
func TestEncodeCacheIsPerTypeNotPerInstance(t *testing.T) {
	stmtType := reflect.TypeFor[syntax.Stmt]()
	variant := variantByName(t, "bash")
	const fixturePath = "../../../test/fixtures/kitchen-sink.bash.sh"

	file1 := mustParse(t, fixturePath, variant)
	var buf1 bytes.Buffer
	if err := Encode(&buf1, file1); err != nil {
		t.Fatalf("Encode (first parse): %v", err)
	}
	cachedAfterFirst, ok := structTypeCache.Load(stmtType)
	if !ok {
		t.Fatalf("expected syntax.Stmt to be cached after encoding a fixture containing statements")
	}

	file2 := mustParse(t, fixturePath, variant)
	var buf2 bytes.Buffer
	if err := Encode(&buf2, file2); err != nil {
		t.Fatalf("Encode (second parse): %v", err)
	}
	cachedAfterSecond, _ := structTypeCache.Load(stmtType)

	if cachedAfterFirst != cachedAfterSecond {
		t.Fatalf("expected the cached synthetic type for syntax.Stmt to be reused across parses, got a new one")
	}
	if buf1.String() != buf2.String() {
		t.Fatalf("encoding the same fixture twice produced different output")
	}
}
