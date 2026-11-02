package syntaxbridge

import (
	"bytes"
	"encoding/json"
	"fmt"
	"testing"

	"eslint-sh-shim/internal/legacybridgetest"
	"mvdan.cc/sh/v3/syntax"
)

// The frozen map-based envelope is independent of streaming plans and writers.
// Compare the entire response, including field order and partial parse errors.
func TestStreamingParseMatchesFrozenEnvelope(t *testing.T) {
	sources := []string{"", "# 🎉 中 e\u0301\necho '<>&' \"\u2028\u2029\"\n", "cat <<'EOF'\na\tb\nEOF\n", "echo '\x01\x00\xff'", "echo ${a/foo/中} ${a:1:2}", "(foo |", "echo )", "[[ x = x ]]"}
	for variant := 0; variant < 5; variant++ {
		for i, source := range sources {
			for _, operation := range []string{"parse", "parse-with-positions"} {
				t.Run(fmt.Sprintf("%s/%d/%d", operation, variant, i), func(t *testing.T) {
					options := fmt.Sprintf(`{"Variant":%d,"KeepComments":true,"Filename":{"Bytes":"Yf8="}}`, variant)
					if i == 5 {
						options = fmt.Sprintf(`{"Variant":%d,"RecoverErrors":2}`, variant)
					}
					want := legacybridgetest.Process(operation, source, options)
					got := Process(operation, source, options)
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
// successful parser cannot necessarily produce. Ground truth is the frozen walk.
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
		want, err := json.Marshal(legacybridgetest.Snapshots(root))
		if err != nil {
			t.Fatal(err)
		}
		got := appendPositionSnapshots(nil, root)
		if !bytes.Equal(got, want) {
			t.Fatalf("%T snapshots\ngot %s\nwant %s", root, got, want)
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
	got := appendPositionSnapshots(nil, root)
	if fmt.Sprint(calls) != "[Pos End]" {
		t.Fatalf("calls %v", calls)
	}
	var entries []struct {
		Pos      any
		End      any
		PosError any
		EndError any
	}
	if err := json.Unmarshal(got, &entries); err != nil {
		t.Fatal(err)
	}
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
	if got, want := Process("parse", "echo ok", `{}`), legacybridgetest.Process("parse", "echo ok", `{}`); !bytes.Equal(got, want) {
		t.Fatal("failure contaminated next parse")
	}
}
