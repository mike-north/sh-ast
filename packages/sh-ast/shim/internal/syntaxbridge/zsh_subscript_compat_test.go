package syntaxbridge

// Reverse-subscript compatibility restores pre-pin expansion visibility, while
// deliberately retaining its arithmetic grammar ceiling rather than adding a
// separate pattern reader. Public tests name the corresponding printing limits.
import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// Executed commands and expanded parameters must remain syntax nodes with source
// byte bounds, including when a multibyte argument precedes the substitution.
func TestZshSubscriptCompatExpansions(t *testing.T) {
	for _, fixture := range []struct {
		source     string
		start, end uint
		command    bool
	}{
		{"echo ${a[(r)$(printf foo)]}\n", 12, 25, true},
		{"echo \"${a[(r)$(printf foo)]}\"\n", 13, 26, true},
		{"echo é \"${a[(r)$(printf foo)]}\"\n", 16, 29, true},
		{"echo ${a[(r)$needle]}\n", 12, 19, false},
		{"echo \"${a[(r)$needle]}\"\n", 13, 20, false},
	} {
		t.Run(fixture.source, func(t *testing.T) {
			file, err := syntax.NewParser(syntax.Variant(syntax.LangZsh)).Parse(strings.NewReader(fixture.source), "")
			if err != nil {
				t.Fatal(err)
			}
			var found []syntax.Node
			var commands []string
			syntax.Walk(file, func(node syntax.Node) bool {
				switch n := node.(type) {
				case *syntax.CmdSubst:
					if fixture.command {
						found = append(found, n)
					}
				case *syntax.ParamExp:
					if !fixture.command && n.Param != nil && n.Param.Value == "needle" {
						found = append(found, n)
					}
				case *syntax.CallExpr:
					commands = append(commands, n.Args[0].Lit())
				}
				return true
			})
			if len(found) != 1 {
				t.Fatalf("expected one visible expansion, got %d", len(found))
			}
			if found[0].Pos().Offset() != fixture.start || found[0].End().Offset() != fixture.end {
				t.Fatalf("expansion span = %d:%d, want %d:%d", found[0].Pos().Offset(), found[0].End().Offset(), fixture.start, fixture.end)
			}
			want := "echo"
			if fixture.command {
				want = "echo,printf"
			}
			if strings.Join(commands, ",") != want {
				t.Fatalf("command inventory = %v, want %s", commands, want)
			}
			for _, padding := range []bool{false, true} {
				var output bytes.Buffer
				if err := syntax.NewPrinter(syntax.KeepPadding(padding)).Print(&output, file); err != nil {
					t.Fatal(err)
				}
				if output.String() != fixture.source {
					t.Fatalf("printed %q, want %q", output.String(), fixture.source)
				}
			}
		})
	}
}

// Refusals are measured pre-pin limits, not assertions that these forms are
// invalid Zsh. Reusing the same native parser must clear ordinary error state.
func TestZshSubscriptCompatNamedLimitRefusals(t *testing.T) {
	parser := syntax.NewParser(syntax.Variant(syntax.LangZsh))
	for _, source := range []string{
		"echo ${a[(r)foo*]}\n",
		"a=(other \"don't-panic\"); echo \"${a[(r)don't*]}\"\n",
		"a=(other \"don't-panic\"); echo ${(U)\"${a[(r)don't*]}\"}\n",
		"echo \"${a[(r)$'foo]}\"\n",
	} {
		if _, err := parser.Parse(strings.NewReader(source), ""); err == nil {
			t.Errorf("NAMED LIMIT: expected pre-pin refusal for %q", source)
		}
		if _, err := parser.Parse(strings.NewReader("echo alive"), ""); err != nil {
			t.Fatal(err)
		}
	}
}

// Deep substitutions must consume the native budget even inside a reverse
// subscript. Recovery must not expose a partial File or resume after refusal.
func TestZshSubscriptCompatTerminalBudget(t *testing.T) {
	source := "echo ${a[(r)" + strings.Repeat("$(", 200) + "printf foo" + strings.Repeat(")", 200) + "]}"
	for _, operation := range []string{"parse", "parse-with-positions"} {
		for _, options := range []string{`{"Variant":16}`, `{"Variant":16,"RecoverErrors":100000}`} {
			result := response(t, operation, source, options)
			failure, ok := result["Error"].(map[string]any)
			if len(result) != 1 || !ok || failure["Kind"] != "ParseDepthError" || failure["MaxDepth"] != json.Number("128") {
				t.Fatalf("expected terminal resource refusal, got %#v", result)
			}
			if later := response(t, operation, "echo ${a[(r)$(printf foo)]}", options); later["Error"] != nil || later["File"] == nil {
				t.Fatalf("parser unavailable after refusal: %#v", later)
			}
		}
	}
}
