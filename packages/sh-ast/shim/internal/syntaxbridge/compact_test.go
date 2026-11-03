package syntaxbridge

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mvdan.cc/sh/v3/syntax"
	"reflect"
	"strings"
	"testing"
)

// Hand-derived coordinates anchor the flat transport independently of the codec.
// A failed bound has zero placeholders while the other bound remains observable.
func TestCompactSidecarCoordinatesAndIndependentFailures(t *testing.T) {
	calls := []string{}
	nodes := []syntax.Node{&syntax.Comment{Hash: syntax.NewPos(4, 2, 3), Text: "中"}, &orderedBounds{calls: &calls}}
	got := appendCompactPositionSidecar([]byte("{"), nodes)
	got = append(got, '}')
	var envelope struct {
		Positions      []int
		PositionErrors [][]any
	}
	if err := json.Unmarshal(got, &envelope); err != nil {
		t.Fatal(err)
	}
	want := []int{4, 2, 3, 1, 8, 2, 7, 1, 0, 0, 0, 0, 2, 1, 3, 1}
	if !reflect.DeepEqual(envelope.Positions, want) {
		t.Fatalf("got %v want %v", envelope.Positions, want)
	}
	if len(envelope.PositionErrors) != 1 || len(envelope.PositionErrors[0]) != 3 || envelope.PositionErrors[0][0] != float64(1) || envelope.PositionErrors[0][1] == nil || envelope.PositionErrors[0][2] != nil {
		t.Fatalf("errors %s", got)
	}
	expectedBytes := base64.StdEncoding.EncodeToString([]byte("upstream node position: \xff"))
	if !reflect.DeepEqual(envelope.PositionErrors[0][1], map[string]any{"Bytes": expectedBytes}) {
		t.Fatalf("panic payload %s", got)
	}
	if !reflect.DeepEqual(calls, []string{"Pos", "End"}) {
		t.Fatalf("calls %v", calls)
	}
}

// The independent native parser supplies all coordinates across every supported
// dialect; exported-field traversal supplies occurrences without encoder metadata.
func TestCompactParsedBoundsAllDialects(t *testing.T) {
	sources := []string{"# 🎉 中 e\u0301\r\necho hi\r\n", "cat <<'EOF'\n中 🎉 e\u0301\nEOF\n", "", "# only\n", "(foo |"}
	for _, variant := range []syntax.LangVariant{syntax.LangBash, syntax.LangPOSIX, syntax.LangMirBSDKorn, syntax.LangBats, syntax.LangZsh} {
		for _, source := range sources {
			options := fmt.Sprintf(`{"Variant":%d,"KeepComments":true,"RecoverErrors":2}`, variant)
			file, err := syntax.NewParser(syntax.Variant(syntax.LangVariant(variant)), syntax.KeepComments(true), syntax.RecoverErrors(2)).Parse(strings.NewReader(source), "")
			if err != nil {
				t.Fatal(err)
			}
			nodes, paths := nativeOccurrences(file)
			entries := decodeCompactSnapshots(Process("parse-with-positions", source, options), paths)
			for i, node := range nodes {
				if entries[i].PosError != nil || entries[i].EndError != nil {
					t.Fatalf("unexpected error for %T", node)
				}
				checkSnapshotPosition(t, entries[i].Pos, node.Pos())
				checkSnapshotPosition(t, entries[i].End, node.End())
			}
		}
	}
}

// Comments are value records with pointer-receiver bounds. Every upstream slot
// must contribute its actual encoded occurrence and retain UTF-8 byte coordinates.
func TestCompactBoundsEveryCommentSlot(t *testing.T) {
	roots := []syntax.Node{&syntax.File{}, &syntax.Stmt{}, &syntax.Subshell{}, &syntax.Block{}, &syntax.IfClause{}, &syntax.WhileClause{}, &syntax.ForClause{}, &syntax.CmdSubst{}, &syntax.CaseClause{}, &syntax.CaseItem{}, &syntax.ArrayExpr{}, &syntax.ArrayElem{}, &syntax.ProcSubst{}}
	slots := 0
	for _, root := range roots {
		typ := reflect.TypeOf(root).Elem()
		for i := 0; i < typ.NumField(); i++ {
			if typ.Field(i).Type != reflect.TypeFor[[]syntax.Comment]() {
				continue
			}
			slots++
			fresh := reflect.New(typ)
			comments := []syntax.Comment{{Hash: syntax.NewPos(11, 3, 4), Text: "🎉 中 e\u0301"}, {Hash: syntax.NewPos(41, 5, 2), Text: "last"}}
			fresh.Elem().Field(i).Set(reflect.ValueOf(comments))
			entries := positionSnapshots(fresh.Interface().(syntax.Node))
			if len(entries) != 3 {
				t.Fatalf("%s.%s occurrence count %d", typ.Name(), typ.Field(i).Name, len(entries))
			}
			for j := range comments {
				checkSnapshotPosition(t, entries[j+1].Pos, comments[j].Pos())
				checkSnapshotPosition(t, entries[j+1].End, comments[j].End())
			}
		}
	}
	if slots != 17 {
		t.Fatalf("comment inventory changed: %d", slots)
	}
}
