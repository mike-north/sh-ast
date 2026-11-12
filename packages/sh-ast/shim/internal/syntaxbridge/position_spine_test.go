package syntaxbridge

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

// directBounds is the reference observation: Pos then End called on every
// occurrence on its own, each under its own recovery.
func directBounds(nodes []syntax.Node) []nodeBounds {
	bounds := make([]nodeBounds, len(nodes))
	observe := func(call func() syntax.Pos) (position syntaxwire.Position, failure *string) {
		defer func() {
			if caught := recover(); caught != nil {
				message := fmt.Sprintf("upstream node position: %v", caught)
				failure = &message
			}
		}()
		return syntaxwire.ObservePosition(call()), nil
	}
	for i, node := range nodes {
		bounds[i].pos, bounds[i].posError = observe(node.Pos)
		bounds[i].end, bounds[i].endError = observe(node.End)
	}
	return bounds
}

// equalBounds reports the first occurrence whose observations differ.
func equalBounds(t *testing.T, got, want []nodeBounds) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("observed %d occurrences, want %d", len(got), len(want))
	}
	text := func(s *string) string {
		if s == nil {
			return "<none>"
		}
		return *s
	}
	for i := range want {
		if got[i].pos != want[i].pos || got[i].end != want[i].end ||
			text(got[i].posError) != text(want[i].posError) || text(got[i].endError) != text(want[i].endError) {
			t.Fatalf("occurrence %d: got %+v (%s, %s), want %+v (%s, %s)", i,
				got[i], text(got[i].posError), text(got[i].endError),
				want[i], text(want[i].posError), text(want[i].endError))
		}
	}
}

// Sharing one start across an arithmetic spine must not change any observation:
// every occurrence's bounds equal a direct Pos/End call on that occurrence.
func TestSpineStartsMatchDirectBounds(t *testing.T) {
	for _, source := range []string{
		"echo $(( 1+2*3-4/5%6 ))",
		"echo $(( " + strings.Repeat("a+", 300) + "1 ))",
		"echo $(( (1+2)+(3+(4+5)) ))",
		"echo $(( -1+ +2 - -3, 4<<5|6&7^8 ))",
		"echo $(( a ? b+1 : c+2 )) $(( x+=1+2 ))",
		"let 'a=1+2+3' b=4+5; echo $[ 1+2+3 ]",
		"echo ${x:1+2:3+4} ${y[1+2+3]}",
		"echo $(( 1+$(( 2+3+4 ))+5 )) && echo $(( 6+7 ))",
		"echo $(( a++ + b-- + ++c ))",
		"echo $(( 1+1 ))\n# héllo 🙂\necho $(( 2+ 3 + 4 ))",
	} {
		file, err := syntax.NewParser().Parse(strings.NewReader(source), "")
		if err != nil {
			t.Fatalf("%q: %v", source, err)
		}
		_, nodes, err := syntaxwire.AppendParsedFile(nil, file, true)
		if err != nil {
			t.Fatalf("%q: %v", source, err)
		}
		equalBounds(t, observeBounds(nodes), directBounds(nodes))
	}
}

// arithmeticSpine builds `1+1+…+1` with n operators as a left-nested tree whose
// innermost X is leaf, returning the occurrences outermost first, as the writer
// queues them, followed by the leaf and every right operand.
func arithmeticSpine(n int, leaf syntax.ArithmExpr) []syntax.Node {
	operand := func(offset uint) *syntax.Word {
		pos := syntax.NewPos(offset, 1, offset+1)
		return &syntax.Word{Parts: []syntax.WordPart{&syntax.Lit{ValuePos: pos, ValueEnd: syntax.NewPos(offset+1, 1, offset+2), Value: "1"}}}
	}
	spine := make([]*syntax.BinaryArithm, n)
	var x = leaf
	for i := 0; i < n; i++ {
		offset := uint(2*i + 1)
		b := &syntax.BinaryArithm{OpPos: syntax.NewPos(offset, 1, offset+1), Op: syntax.Add, X: x, Y: operand(offset + 1)}
		spine[n-1-i] = b
		x = b
	}
	nodes := make([]syntax.Node, 0, 2*n+1)
	for _, b := range spine {
		nodes = append(nodes, b)
	}
	if leaf != nil {
		nodes = append(nodes, leaf)
	}
	for _, b := range spine {
		nodes = append(nodes, b.Y)
	}
	return nodes
}

// A spine whose innermost X is nil, or a typed nil BinaryArithm, panics on every
// spine occurrence's Pos, exactly as a direct call does, with the same message.
func TestSpineStartFailuresMatchDirectBounds(t *testing.T) {
	var typedNil *syntax.BinaryArithm
	for name, leaf := range map[string]syntax.ArithmExpr{
		"nil interface":          nil,
		"typed nil BinaryArithm": typedNil,
	} {
		t.Run(name, func(t *testing.T) {
			nodes := arithmeticSpine(50, leaf)
			want := directBounds(nodes)
			if want[0].posError == nil {
				t.Fatalf("fixture must make Pos fail")
			}
			equalBounds(t, observeBounds(nodes), want)
		})
	}
	// A well-formed spine shares the leaf's start with every operator.
	leaf := &syntax.Word{Parts: []syntax.WordPart{&syntax.Lit{ValuePos: syntax.NewPos(0, 1, 1), ValueEnd: syntax.NewPos(1, 1, 2), Value: "1"}}}
	nodes := arithmeticSpine(50, leaf)
	equalBounds(t, observeBounds(nodes), directBounds(nodes))
}

// Observing every occurrence of an n-operator spine is linear: a direct Pos per
// operator would walk the spine again each time, about n²/2 steps (2×10¹⁰ here).
func TestSpineStartsAreObservedInLinearTime(t *testing.T) {
	const operators = 200_000
	leaf := &syntax.Word{Parts: []syntax.WordPart{&syntax.Lit{ValuePos: syntax.NewPos(0, 1, 1), ValueEnd: syntax.NewPos(1, 1, 2), Value: "1"}}}
	nodes := arithmeticSpine(operators, leaf)
	done := make(chan []nodeBounds, 1)
	go func() { done <- observeBounds(nodes) }()
	select {
	case bounds := <-done:
		start := syntaxwire.ObservePosition(leaf.Pos())
		for i := 0; i < operators; i++ {
			if bounds[i].pos != start || bounds[i].posError != nil {
				t.Fatalf("operator %d starts at %+v, want the leaf's %+v", i, bounds[i].pos, start)
			}
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("observing a %d-operator spine did not finish in 10s", operators)
	}
}
