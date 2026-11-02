package syntaxbridge

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

// response decodes the public operation envelope, so assertions observe the
// bridge contract rather than private dispatch helpers.
func response(t *testing.T, operation, payload, options string) map[string]any {
	t.Helper()
	value, err := syntaxwire.ReadJSON(Process(operation, payload, options))
	if err != nil {
		t.Fatal(err)
	}
	obj, ok := value.(map[string]any)
	if !ok {
		t.Fatal("response is not an object")
	}
	return obj
}

// fileFromResponse reconstructs the returned tree for comparison with an
// independently parsed upstream value, including data hidden by sparse JSON.
func fileFromResponse(t *testing.T, result map[string]any) *syntax.File {
	t.Helper()
	encoded, err := json.Marshal(result["File"])
	if err != nil {
		t.Fatal(err)
	}
	node, err := syntaxwire.DecodeNode(encoded)
	if err != nil {
		t.Fatal(err)
	}
	return node.(*syntax.File)
}

func TestParseDefaultsAndOptionsMatchUpstream(t *testing.T) {
	for _, fixture := range []struct {
		name, source, options string
		upstream              []syntax.ParserOption
	}{
		{"defaults", "# comment\necho 🎉", `{}`, nil},
		{"comments", "# comment\necho 🎉", `{"KeepComments":true}`, []syntax.ParserOption{syntax.KeepComments(true)}},
		{"stop", "echo hi;$$ ignored", `{"StopAt":"$$"}`, []syntax.ParserOption{syntax.StopAt("$$")}},
		{"recovery", "(foo |", `{"RecoverErrors":2}`, []syntax.ParserOption{syntax.RecoverErrors(2)}},
		{"legacy-bash", "echo hi", `{"Variant":0}`, []syntax.ParserOption{syntax.Variant(0)}},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			result := response(t, "parse", fixture.source, fixture.options)
			if result["Error"] != nil {
				t.Fatalf("unexpected error: %#v", result["Error"])
			}
			want, err := syntax.NewParser(fixture.upstream...).Parse(strings.NewReader(fixture.source), "")
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(want, fileFromResponse(t, result)) {
				t.Fatal("bridge differs from independent upstream parse")
			}
		})
	}
}

func TestParseErrorRetainsPartialFileAndEveryField(t *testing.T) {
	source := "echo ok; ("
	want, err := syntax.NewParser().Parse(strings.NewReader(source), "sample.sh")
	upstream := err.(syntax.ParseError)
	result := response(t, "parse", source, `{"Filename":"sample.sh"}`)
	if !reflect.DeepEqual(want, fileFromResponse(t, result)) {
		t.Fatal("partial File was changed or lost")
	}
	failure := result["Error"].(map[string]any)
	for key, value := range map[string]any{"Kind": "ParseError", "Message": upstream.Error(), "Filename": upstream.Filename, "Text": upstream.Text, "Incomplete": upstream.Incomplete} {
		if failure[key] != value {
			t.Errorf("%s: got %#v want %#v", key, failure[key], value)
		}
	}
	encoded, _ := json.Marshal(failure["Pos"])
	expected, _ := json.Marshal(syntaxwire.ObservePosition(upstream.Pos))
	if string(encoded) != string(expected) {
		var got, want any
		json.Unmarshal(encoded, &got)
		json.Unmarshal(expected, &want)
		if !reflect.DeepEqual(got, want) {
			t.Fatal("error position changed")
		}
	}
}

func TestLangErrorRetainsDistinctFields(t *testing.T) {
	result := response(t, "parse", "[[ a =~ b ]]", `{"Variant":4}`)
	failure := result["Error"].(map[string]any)
	if failure["Kind"] != "LangError" {
		t.Fatalf("got %#v", failure)
	}
	_, err := syntax.NewParser(syntax.Variant(syntax.LangMirBSDKorn)).Parse(strings.NewReader("[[ a =~ b ]]"), "")
	want := err.(syntax.LangError)
	if failure["Feature"] != want.Feature || failure["LangUsed"] != json.Number("4") {
		t.Fatalf("language details lost: %#v", failure)
	}
	langs := failure["Langs"].([]any)
	if len(langs) != len(want.Langs) {
		t.Fatal("supporting language variants changed")
	}
	for i, lang := range want.Langs {
		number, _ := langs[i].(json.Number).Int64()
		if number != int64(lang) {
			t.Fatal("supporting language value changed")
		}
	}
}

func TestByteSourceAndByteFilenameDoNotBecomeReplacementText(t *testing.T) {
	result := response(t, "parse", string([]byte{'e', 'c', 'h', 'o', ' ', 0xff}), `{"Filename":{"Bytes":"eP8="}}`)
	failure := result["Error"].(map[string]any)
	if failure["Kind"] != "ParseError" || failure["Text"] != "invalid UTF-8 encoding" {
		t.Fatalf("got %#v", failure)
	}
	filename, err := syntaxwire.ReadString(failure["Filename"])
	if err != nil {
		t.Fatal(err)
	}
	if filename != string([]byte{'x', 0xff}) || fileFromResponse(t, result).Name != filename {
		t.Fatal("filename bytes changed")
	}
	message, err := syntaxwire.ReadString(failure["Message"])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(message, filename+":") {
		t.Fatal("formatted error bytes changed")
	}
}

func TestInvalidOptionsDoNotPoisonSubsequentCalls(t *testing.T) {
	for _, options := range []string{`{"Variant":32}`, `{"Variant":3}`, `{"Variant":{"Int":"9223372036854775808"}}`, `{"RecoverErrors":{"Int":"-9223372036854775809"}}`, `{"RecoverErrors":9007199254740992}`, `{"RecoverErrors":1.5}`, `{"KeepComments":1}`, `{"StopAt":"ééé"}`, `{"StopAt":"x y"}`, `{"Unknown":true}`, `null`} {
		failure := response(t, "parse", "echo hi", options)["Error"].(map[string]any)
		if failure["Kind"] != "InputError" {
			t.Errorf("%s: got %#v", options, failure)
		}
	}
	if failure := response(t, "parse", "echo hi", `{}`)["Error"]; failure != nil {
		t.Fatalf("later parse failed: %#v", failure)
	}
}

func TestInt64RecoveryBoundariesAndUint64PositionConstructor(t *testing.T) {
	for _, integer := range []string{"-9223372036854775808", "9223372036854775807"} {
		result := response(t, "parse", "echo hi", `{"RecoverErrors":{"Int":"`+integer+`"}}`)
		if result["Error"] != nil {
			t.Fatalf("int64 value rejected: %#v", result["Error"])
		}
	}
	result := response(t, "newpos", `{"Offset":{"Int":"18446744073709551615"},"Line":262144,"Col":16384}`, `{}`)
	want := syntaxwire.ObservePosition(syntax.NewPos(^uint(0), 262144, 16384))
	got := result["Position"].(map[string]any)
	if got["Offset"] != json.Number("4294967284") || got["Line"] != json.Number("0") || got["Col"] != json.Number("0") || got["IsValid"] != want.IsValid {
		t.Fatalf("NewPos clamping changed: %#v", got)
	}
	for _, integer := range []string{"-1", "18446744073709551616"} {
		result := response(t, "newpos", `{"Offset":{"Int":"`+integer+`"},"Line":1,"Col":1}`, `{}`)
		if result["Error"].(map[string]any)["Kind"] != "InputError" {
			t.Fatal("invalid uint64 not rejected")
		}
	}
}

func TestBoundsUseCurrentEditedTreeAndRetainRecovery(t *testing.T) {
	comment := &syntax.Comment{Hash: syntax.NewPos(0, 1, 1), Text: "a"}
	before, _ := syntaxwire.Encode(comment)
	comment.Text = "🎉"
	after, _ := syntaxwire.Encode(comment)
	first := response(t, "bounds", string(before), `{}`)
	second := response(t, "bounds", string(after), `{}`)
	if first["End"].(map[string]any)["Offset"] != json.Number("2") || second["End"].(map[string]any)["Offset"] != json.Number("5") {
		t.Fatal("bounds ignored the edited UTF-8 text")
	}
	file, _ := syntax.NewParser(syntax.RecoverErrors(2)).Parse(strings.NewReader("(foo |"), "")
	encoded, _ := syntaxwire.Encode(file.Stmts[0].Cmd)
	result := response(t, "bounds", string(encoded), `{}`)
	if result["End"].(map[string]any)["IsRecovered"] != true {
		t.Fatal("bounds lost recovery")
	}
}

func TestBoundsRejectInvalidTreeAndUnsupportedOperations(t *testing.T) {
	word, _ := syntaxwire.Encode(&syntax.Word{})
	if result := response(t, "bounds", string(word), `{}`); result["Error"].(map[string]any)["Kind"] != "InputError" {
		t.Fatal("invalid tree was not rejected")
	}
	if result := response(t, "print", "", `{}`); result["Error"].(map[string]any)["Kind"] != "InputError" {
		t.Fatal("public printer must remain absent")
	}
}

// Node.Pos and Node.End are independent upstream operations. Partial editable
// records may support one while the other's missing child causes a panic.
func TestIndividualPositionsDoNotInvokeTheUnrequestedMethod(t *testing.T) {
	file, err := syntax.NewParser().Parse(strings.NewReader("echo left && echo right"), "")
	if err != nil {
		t.Fatal(err)
	}
	complete := file.Stmts[0].Cmd.(*syntax.BinaryCmd)
	for _, fixture := range []struct {
		name, operation, unsupported string
		node                         *syntax.BinaryCmd
		want                         syntax.Pos
	}{
		{"start-only", "pos", "end", &syntax.BinaryCmd{X: complete.X}, complete.X.Pos()},
		{"end-only", "end", "pos", &syntax.BinaryCmd{Y: complete.Y}, complete.Y.End()},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			encoded, err := syntaxwire.Encode(fixture.node)
			if err != nil {
				t.Fatal(err)
			}
			result := response(t, fixture.operation, string(encoded), `{}`)
			if result["Error"] != nil {
				t.Fatalf("unrelated missing child rejected %s: %#v", fixture.operation, result["Error"])
			}
			position := result["Position"].(map[string]any)
			want, _ := syntaxwire.ReadJSON(mustJSON(t, syntaxwire.ObservePosition(fixture.want)))
			if !reflect.DeepEqual(position, want) {
				t.Fatalf("position changed: got %#v want %#v", position, want)
			}
			failure := response(t, fixture.unsupported, string(encoded), `{}`)["Error"].(map[string]any)
			if failure["Kind"] != "InputError" {
				t.Fatalf("unsupported method did not report its own input failure: %#v", failure)
			}
		})
	}
}

// mustJSON keeps observation comparisons on the wire's number representation.
func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
