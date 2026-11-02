package main

import (
	"os"
	"os/exec"
	"reflect"
	"testing"
)

// TestGeneratedArtifactInventory fixes the package's generated boundary: only
// the faithful records, operator domains, and complete field metadata are built.
// Running the real command in an empty directory catches accidental extra output
// independently of which renderers main chooses to invoke.
func TestGeneratedArtifactInventory(t *testing.T) {
	outDir := t.TempDir()
	command := exec.Command("go", "run", ".", "-out", outDir)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("generator failed: %v\n%s", err, output)
	}
	entries, err := os.ReadDir(outDir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	want := []string{
		"syntax-constants.d.ts", "syntax-constants.js",
		"syntax-schema.d.ts", "syntax-schema.js", "syntax-types.d.ts",
	}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("generated artifact inventory = %v; want %v", names, want)
	}
}
