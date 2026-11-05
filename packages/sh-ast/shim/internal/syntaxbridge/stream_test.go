package syntaxbridge

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"eslint-sh-shim/internal/legacybridgetest"
	"eslint-sh-shim/internal/wireformtest"
	"mvdan.cc/sh/v3/syntax"
)

// The frozen map-based envelope is independent of streaming plans and writers.
// Compare the entire response, including field order and partial parse errors.
// Parse responses are ASCII-only with compact File positions, so the frozen
// bytes are first converted by the independent wireformtest oracle; every
// other byte must match exactly.
func TestStreamingParseMatchesFrozenEnvelope(t *testing.T) {
	sources := []string{"", "# 🎉 中 e\u0301\necho '<>&' \"\u2028\u2029\"\n", "cat <<'EOF'\na\tb\nEOF\n", "echo '\x01\x00\xff'", "echo ${a/foo/中} ${a:1:2}", "(foo |", "echo )", "[[ x = x ]]"}
	for _, variant := range []syntax.LangVariant{syntax.LangBash, syntax.LangPOSIX, syntax.LangMirBSDKorn, syntax.LangBats, syntax.LangZsh} {
		for i, source := range sources {
			for _, operation := range []string{"parse", "parse-with-positions"} {
				t.Run(fmt.Sprintf("%s/%d/%d", operation, variant, i), func(t *testing.T) {
					options := fmt.Sprintf(`{"Variant":%d,"KeepComments":true,"Filename":{"Bytes":"Yf8="}}`, variant)
					if i == 5 {
						options = fmt.Sprintf(`{"Variant":%d,"RecoverErrors":2}`, variant)
					}
					want := wireformtest.Response(legacybridgetest.Process(operation, source, options))
					got := Process(operation, source, options)
					if operation == "parse-with-positions" && !bytes.Contains(want, []byte(`"Error":`)) {
						var old, current map[string]json.RawMessage
						if err := json.Unmarshal(want, &old); err != nil {
							t.Fatal(err)
						}
						if err := json.Unmarshal(got, &current); err != nil {
							t.Fatal(err)
						}
						if !bytes.Equal(old["File"], current["File"]) {
							t.Fatal("File changed")
						}
						return
					}
					if !bytes.Equal(got, want) {
						t.Fatalf("response mismatch\ngot %s\nwant %s", got, want)
					}
				})
			}
		}
	}
	for _, options := range []string{`{"Variant":999}`, `{"KeepComments":2}`, `{"unknown":true}`, `{"StopAt":"a b"}`, `[]`, `{"Filename":{"Bytes":"?"}}`} {
		for _, op := range []string{"parse", "parse-with-positions"} {
			if got, want := Process(op, "echo x", options), legacybridgetest.Process(op, "echo x", options); !bytes.Equal(got, want) {
				t.Fatalf("invalid options %s: %s != %s", options, got, want)
			}
		}
	}
}

// Synthetic nodes exercise occurrence identity and method failures that a
// successful parser cannot necessarily produce. Ground truth is independent native field traversal and direct bound calls.
func TestStreamingSnapshotsMatchFrozenOccurrences(t *testing.T) {
	shared := &syntax.Stmt{Position: syntax.NewPos(1, 1, 2)}
	roots := []syntax.Node{
		&syntax.File{Last: []syntax.Comment{{Hash: syntax.NewPos(0, 1, 1), Text: "🎉"}}},
		&syntax.BinaryCmd{X: shared, Y: shared},
		&syntax.BinaryCmd{Y: shared},
		&syntax.ParamExp{Dollar: syntax.NewPos(7, 2, 3), Short: true, Param: &syntax.Lit{Value: "x"}, Index: (*syntax.Word)(nil)},
		(*syntax.Word)(nil),
	}
	for _, root := range roots {
		entries := positionSnapshots(root)
		nodes, _ := nativeOccurrences(root)
		if len(entries) != len(nodes) {
			t.Fatal("occurrence count")
		}
		for i, node := range nodes {
			for _, bound := range []struct {
				read    func() syntax.Pos
				actual  any
				failure any
			}{
				{node.Pos, entries[i].Pos, entries[i].PosError},
				{node.End, entries[i].End, entries[i].EndError},
			} {
				func() {
					defer func() {
						if caught := recover(); caught != nil && bound.failure == nil {
							t.Fatalf("missing native failure: %v", caught)
						}
					}()
					expected := bound.read()
					if bound.failure != nil {
						t.Fatalf("unexpected failure: %v", bound.failure)
					}
					checkSnapshotPosition(t, bound.actual, expected)
				}()
			}
		}
	}
}

// Bound methods are independently observed, in Pos then End order. Byte-bearing
// panic text must retain its Bytes representation rather than UTF-8 replacement.
type orderedBounds struct{ calls *[]string }

func (n *orderedBounds) Pos() syntax.Pos { *n.calls = append(*n.calls, "Pos"); panic("\xff") }
func (n *orderedBounds) End() syntax.Pos {
	*n.calls = append(*n.calls, "End")
	return syntax.NewPos(2, 1, 3)
}
func TestStreamingSnapshotMethodOrder(t *testing.T) {
	calls := []string{}
	root := &orderedBounds{calls: &calls}
	got := append(appendCompactPositionSidecar([]byte("{"), []syntax.Node{root}), '}')
	if fmt.Sprint(calls) != "[Pos End]" {
		t.Fatalf("calls %v", calls)
	}
	entries := decodeCompactSnapshots(got, [][]any{{}})
	if len(entries) != 1 || entries[0].Pos != nil || entries[0].End == nil || entries[0].PosError == nil || entries[0].EndError != nil {
		t.Fatalf("bounds %s", got)
	}
	if !bytes.Contains(got, []byte(`"Bytes"`)) {
		t.Fatalf("panic bytes lost: %s", got)
	}
}

// A failed syntax encoding discards partial File bytes and suppresses snapshots;
// invoking upstream bounds on this graph could recurse without termination.
func TestStreamingParseCompositionFailureIsAtomic(t *testing.T) {
	stmt := &syntax.Stmt{}
	stmt.Cmd = &syntax.BinaryCmd{X: stmt}
	file := &syntax.File{Stmts: []*syntax.Stmt{stmt}}
	for _, positions := range []bool{false, true} {
		got := composeParse(file, nil, positions)
		want := `{"Error":{"Kind":"InternalError","Message":"File.Stmts: Stmt.Cmd: BinaryCmd.X: cyclic syntax value"}}`
		if string(got) != want {
			t.Fatalf("got %s; want %s", got, want)
		}
	}
	if got, want := Process("parse", "echo ok", `{}`), wireformtest.Response(legacybridgetest.Process("parse", "echo ok", `{}`)); !bytes.Equal(got, want) {
		t.Fatal("failure contaminated next parse")
	}
}

// Parse responses, including partial-File parse errors and sidecar bound
// failures, contain only ASCII bytes so JavaScript can decode them as one-byte
// text. JSON decoding independently recovers the original Unicode values.
func TestParseResponsesAreASCII(t *testing.T) {
	cases := []struct{ operation, source, want string }{
		{"parse", "# é 🎉\necho 中\n", "中"},
		{"parse-with-positions", "echo 'é' \"🎉\"\n", "é"},
		{"parse", "echo 中 )", "файл.sh:1:10: a command"},
	}
	for _, c := range cases {
		got := Process(c.operation, c.source, `{"KeepComments":true,"Filename":"файл.sh"}`)
		for i, b := range got {
			if b >= 0x80 {
				t.Fatalf("%s %q: non-ASCII byte at %d: %s", c.operation, c.source, i, got)
			}
		}
		var decoded any
		if err := json.Unmarshal(got, &decoded); err != nil {
			t.Fatalf("%s %q: %v", c.operation, c.source, err)
		}
		text := fmt.Sprint(decoded)
		if !strings.Contains(text, c.want) || !strings.Contains(text, "файл.sh") {
			t.Fatalf("%s %q: decoded values lost Unicode text: %s", c.operation, c.source, text)
		}
	}
	failure := append(appendCompactPositionSidecar([]byte("{"), []syntax.Node{&orderedBounds{calls: &[]string{}}}), '}')
	for _, b := range failure {
		if b >= 0x80 {
			t.Fatalf("sidecar failure is not ASCII: %s", failure)
		}
	}
}

// Hand-derived anchors for the parse-response File spelling: two-byte "é" ends
// at byte offset 2 / byte column 3, an absent Semicolon is the invalid zero
// position, and upstream's recovered sentinel is invalid, recovered and beyond
// every valid offset (flags 2|4). Field order and record shape are unchanged.
func TestParsedFilePositionsUseCompactTuples(t *testing.T) {
	want := `{"File":{"Last":null,"Name":"","Stmts":[{"Background":false,"Cmd":{"Args":[{"Parts":[{"Type":"Lit","Value":"\u00e9","ValueEnd":[2,1,3,1],"ValuePos":[0,1,1,1]}],"Type":"Word"}],"Assigns":null,"Type":"CallExpr"},"Comments":null,"Coprocess":false,"Disown":false,"Negated":false,"Position":[0,1,1,1],"Redirs":null,"Semicolon":[0,0,0,0],"Type":"Stmt"}],"Type":"File"}}`
	if got := string(Process("parse", "é", `{}`)); got != want {
		t.Fatalf("got %s\nwant %s", got, want)
	}
	recovered := string(Process("parse", "(foo |", `{"RecoverErrors":2}`))
	if !strings.Contains(recovered, `"Rparen":[0,0,0,6]`) || !strings.Contains(recovered, `"Lparen":[0,1,1,1]`) {
		t.Fatalf("recovered positions: %s", recovered)
	}
	failure := string(Process("parse", "echo )", `{}`))
	if !strings.HasPrefix(failure, `{"Error":{"Filename":"","Incomplete":false,"Kind":"ParseError","Message":"1:6: a command can only contain words and redirects; encountered `+"`)`"+`","Pos":{"Offset":5,"Line":1,"Col":6,"IsValid":true,"IsRecovered":false,"OffsetOverflow":false},`) {
		t.Fatalf("error envelope must keep its position record: %s", failure)
	}
}

// The diagnostic parse duration is refreshed by each parse operation and is not
// part of any response. A large source takes measurably longer than none.
func TestLastParseDurationObservesEachParse(t *testing.T) {
	Process("parse", strings.Repeat("echo hi | cat\n", 2000), `{}`)
	long := LastParseDuration()
	if long <= 0 {
		t.Fatalf("expected a positive duration, got %v", long)
	}
	Process("parse-with-positions", "", `{}`)
	if short := LastParseDuration(); short < 0 || short >= long {
		t.Fatalf("empty parse duration %v not below %v", short, long)
	}
}
