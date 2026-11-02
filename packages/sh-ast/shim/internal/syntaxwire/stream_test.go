package syntaxwire

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"testing"
	"time"

	"eslint-sh-shim/internal/legacywiretest"
	"mvdan.cc/sh/v3/syntax"
)

// Full bytes are compared to a frozen map encoder; explicit anchors below also
// prevent agreement between implementations from hiding an incorrect contract.
func TestStreamingSyntaxMatchesFrozenEncoder(t *testing.T) {
	shared := &syntax.Lit{Value: "🎉中e\u0301<>&\x00\n\u2028\u2029"}
	fixtures := []any{nil, (*syntax.Word)(nil), &syntax.File{}, &syntax.File{Stmts: []*syntax.Stmt{}}, &syntax.Word{Parts: []syntax.WordPart{shared, shared, (*syntax.Lit)(nil), nil}}, &syntax.Lit{Value: "\xff\xfe"}, syntax.NewPos(2, 3, 4), []string{}, []string(nil), uint32(4294967295), true, "<>&"}
	cyclic := &syntax.Word{}
	cyclic.Parts = []syntax.WordPart{&syntax.DblQuoted{Parts: []syntax.WordPart{cyclicPart(cyclic)}}}
	// The command substitution points back to its containing Word through an arg.
	fixtures = append(fixtures, cyclic, struct{ Public string }{}, (*int)(nil), int(1), map[string]string{}, func() {})
	for _, fixture := range fixtures {
		got, err := Encode(fixture)
		want, wantErr := legacywiretest.Encode(fixture)
		if !bytes.Equal(got, want) || errorText(err) != errorText(wantErr) {
			t.Fatalf("%T: got %s / %v; want %s / %v", fixture, got, err, want, wantErr)
		}
	}
	for _, source := range []string{"# 中\necho hi", "(foo |", "echo ${a/b/c} ${a:1:2}", "cat <<EOF\n🎉\nEOF\n"} {
		root, _ := syntax.NewParser(syntax.KeepComments(true), syntax.RecoverErrors(2)).Parse(strings.NewReader(source), "\xff")
		got, err := Encode(root)
		want, wantErr := legacywiretest.Encode(root)
		if !bytes.Equal(got, want) || errorText(err) != errorText(wantErr) {
			t.Fatalf("source %q mismatch", source)
		}
	}
}

// cyclicPart closes a real syntax-pointer cycle without requiring custom nodes.
func cyclicPart(word *syntax.Word) syntax.WordPart {
	return &syntax.CmdSubst{Stmts: []*syntax.Stmt{{Cmd: &syntax.CallExpr{Args: []*syntax.Word{word}}}}}
}

// errorText compares only observable error messages, not concrete error wrappers.
func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// Synthetic registered records expose malformed kinds/private fields. They are
// local, nonparallel fixtures; restoring the registry avoids changing other tests.
func TestStreamingErrorsKeepDeclarationOrder(t *testing.T) {
	type malformed struct {
		Z      any
		A      any
		hidden bool
	}
	typ := reflect.TypeFor[malformed]()
	nodeTypes[typ.Name()] = typ
	defer delete(nodeTypes, typ.Name())
	cases := []struct {
		value malformed
		want  string
	}{
		{malformed{Z: int(1), A: make(chan int)}, "malformed.Z: unsupported syntax value int"},
		{malformed{Z: nil, A: make(chan int)}, "malformed.A: unsupported syntax value chan int"},
		{malformed{}, "unsupported private field syntaxwire.malformed.hidden"},
	}
	for _, c := range cases {
		data, err := Encode(c.value)
		if len(data) != 0 || errorText(err) != c.want {
			t.Fatalf("got %s %v; want %s", data, err, c.want)
		}
	}
}

// A child process bounds pathological graph tests without allowing a runaway
// recursive goroutine to outlive the test. Legacy hangs here and is not invoked.
func TestStreamingSliceCyclesTerminate(t *testing.T) {
	if os.Getenv("SH_AST_SLICE_CYCLE_CHILD") == "1" {
		s := make([]any, 1)
		s[0] = s
		left, right := make([]any, 1), make([]any, 1)
		left[0] = right
		right[0] = left
		mixed := make([]any, 1)
		mixed[0] = &mixed
		type replay struct {
			Z any
			A any
		}
		typ := reflect.TypeFor[replay]()
		nodeTypes[typ.Name()] = typ
		defer delete(nodeTypes, typ.Name())
		fixtures := []struct {
			value any
			want  string
		}{
			{s, "cyclic syntax value"}, {left, "cyclic syntax value"}, {mixed, "cyclic syntax value"},
			{replay{Z: s, A: int(1)}, "replay.Z: cyclic syntax value"},
		}
		for _, fixture := range fixtures {
			data, err := Encode(fixture.value)
			if len(data) != 0 || errorText(err) != fixture.want {
				t.Fatalf("got %s %v; want %s", data, err, fixture.want)
			}
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStreamingSliceCyclesTerminate$")
	cmd.Env = append(os.Environ(), "SH_AST_SLICE_CYCLE_CHILD=1")
	if output, err := cmd.CombinedOutput(); err != nil {
		if len(output) > 1500 {
			output = output[:1500]
		}
		t.Fatalf("slice cycle did not terminate with the contracted error: %v %s", err, output)
	}
}

// Repeated and overlapping slice views are not cycles. A visited-set would reject
// these DAGs, while path-local ancestry permits every independent occurrence.
func TestStreamingSliceAliasesAndEscaping(t *testing.T) {
	base := []any{"x", uint32(2)}
	overlap := make([]any, 2)
	overlap[1] = overlap[:1]
	values := []any{base, base, base[:1], base[:0], overlap}
	got, err := Encode(values)
	want, wantErr := legacywiretest.Encode(values)
	if !bytes.Equal(got, want) || errorText(err) != errorText(wantErr) {
		t.Fatalf("aliases: %s %v != %s %v", got, err, want, wantErr)
	}
	escaped, _ := Encode("<>&\x00\n\u2028\u2029")
	if string(escaped) != `"\u003c\u003e\u0026\u0000\n\u2028\u2029"` {
		t.Fatalf("escaping: %s", escaped)
	}
	if !json.Valid(got) {
		t.Fatal("invalid JSON")
	}
}

// Validation observes stored fields only, even when a scalar supplies methods
// that a generic JSON encoder or formatter could accidentally invoke.
type methodSentinel string

func (methodSentinel) MarshalJSON() ([]byte, error) { panic("user MarshalJSON invoked") }
func (methodSentinel) String() string               { panic("user String invoked") }

func TestStreamingNestedErrorsDoNotInvokeMethodsOrMutate(t *testing.T) {
	type nested struct {
		Z any
		A any
	}
	typ := reflect.TypeFor[nested]()
	nodeTypes[typ.Name()] = typ
	defer delete(nodeTypes, typ.Name())
	input := &nested{Z: &nested{Z: []any{methodSentinel("ok"), int64(1)}, A: make(chan bool)}, A: func() {}}
	beforeZ := input.Z
	beforeA := reflect.ValueOf(input.A).Pointer()
	for i := 0; i < 2; i++ {
		prefix := []byte("prefix")
		got, err := Append(prefix, input)
		if string(got) != "prefix" || errorText(err) != "nested.Z: nested.Z: unsupported syntax value int64" {
			t.Fatalf("got %s %v", got, err)
		}
		if input.Z != beforeZ || reflect.ValueOf(input.A).Pointer() != beforeA {
			t.Fatal("validation mutated graph")
		}
	}
}

// The readable-string fast path must agree with encoding/json for every ASCII
// character and fall back for escaping and Unicode separator edge cases.
func TestStreamingStringEscapingAllASCII(t *testing.T) {
	for ch := 0; ch < 128; ch++ {
		value := "prefix" + string(rune(ch)) + "suffix"
		got, err := Encode(value)
		want, _ := json.Marshal(value)
		if err != nil || !bytes.Equal(got, want) {
			t.Fatalf("ASCII %d: %s != %s (%v)", ch, got, want, err)
		}
	}
}
