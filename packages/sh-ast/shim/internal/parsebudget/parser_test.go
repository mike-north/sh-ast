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

// Flat operator chains are sequences, not nesting: the parser builds them
// iteratively and charges no units for their length (sh-ast#105). Parentheses
// around a chain are nesting. In `echo $(( ( … ( chain ) … ) ))` with k
// parentheses, the statement, the `$((` word part and the expansion's expression
// each take one unit and every parenthesis one more, while literals and binary
// operators take none: 3+k units. So 125 parentheses use exactly the 128-unit
// budget and 126 need a 129th, however long the chain inside them is.
func TestBudgetIgnoresFlatChainsAndKeepsNesting(t *testing.T) {
	parse := func(parser *syntax.Parser, source string) error {
		_, err := parser.Parse(strings.NewReader(source), "")
		return err
	}
	long := strings.Repeat("1+", 20_000) + "1"
	for _, source := range []string{
		"echo $(( " + long + " ))",
		"true" + strings.Repeat(" && true", 20_000),
		"true" + strings.Repeat(" || true", 20_000),
		"true" + strings.Repeat(" | true", 20_000),
	} {
		if err := parse(NewParser(), source); err != nil {
			t.Fatalf("a flat chain must not consume the binding budget: %v", err)
		}
		// A parser without the binding policy keeps the official upstream limit,
		// which flat chains do not consume either.
		if err := parse(syntax.NewParser(syntax.ParseNestingLimit(0)), source); err != nil {
			t.Fatalf("zero option refused a flat chain: %v", err)
		}
	}

	nested := func(depth int, chain string) string {
		return "echo $(( " + strings.Repeat("( ", depth) + chain + strings.Repeat(" )", depth) + " ))"
	}
	for _, chain := range []string{"1", "1+1", long} {
		if err := parse(NewParser(), nested(125, chain)); err != nil {
			t.Fatalf("128 units must remain accepted (chain of %d bytes): %v", len(chain), err)
		}
		err := parse(NewParser(), nested(126, chain))
		failure, ok := err.(syntax.ParseDepthError)
		if !ok || failure.MaxDepth != MaxDepth || failure.Depth != MaxDepth+1 {
			t.Fatalf("129 units must be refused (chain of %d bytes): %v", len(chain), err)
		}
	}
}
