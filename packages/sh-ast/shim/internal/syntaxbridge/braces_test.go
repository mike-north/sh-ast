package syntaxbridge

import (
	"encoding/json"
	"strings"
	"testing"

	"eslint-sh-shim/internal/legacywiretest"
	"mvdan.cc/sh/v3/syntax"
)

// braceWord parses argument grammar independently of the bridge dispatch path.
func braceWord(t *testing.T, source string) *syntax.Word {
	t.Helper()
	file, err := syntax.NewParser().Parse(strings.NewReader("echo "+source), "")
	if err != nil {
		t.Fatal(err)
	}
	return file.Stmts[0].Cmd.(*syntax.CallExpr).Args[1]
}

// encodedBraceWord retains original upstream records for transport and mutation checks.
func encodedBraceWord(t *testing.T, word *syntax.Word) string {
	t.Helper()
	value, err := legacywiretest.Value(word)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
