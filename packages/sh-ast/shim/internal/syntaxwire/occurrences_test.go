package syntaxwire

import (
	"context"
	"os"
	"os/exec"
	"reflect"
	"testing"
	"time"

	"mvdan.cc/sh/v3/syntax"
)

// Hand-authored pointers deliberately distinguish sorted wire preorder from the
// old declaration-order snapshot traversal: File.Last precedes File.Stmts and
// Stmt.Cmd precedes Stmt.Comments. Shared children must remain repeated occurrences.
func TestCollectedOccurrencesFollowActualWirePreorder(t *testing.T) {
	lit := &syntax.Lit{Value: "🎉"}
	word := &syntax.Word{Parts: []syntax.WordPart{lit}}
	call := &syntax.CallExpr{Args: []*syntax.Word{word, word}}
	stmt := &syntax.Stmt{Cmd: call, Comments: []syntax.Comment{{Text: "attached"}}}
	file := &syntax.File{Stmts: []*syntax.Stmt{stmt}, Last: []syntax.Comment{{Text: "trailing"}}}
	data, nodes, err := AppendWithOccurrences(nil, file)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := Encode(file)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(plain) {
		t.Fatal("occurrence collection changed File bytes")
	}
	want := []syntax.Node{file, &file.Last[0], stmt, call, word, lit, word, lit, &stmt.Comments[0]}
	if len(nodes) != len(want) {
		t.Fatalf("got%d occurrences; want%d", len(nodes), len(want))
	}
	for i, node := range nodes {
		if node != want[i] {
			t.Fatalf("occurrence%d: got%T %p; want%T %p", i, node, node, want[i], want[i])
		}
	}
}

// Interface typed nils have observable identity; concrete nil pointers and nil
// interfaces do not. Auxiliary records pass through to their real Node children.
func TestCollectedOccurrencesRetainNilAndAuxiliarySemantics(t *testing.T) {
	typedNil := (*syntax.Lit)(nil)
	word := &syntax.Word{Parts: []syntax.WordPart{nil, typedNil}}
	offset := &syntax.Word{}
	parameter := &syntax.ParamExp{Slice: &syntax.Slice{Offset: offset}}
	cases := []struct {
		root syntax.Node
		want []syntax.Node
	}{
		{(*syntax.File)(nil), []syntax.Node{(*syntax.File)(nil)}},
		{word, []syntax.Node{word, typedNil}},
		{parameter, []syntax.Node{parameter, offset}},
	}
	for _, c := range cases {
		_, nodes, err := AppendWithOccurrences(nil, c.root)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(nodes, c.want) {
			t.Fatalf("%T: got%v want%v", c.root, nodes, c.want)
		}
	}
	file := &syntax.File{Stmts: []*syntax.Stmt{nil}, Last: []syntax.Comment{}}
	_, nodes, err := AppendWithOccurrences(nil, file)
	if err != nil || len(nodes) != 1 || nodes[0] != file {
		t.Fatalf("concrete null/empty: %v %v", nodes, err)
	}
}

// Every pinned comment-bearing field must expose its addressable slice values.
// The explicit inventory count guards against accidentally dropping a field from
// coverage; expected pointers come directly from upstream Go storage, not plans.
func TestCollectedOccurrencesCoverEveryCommentSlot(t *testing.T) {
	slots := 0
	commentSlice := reflect.TypeFor[[]syntax.Comment]()
	for _, typ := range nodeTypes {
		for i := 0; i < typ.NumField(); i++ {
			if typ.Field(i).Type != commentSlice {
				continue
			}
			slots++
			t.Run(typ.Name()+"."+typ.Field(i).Name, func(t *testing.T) {
				pointer := reflect.New(typ)
				root, ok := pointer.Interface().(syntax.Node)
				if !ok {
					t.Fatal("comment-bearing root does not implement Node")
				}
				field := pointer.Elem().Field(i)
				field.Set(reflect.ValueOf([]syntax.Comment{{Text: "中"}, {Text: "é"}}))
				_, nodes, err := AppendWithOccurrences(nil, root)
				if err != nil {
					t.Fatal(err)
				}
				if len(nodes) != 3 || nodes[0] != root {
					t.Fatalf("expected root and two comments; got%v", nodes)
				}
				for j := 0; j < 2; j++ {
					if nodes[j+1] != field.Index(j).Addr().Interface().(syntax.Node) {
						t.Fatalf("comment%d lost addressable identity", j)
					}
				}
			})
		}
	}
	if slots != 17 {
		t.Fatalf("expected17 pinned comment-bearing slots; got%d", slots)
	}
}

// Collection cannot invoke methods even when a record later fails. Tests register
// this synthetic record only to expose method calls without risking stack overflow.
type boundCallSentinel struct {
	Z any
	A any
}

var boundCallCount int

func (*boundCallSentinel) Pos() syntax.Pos { boundCallCount++; return syntax.Pos{} }
func (*boundCallSentinel) End() syntax.Pos { boundCallCount++; return syntax.Pos{} }

func TestOccurrenceCollectionIsAtomicAndNeverCallsBounds(t *testing.T) {
	typ := reflect.TypeFor[boundCallSentinel]()
	nodeTypes[typ.Name()] = typ
	defer delete(nodeTypes, typ.Name())
	boundCallCount = 0
	bad := &boundCallSentinel{Z: int(1), A: make(chan bool)}
	data, nodes, err := AppendWithOccurrences([]byte("prefix"), bad)
	if string(data) != "prefix" || len(nodes) != 0 || errorText(err) != "boundCallSentinel.Z: unsupported syntax value int" {
		t.Fatalf("partial state escaped: %s %v %v", data, nodes, err)
	}
	good := &boundCallSentinel{}
	_, nodes, err = AppendWithOccurrences(nil, good)
	if err != nil || len(nodes) != 1 || nodes[0] != good {
		t.Fatalf("success after failure: %v %v", nodes, err)
	}
	if boundCallCount != 0 {
		t.Fatalf("collection called%d bound methods", boundCallCount)
	}
}

// A subprocess makes the malformed-cycle regression bounded even if an eager
// bounds call is accidentally introduced and recursively exhausts the Go stack.
func TestOccurrenceCollectionRejectsCycleWithoutBounds(t *testing.T) {
	if os.Getenv("SH_AST_OCCURRENCE_CYCLE_CHILD") == "1" {
		stmt := &syntax.Stmt{}
		stmt.Cmd = &syntax.BinaryCmd{X: stmt}
		data, nodes, err := AppendWithOccurrences(nil, stmt)
		if len(data) != 0 || len(nodes) != 0 || errorText(err) != "Stmt.Cmd: BinaryCmd.X: cyclic syntax value" {
			t.Fatalf("cycle: %s %v %v", data, nodes, err)
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestOccurrenceCollectionRejectsCycleWithoutBounds$")
	cmd.Env = append(os.Environ(), "SH_AST_OCCURRENCE_CYCLE_CHILD=1")
	if output, err := cmd.CombinedOutput(); err != nil {
		if len(output) > 1500 {
			output = output[:1500]
		}
		t.Fatalf("cycle did not terminate: %v %s", err, output)
	}
}
