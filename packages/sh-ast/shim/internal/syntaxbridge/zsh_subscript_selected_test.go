// The selected v3.14.1 syntax representation keeps reverse-subscript patterns
// opaque. Binding tests must preserve that representation, not improve analysis
// visibility by asking a different grammar to parse the pattern as arithmetic.
package syntaxbridge

import (
	"bytes"
	"reflect"
	"strings"
	"testing"

	"eslint-sh-shim/internal/parsebudget"
	"mvdan.cc/sh/v3/syntax"
)

func TestSelectedZshPatternRepresentation(t *testing.T) {
	for _, pattern := range []string{"foo*", "$(printf foo)", "$needle", "don't*", "(r)" + strings.Repeat("(r)", 198) + "foo"} {
		source := "echo é ${a[(r)" + pattern + "]}\n"
		file, err := syntax.NewParser(syntax.Variant(syntax.LangZsh)).Parse(strings.NewReader(source), "pattern.sh")
		if err != nil {
			t.Fatal(err)
		}
		var expansions, commands int
		var raw *syntax.Lit
		syntax.Walk(file, func(node syntax.Node) bool {
			switch node := node.(type) {
			case *syntax.CmdSubst:
				expansions++
			case *syntax.CallExpr:
				commands++
			case *syntax.Lit:
				if node.Value == pattern {
					raw = node
				}
			}
			return true
		})
		if expansions != 0 || commands != 1 || raw == nil {
			t.Fatalf("opaque pattern lost: expansions=%d commands=%d raw=%v", expansions, commands, raw)
		}
		if raw.Pos().Offset() != 15 || raw.End().Offset() != uint(15+len(pattern)) {
			t.Fatalf("raw byte bounds = %d:%d", raw.Pos().Offset(), raw.End().Offset())
		}
		for _, padding := range []bool{false, true} {
			var output bytes.Buffer
			if err := syntax.NewPrinter(syntax.KeepPadding(padding)).Print(&output, file); err != nil {
				t.Fatal(err)
			}
			if output.String() != source {
				t.Fatalf("selected printer = %q, want %q", output.String(), source)
			}
		}
		// Compare the full transported File with an independent native parse,
		// preserving opaque bytes and fields instead of only counting nodes.
		actual := response(t, "parse", source, `{"Variant":16,"Filename":"pattern.sh"}`)
		if !reflect.DeepEqual(file, fileFromResponse(t, actual)) {
			t.Fatal("bridge changed selected pattern records")
		}
	}
}

func TestSelectedRawPatternDoesNotSpendRecursiveWork(t *testing.T) {
	// These are bytes in one opaque pattern, not recursive syntax nodes. Other
	// resource tests continue to exercise actual nested statement/word work.
	for _, pattern := range []string{strings.Repeat("(r)", 200) + "foo", strings.Repeat("$(", 200) + "printf foo" + strings.Repeat(")", 200)} {
		source := "echo ${a[(r)" + pattern + "]}"
		for _, recovery := range []int{0, 100000} {
			parser := parsebudget.NewParser(syntax.Variant(syntax.LangZsh), syntax.RecoverErrors(recovery))
			file, err := parser.Parse(strings.NewReader(source), "raw.sh")
			if err != nil || file == nil {
				t.Fatalf("opaque text became recursive work: %v", err)
			}
			if _, err := parser.Parse(strings.NewReader("echo alive"), "reuse.sh"); err != nil {
				t.Fatal(err)
			}
		}
	}
}
