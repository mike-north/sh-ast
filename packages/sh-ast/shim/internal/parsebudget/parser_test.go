package parsebudget

import (
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// The shared binding policy survives reset, cannot be disabled by options, and
// remains terminal under syntax recovery. No partial resource tree is returned.
func TestBudgetRefusalAndParserReuse(t *testing.T) {
	source := "echo $(( " + strings.Repeat("a[", 200) + "1" + strings.Repeat("]", 200) + " ))"
	for _, recoverErrors := range []int{0, 1, 100000} {
		parser := NewParser(syntax.RecoverErrors(recoverErrors), syntax.ParseNestingLimit(0))
		for i := 0; i < 20; i++ {
			file, err := parser.Parse(strings.NewReader(source), "budget.sh")
			failure, ok := err.(syntax.ParseDepthError)
			if !ok || file != nil || failure.MaxDepth != 128 || failure.Depth != 129 {
				t.Fatalf("expected terminal 128-unit resource refusal without File: file=%t err=%v", file != nil, err)
			}
			file, err = parser.Parse(strings.NewReader("echo alive"), "next.sh")
			if err != nil || file == nil || len(file.Stmts) != 1 {
				t.Fatalf("parser reset lost its reuse contract: %v", err)
			}
		}
	}
}

// Node work includes iterative construction, so a flat operator chain can exceed
// the budget even though its parser implementation does not recurse per operator.
func TestBudgetBoundaryAndDefaultOption(t *testing.T) {
	for _, count := range []int{125, 126} {
		source := "echo $(( " + strings.Repeat("1+", count) + "1 ))"
		_, err := NewParser().Parse(strings.NewReader(source), "")
		if count == 125 && err != nil {
			t.Fatalf("128 units must remain accepted: %v", err)
		}
		if count == 126 {
			if _, ok := err.(syntax.ParseDepthError); !ok {
				t.Fatalf("129 units must be refused: %v", err)
			}
		}
		// A parser without the binding policy keeps the official upstream limit.
		if _, err := syntax.NewParser(syntax.ParseNestingLimit(0)).Parse(strings.NewReader(source), ""); err != nil {
			t.Fatalf("zero option changed upstream acceptance: %v", err)
		}
	}
}
