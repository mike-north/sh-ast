// Reverse-subscript patterns preserve literal bracket structure and nested
// executable syntax without arithmetic rewriting, independently of WASM.
package syntaxbridge

import (
	"bytes"
	"reflect"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// Handwritten spelling and node expectations specify the native parser contract.
func TestZshSubscriptPattern(t *testing.T) {
	for _, pattern := range []string{`foo`, `foo\]bar`, `foo[0-9]`, `foo[[:digit:]]`, `$(printf foo)`, `$needle`, `foo*`, `$(printf foo)[0-9]`} {
		for _, quoted := range []bool{false, true} {
			source := "${a[(r)" + pattern + "]}"
			if quoted {
				source = `"` + source + `"`
			}
			source = "echo " + source + "\n"
			t.Run(source, func(t *testing.T) {
				file, err := syntax.NewParser(syntax.Variant(syntax.LangZsh)).Parse(strings.NewReader(source), "")
				if err != nil {
					t.Fatal(err)
				}
				commands := []string{}
				params := []string{}
				substitutions := 0
				syntax.Walk(file, func(node syntax.Node) bool {
					switch node := node.(type) {
					case *syntax.CallExpr:
						commands = append(commands, node.Args[0].Lit())
					case *syntax.CmdSubst:
						substitutions++
					case *syntax.ParamExp:
						params = append(params, node.Param.Value)
					}
					return true
				})
				wantCommands := []string{"echo"}
				wantSubstitutions := 0
				if strings.Contains(pattern, "$(") {
					wantCommands = append(wantCommands, "printf")
					wantSubstitutions = 1
				}
				if !reflect.DeepEqual(commands, wantCommands) || substitutions != wantSubstitutions {
					t.Errorf("commands=%v substitutions=%d; want %v and %d", commands, substitutions, wantCommands, wantSubstitutions)
				}
				wantParams := []string{"a"}
				if pattern == "$needle" {
					wantParams = append(wantParams, "needle")
				}
				if !reflect.DeepEqual(params, wantParams) {
					t.Errorf("parameters=%v; want %v", params, wantParams)
				}
				for _, padding := range []bool{false, true} {
					var out bytes.Buffer
					if err := syntax.NewPrinter(syntax.KeepPadding(padding)).Print(&out, file); err != nil {
						t.Fatal(err)
					}
					if out.String() != source {
						t.Errorf("padding=%v print=%q; want %q", padding, out.String(), source)
					}
				}
			})
		}
	}
}
