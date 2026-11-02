package syntaxbridge

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"eslint-sh-shim/internal/syntaxwire"
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
	value, err := syntaxwire.Value(word)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestBraceObservationMatchesActualUpstreamParts(t *testing.T) {
	for _, source := range []string{"{a,b}", "x{a,b}y", "{1..3}", "{a..c}", "{🎉,中}", "{é,中}", "{a,{b,c}}", "{a,b{c,d}", `{a,"b"}`, "{a,'b'}", "{a,$x}", "'{a,b}'", `"{a,b}"`, "{a}", "{}", "a{b", "{a,b", "{1..z}"} {
		t.Run(source, func(t *testing.T) {
			word := braceWord(t, source)
			payload := encodedBraceWord(t, word)
			private := *word
			syntax.SplitBraces(&private)
			want := false
			for _, part := range private.Parts {
				if _, ok := part.(*syntax.BraceExp); ok {
					want = true
				}
			}
			result := response(t, "word-braces", payload, `{}`)
			if result["Brace"] != want {
				t.Fatalf("got %#v; upstream BraceExp presence = %v", result, want)
			}
			if encodedBraceWord(t, word) != payload {
				t.Fatal("observation changed original upstream word")
			}
		})
	}
}

func TestSplitBracesBooleanDoesNotIdentifyExpansion(t *testing.T) {
	for _, source := range []string{"{a}", "{}", "a{b", "{a,b"} {
		t.Run(source, func(t *testing.T) {
			word := braceWord(t, source)
			if !syntax.SplitBraces(word) {
				t.Fatal("pinned upstream behavior changed: revisit observation contract")
			}
			for _, part := range word.Parts {
				if _, ok := part.(*syntax.BraceExp); ok {
					t.Fatal("malformed or singleton braces unexpectedly expand")
				}
			}
			result := response(t, "word-braces", encodedBraceWord(t, braceWord(t, source)), `{}`)
			if !reflect.DeepEqual(result, map[string]any{"Brace": false}) {
				t.Fatalf("boolean was mistaken for expansion: %#v", result)
			}
		})
	}
}

func TestBraceObservationRejectsNonWordAndMalformedRecords(t *testing.T) {
	for _, payload := range []string{`null`, `{}`, `{"Type":"TypedNil","Kind":"Word"}`, `{"Type":"Word","Parts":[null]}`} {
		result := response(t, "word-braces", payload, `{}`)
		failure, ok := result["Error"].(map[string]any)
		if !ok || failure["Kind"] != "InputError" {
			t.Fatalf("invalid record must be InputError: %#v", result)
		}
	}
}
