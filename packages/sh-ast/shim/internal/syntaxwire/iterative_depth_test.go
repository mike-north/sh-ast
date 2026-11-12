package syntaxwire

// Trees as deep as a flat chain of 10,000+ commands or arithmetic terms make: one
// level per link, nesting to the left. The encoder, validator and decoder must handle
// them without a native frame per level (the WebAssembly build runs on a far smaller
// stack than a native test binary, so the same tests are meant to be run there too:
// GOOS=js GOARCH=wasm go test -exec "$(go env GOROOT)/lib/wasm/go_js_wasm_exec").

import (
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// deepLinks is well past the 10,000-level limit encoding/json places on a document
// (a command link nests two records, so 10,000 links is 20,000 levels).
const deepLinks = 10_000

// command is one simple command, `true`.
func command() *syntax.Stmt {
	return &syntax.Stmt{Cmd: &syntax.CallExpr{Args: []*syntax.Word{{Parts: []syntax.WordPart{&syntax.Lit{Value: "true"}}}}}}
}

// commandChain builds `true && true && ...` with links commands: BinaryCmd.X nests left.
func commandChain(links int) *syntax.Stmt {
	left := command()
	for i := 1; i < links; i++ {
		left = &syntax.Stmt{Cmd: &syntax.BinaryCmd{Op: syntax.AndStmt, X: left, Y: command()}}
	}
	return left
}

// arithmeticChain builds `1+1+...` with terms terms: BinaryArithm.X nests left.
func arithmeticChain(terms int) *syntax.ArithmExp {
	term := func() syntax.ArithmExpr { return &syntax.Word{Parts: []syntax.WordPart{&syntax.Lit{Value: "1"}}} }
	var left syntax.ArithmExpr = term()
	for i := 1; i < terms; i++ {
		left = &syntax.BinaryArithm{Op: syntax.Add, X: left, Y: term()}
	}
	return &syntax.ArithmExp{X: left}
}

// spineLength counts BinaryCmd/BinaryArithm links down the left spine, iteratively.
func spineLength(node syntax.Node) int {
	links := 0
	for {
		switch n := node.(type) {
		case *syntax.Stmt:
			node = n.Cmd
		case *syntax.ArithmExp:
			node = n.X
		case *syntax.BinaryCmd:
			links++
			node = n.X
		case *syntax.BinaryArithm:
			links++
			node = n.X
		default:
			return links
		}
	}
}

func TestDeepChainsRoundTripWithoutRecursion(t *testing.T) {
	for name, root := range map[string]syntax.Node{"command": commandChain(deepLinks), "arithmetic": arithmeticChain(deepLinks)} {
		first, err := Encode(root)
		if err != nil {
			t.Fatalf("%s: encode: %v", name, err)
		}
		decoded, err := DecodeNode(first)
		if err != nil {
			t.Fatalf("%s: decode: %v", name, err)
		}
		if got := spineLength(decoded); got != deepLinks-1 {
			t.Fatalf("%s: decoded spine has %d links; want %d", name, got, deepLinks-1)
		}
		second, err := Encode(decoded)
		if err != nil {
			t.Fatalf("%s: re-encode: %v", name, err)
		}
		if string(first) != string(second) {
			t.Fatalf("%s: round trip changed the encoding", name)
		}
	}
}

// Occurrence collection and the parse-response spelling follow the same preorder
// at any depth: one occurrence per record, the root first.
func TestDeepChainOccurrencesAndCompactPositions(t *testing.T) {
	file := &syntax.File{Stmts: []*syntax.Stmt{commandChain(deepLinks)}}
	_, nodes, err := AppendParsedFile(nil, file, true)
	if err != nil {
		t.Fatal(err)
	}
	// Per command: Stmt, CallExpr, Word, Lit. Per link: a Stmt and a BinaryCmd. Plus the File.
	want := 1 + 4*deepLinks + 2*(deepLinks-1)
	if len(nodes) != want || nodes[0] != syntax.Node(file) {
		t.Fatalf("collected %d occurrences (first %T); want %d starting with the File", len(nodes), nodes[0], want)
	}
}

func TestDeepChainErrorsKeepTheirFullPath(t *testing.T) {
	// The deepest command holds a value the writer cannot encode; the reported
	// error carries the field path of every enclosing record, as it always has.
	root := commandChain(deepLinks)
	deepest := root
	for {
		binary, ok := deepest.Cmd.(*syntax.BinaryCmd)
		if !ok {
			break
		}
		deepest = binary.X
	}
	deepest.Cmd.(*syntax.CallExpr).Args[0].Parts = append(deepest.Cmd.(*syntax.CallExpr).Args[0].Parts, &badPart{})
	_, err := Encode(root)
	want := strings.Repeat("Stmt.Cmd: BinaryCmd.X: ", deepLinks-1) +
		"Stmt.Cmd: CallExpr.Args: Word.Parts: unsupported syntax struct syntaxwire.badPart"
	if err == nil || err.Error() != want {
		t.Fatalf("got %.200v", err)
	}
}

func TestDeepChainCycleIsRejectedAtFullDepth(t *testing.T) {
	root := commandChain(deepLinks)
	deepest := root
	for {
		binary, ok := deepest.Cmd.(*syntax.BinaryCmd)
		if !ok {
			break
		}
		deepest = binary.X
	}
	deepest.Cmd = &syntax.Subshell{Stmts: []*syntax.Stmt{root}}
	_, err := Encode(root)
	if err == nil || !strings.HasSuffix(err.Error(), "cyclic syntax value") {
		t.Fatalf("cycle closing at depth was not rejected: %.200v", err)
	}
	if !strings.HasPrefix(err.Error(), "Stmt.Cmd: BinaryCmd.X: ") {
		t.Fatalf("error lost its field path: %.200v", err)
	}
}

func TestDecodeErrorsKeepTheirFullPathAtDepth(t *testing.T) {
	data, err := Encode(commandChain(deepLinks))
	if err != nil {
		t.Fatal(err)
	}
	// Corrupt the deepest Lit's Value: a number where a string is required.
	broken := strings.Replace(string(data), `"Value":"true"`, `"Value":7`, -1)
	_, err = DecodeNode([]byte(broken))
	want := strings.Repeat("Stmt.Cmd: BinaryCmd.X: ", deepLinks-1) +
		"Stmt.Cmd: CallExpr.Args: index 0: Word.Parts: index 0: Lit.Value: expected a string or a Bytes record"
	// The decoder reaches the first (deepest, leftmost) Lit before any other.
	if err == nil || err.Error() != want {
		t.Fatalf("got %.300v", err)
	}
}

// encoding/json refuses more than 10,000 open containers; ReadJSON must accept the
// document anyway, and must still be encoding/json for everything it can parse.
func TestReadJSONAcceptsDocumentsDeeperThanEncodingJSONAllows(t *testing.T) {
	const levels = 200_000
	text := strings.Repeat("[", levels) + `{"k":1}` + strings.Repeat("]", levels)
	var probe any
	err := json.NewDecoder(strings.NewReader(text)).Decode(&probe)
	if err == nil || !exceededNestingLimit(err) {
		t.Fatalf("encoding/json no longer refuses deep documents the way ReadJSON expects: %v", err)
	}
	value, err := ReadJSON([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	depth := 0
	for {
		array, ok := value.([]any)
		if !ok {
			break
		}
		depth++
		value = array[0]
	}
	if object, ok := value.(map[string]any); depth != levels || !ok || object["k"] != json.Number("1") {
		t.Fatalf("depth %d, innermost %v", depth, value)
	}
}

func TestReadJSONRejectsMalformedDeepDocuments(t *testing.T) {
	deep := strings.Repeat("[", 20_000)
	for name, text := range map[string]string{
		"truncated":        deep,
		"mismatched close": deep + `}`,
		"trailing value":   deep + strings.Repeat("]", 20_000) + ` 1`,
		"bad member":       strings.Repeat(`{"a":`, 20_000) + `}`,
	} {
		if _, err := ReadJSON([]byte(text)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// A document of a few thousand levels is within encoding/json's own cap yet deep
// enough to exhaust the host stack on WebAssembly (a regression: print requests of
// 2,500-5,000 list links, 5,000-10,000 levels, threw RangeError). ReadJSON must
// choose the iterative reader for it without changing a single outcome.
func TestNestingExceedsCountsOnlyStructuralBrackets(t *testing.T) {
	for _, tc := range []struct {
		text  string
		limit int
		want  bool
	}{
		{`[[[`, 2, true},
		{`[[[`, 3, false},
		{`[[],[],[]]`, 2, false},
		{`["[[[[", "\"[[[[", "\\\\"]`, 1, false},
		{`{"a":{"b":[1]}}`, 2, true},
		{`{"a":{"b":[1]}}`, 3, false},
		{``, 0, false},
	} {
		if got := nestingExceeds([]byte(tc.text), tc.limit); got != tc.want {
			t.Errorf("nestingExceeds(%q, %d) = %v, want %v", tc.text, tc.limit, got, tc.want)
		}
	}
}

func TestReadJSONMatchesEncodingJSONAcrossTheRecursionBound(t *testing.T) {
	stdlib := func(text string) (any, error) {
		decoder := json.NewDecoder(strings.NewReader(text))
		decoder.UseNumber()
		var value any
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		var extra any
		if err := decoder.Decode(&extra); err != io.EOF {
			return nil, errors.New("expected exactly one JSON value")
		}
		return value, nil
	}
	for _, levels := range []int{2, 100, recursiveDecodeDepthLimit - 1, recursiveDecodeDepthLimit, recursiveDecodeDepthLimit + 1, 1_000, 2_500, 5_000, 9_000} {
		if runtime.GOARCH == "wasm" && levels > 1_000 {
			// The encoding/json reference itself recurses and cannot read these on the
			// WebAssembly stack; native runs cover them.
			continue
		}
		open, shut := strings.Repeat(`{"a":[`, levels/2), strings.Repeat(`]}`, levels/2)
		for name, text := range map[string]string{
			"valid":            open + `1.50` + shut,
			"truncated":        open + `1`,
			"truncated string": open + `"x`,
			"mismatched close": open + `1` + shut[:len(shut)-2] + `]]`,
			"trailing value":   open + `1` + shut + ` 2`,
			"bad literal":      open + `tru` + shut,
			"unquoted key":     open + `{0:1}` + shut,
			"missing colon":    strings.Repeat(`{"a"`, 3) + open + shut,
		} {
			want, wantErr := stdlib(text)
			got, gotErr := ReadJSON([]byte(text))
			if (wantErr == nil) != (gotErr == nil) || (wantErr != nil && wantErr.Error() != gotErr.Error()) {
				t.Errorf("%d levels, %s: error %v, encoding/json %v", levels, name, gotErr, wantErr)
			} else if !reflect.DeepEqual(got, want) {
				t.Errorf("%d levels, %s: value differs from encoding/json", levels, name)
			}
		}
	}
}

// Regression: a malformed document nested past the recursion bound was reported with
// the token reader's wording ("invalid character '0'") instead of encoding/json's
// ("... looking for beginning of object key string").
func TestReadJSONKeepsEncodingJSONMessageForMalformedKeyBeyondTheBound(t *testing.T) {
	levels := recursiveDecodeDepthLimit + 1
	text := strings.Repeat("[", levels) + "{0:1}" + strings.Repeat("]", levels)
	var probe any
	want := json.NewDecoder(strings.NewReader(text)).Decode(&probe)
	if want == nil {
		t.Fatal("encoding/json accepted the malformed document")
	}
	if _, got := ReadJSON([]byte(text)); got == nil || got.Error() != want.Error() {
		t.Fatalf("ReadJSON error %v, encoding/json %v", got, want)
	}
}
