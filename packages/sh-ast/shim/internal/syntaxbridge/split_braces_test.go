// SplitBraces is an upstream syntax transformation, not a brace-expansion
// classifier. These tests compare its exact native result and identity reuse
// with the bridge without deriving expectations from analysis behavior.
package syntaxbridge

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

func TestSplitBracesMatchesExactNativeTransformation(t *testing.T) {
	for _, source := range []string{"ordinary", "'{a,b}'", "{a,b}", "x{a,b}y", "{1..3}", "{🎉,中}", "{a}", "{}", "a{b", "{a,b", "{1..z}", `{a,"b"}`, "{a,$x}"} {
		t.Run(source, func(t *testing.T) {
			word := braceWord(t, source)
			payload := encodedBraceWord(t, word)
			changed := syntax.SplitBraces(word)
			result := response(t, "split-braces", payload, `{}`)
			if result["Changed"] != changed {
				t.Fatalf("exact native bool lost: %#v", result)
			}
			if !changed {
				if len(result) != 1 {
					t.Fatalf("unchanged operation must not replace inputs: %#v", result)
				}
				return
			}
			encoded, err := json.Marshal(result["Word"])
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := syntaxwire.DecodeNode(encoded)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(word, decoded) {
				t.Fatalf("transformed records differ: %#v", result)
			}
		})
	}
}

func TestSplitBracesRetainsInputWordPartIdentity(t *testing.T) {
	lead := &syntax.Lit{Value: "keep"}
	quoted := &syntax.SglQuoted{Value: "中"}
	end := &syntax.Lit{Value: "end"}
	word := &syntax.Word{Parts: []syntax.WordPart{lead, &syntax.Lit{Value: "{a,"}, quoted, &syntax.Lit{Value: "}tail"}, end}}
	payload := encodedBraceWord(t, word)
	if !syntax.SplitBraces(word) {
		t.Fatal("expected native rewrite")
	}
	brace := word.Parts[1].(*syntax.BraceExp)
	if word.Parts[0] != lead || brace.Elems[1].Parts[1] != quoted || word.Parts[3] != end {
		t.Fatal("independent native identity observation changed")
	}
	result := response(t, "split-braces", payload, `{}`)
	expected := []any{
		map[string]any{"Input": json.Number("0"), "Path": []any{json.Number("0")}},
		map[string]any{"Input": json.Number("2"), "Path": []any{json.Number("1"), json.Number("1"), json.Number("1")}},
		map[string]any{"Input": json.Number("4"), "Path": []any{json.Number("3")}},
	}
	if !reflect.DeepEqual(result["RetainedParts"], expected) {
		t.Fatalf("input-part reuse = %#v, want %#v", result["RetainedParts"], expected)
	}
}

func TestSplitBracesPreservesBytesAndNilParts(t *testing.T) {
	for _, word := range []*syntax.Word{
		{Parts: nil},
		{Parts: []syntax.WordPart{}},
		{Parts: []syntax.WordPart{nil}},
		{Parts: []syntax.WordPart{&syntax.Lit{Value: "{a,"}, nil, &syntax.Lit{Value: "b}"}}},
		{Parts: []syntax.WordPart{&syntax.Lit{Value: string([]byte{'{', 'a', ',', 0xfe, '}'})}}},
	} {
		payload := encodedBraceWord(t, word)
		changed := syntax.SplitBraces(word)
		result := response(t, "split-braces", payload, `{}`)
		if result["Changed"] != changed {
			t.Fatal("native bool differs")
		}
		if changed {
			data, _ := json.Marshal(result["Word"])
			actual, err := syntaxwire.DecodeNode(data)
			if err != nil || !reflect.DeepEqual(actual, word) {
				t.Fatalf("byte/nil data lost: %v", err)
			}
		}
	}
}

func TestSplitBracesFailuresDoNotInventAnalysisResults(t *testing.T) {
	for _, payload := range []string{`null`, `{}`, `{"Type":"TypedNil","Kind":"Word"}`} {
		result := response(t, "split-braces", payload, `{}`)
		failure, ok := result["Error"].(map[string]any)
		if !ok || failure["Kind"] != "InputError" {
			t.Fatalf("invalid Word must be InputError: %#v", result)
		}
	}
	// A typed-nil Lit is representable input but upstream dereferences it while
	// checking for braces. Preserve the operation failure as an internal panic.
	word := &syntax.Word{Parts: []syntax.WordPart{(*syntax.Lit)(nil)}}
	result := response(t, "split-braces", encodedBraceWord(t, word), `{}`)
	failure, ok := result["Error"].(map[string]any)
	if !ok || failure["Kind"] != "InternalError" {
		t.Fatalf("native panic was hidden: %#v", result)
	}
}

// Valid brace text can create a much deeper output record graph than its input
// Word. The bridge refuses this graph before recursive transport, not as grammar.
func TestSplitBracesOutputRecordDepthRefusal(t *testing.T) {
	for _, depth := range []int{1000, 2000} {
		source := strings.Repeat("{a,", depth) + "x" + strings.Repeat("}", depth)
		payload := encodedBraceWord(t, braceWord(t, source))
		result := response(t, "split-braces", payload, `{}`)
		failure, ok := result["Error"].(map[string]any)
		if !ok || len(result) != 1 || failure["Kind"] != "InternalError" {
			t.Fatalf("expected bridge-only resource refusal at %d; keys=%v error=%v", depth, resultKeys(result), result["Error"])
		}
		const expected = "SplitBraces output record depth 257 exceeds the bridge transport limit 256"
		if failure["Message"] != expected {
			t.Fatalf("resource origin lost: %#v", failure)
		}
	}
}

// These controls establish useful ordinary nested transformations, without
// claiming the transport budget is a universal host-stack safety guarantee.
func TestSplitBracesOutputRecordDepthOrdinaryControls(t *testing.T) {
	for _, depth := range []int{1, 20, 100} {
		source := strings.Repeat("{a,", depth) + "x" + strings.Repeat("}", depth)
		result := response(t, "split-braces", encodedBraceWord(t, braceWord(t, source)), `{}`)
		if result["Error"] != nil || result["Changed"] != true || result["Word"] == nil {
			t.Fatalf("ordinary transformation refused at %d: %#v", depth, result)
		}
	}
}
