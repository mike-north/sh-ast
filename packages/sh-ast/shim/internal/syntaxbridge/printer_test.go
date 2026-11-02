package syntaxbridge

import (
	"bytes"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

// Native printer calls are independent of transport and option decoding. They
// establish both ordinary errors and panic outcomes without converting one into
// the other; fixed source assertions below additionally pin intended edits.
func nativePrint(node syntax.Node, options ...syntax.PrinterOption) (output, kind, message string) {
	defer func() {
		if caught := recover(); caught != nil {
			kind, message = "PrintPanicError", fmt.Sprint(caught)
		}
	}()
	var buffer bytes.Buffer
	if err := syntax.NewPrinter(options...).Print(&buffer, node); err != nil {
		return "", "PrintError", err.Error()
	}
	return buffer.String(), "", ""
}

// printFixture retains native positions and comments without involving the codec.
func printFixture(t *testing.T, source string, options ...syntax.ParserOption) *syntax.File {
	t.Helper()
	file, err := syntax.NewParser(append([]syntax.ParserOption{syntax.KeepComments(true)}, options...)...).Parse(strings.NewReader(source), "print.sh")
	if err != nil {
		t.Fatal(err)
	}
	return file
}

// comparePrint checks the real operation against an independent native invocation.
func comparePrint(t *testing.T, node syntax.Node, options string, nativeOptions ...syntax.PrinterOption) string {
	t.Helper()
	encoded, err := syntaxwire.Encode(node)
	if err != nil {
		t.Fatal(err)
	}
	result := response(t, "print", string(encoded), options)
	wanted, kind, message := nativePrint(node, nativeOptions...)
	if kind != "" {
		failure, ok := result["Error"].(map[string]any)
		if !ok || failure["Kind"] != kind {
			t.Fatalf("error kind=%#v; native=%s", result, kind)
		}
		actualMessage, err := syntaxwire.ReadString(failure["Message"])
		if err != nil || actualMessage != message {
			t.Fatalf("message=%q %v; native=%q", actualMessage, err, message)
		}
		if _, present := result["Output"]; present {
			t.Fatal("failure must not invent a partial-writer output protocol")
		}
		return ""
	}
	if result["Error"] != nil {
		t.Fatalf("native print succeeds, bridge failed: %#v", result)
	}
	actual, err := syntaxwire.ReadString(result["Output"])
	if err != nil {
		t.Fatal(err)
	}
	if actual != wanted {
		t.Fatalf("bridge=%q; native=%q", actual, wanted)
	}
	return actual
}

func TestPrinterEverySupportedRootFamilyMatchesNative(t *testing.T) {
	found := make(map[string]syntax.Node)
	for _, variant := range []struct {
		name string
		lang syntax.LangVariant
	}{{"bash", syntax.LangBash}, {"zsh", syntax.LangZsh}, {"bats", syntax.LangBats}} {
		source, err := os.ReadFile("../../../test/fixtures/kitchen-sink." + variant.name + ".sh")
		if err != nil {
			t.Fatal(err)
		}
		file := printFixture(t, string(source), syntax.Variant(variant.lang))
		syntax.Walk(file, func(node syntax.Node) bool {
			if node != nil {
				name := reflect.TypeOf(node).Elem().Name()
				if found[name] == nil {
					found[name] = node
				}
			}
			return true
		})
	}
	braces := printFixture(t, "echo {a,b}").Stmts[0].Cmd.(*syntax.CallExpr).Args[1]
	if !syntax.SplitBraces(braces) {
		t.Fatal("upstream brace fixture must transform")
	}
	found["BraceExp"] = braces.Parts[0]
	// This list is transcribed from upstream Printer.Print's root switch and
	// the pinned Command/WordPart implementers, not generated schema metadata.
	supported := []string{"File", "Stmt", "Word", "Assign", "ArithmCmd", "BinaryCmd", "Block", "CallExpr", "CaseClause", "CoprocClause", "DeclClause", "ForClause", "FuncDecl", "IfClause", "LetClause", "Subshell", "TestClause", "TestDecl", "TimeClause", "WhileClause", "ArithmExp", "BraceExp", "CmdSubst", "DblQuoted", "ExtGlob", "Lit", "ParamExp", "ProcSubst", "SglQuoted"}
	for _, name := range supported {
		t.Run(name, func(t *testing.T) {
			node := found[name]
			if node == nil {
				t.Fatalf("missing independent %s fixture", name)
			}
			comparePrint(t, node, `{}`)
		})
	}
	// Every remaining concrete Node family is deliberately unsupported as a
	// root, even though these values can occur inside a printable tree.
	for _, name := range []string{"ArrayElem", "ArrayExpr", "BinaryArithm", "BinaryTest", "CStyleLoop", "CaseItem", "Comment", "FlagsArithm", "ParenArithm", "ParenTest", "Redirect", "UnaryArithm", "UnaryTest", "WordIter"} {
		t.Run("unsupported-"+name, func(t *testing.T) {
			node := found[name]
			if node == nil {
				t.Fatalf("missing %s fixture", name)
			}
			comparePrint(t, node, `{}`)
		})
	}
}

func TestPrinterOptionsMatchNativeAndPreserveExplicitDefaults(t *testing.T) {
	for _, fixture := range []struct {
		name, source, options string
		native                []syntax.PrinterOption
	}{
		{"Indent", "if true; then\necho hi\nfi\n", `{"Indent":2}`, []syntax.PrinterOption{syntax.Indent(2)}},
		{"BinaryNextLine", "echo a |\ncat\n", `{"BinaryNextLine":true}`, []syntax.PrinterOption{syntax.BinaryNextLine(true)}},
		{"SwitchCaseIndent", "case x in\na) echo a;;\nesac\n", `{"SwitchCaseIndent":true}`, []syntax.PrinterOption{syntax.SwitchCaseIndent(true)}},
		{"SpaceRedirects", "echo hi >out 2>&1\n", `{"SpaceRedirects":true}`, []syntax.PrinterOption{syntax.SpaceRedirects(true)}},
		{"KeepPadding", "echo   a\necho   longer\n", `{"KeepPadding":true}`, []syntax.PrinterOption{syntax.KeepPadding(true)}},
		{"Minify", "# keep 🎉\nif true; then\necho hi\nfi\n", `{"Minify":true}`, []syntax.PrinterOption{syntax.Minify(true)}},
		{"SingleLine", "{\necho a\necho b\n}\n", `{"SingleLine":true}`, []syntax.PrinterOption{syntax.SingleLine(true)}},
		{"FunctionNextLine", "f() { echo hi; }\n", `{"FunctionNextLine":true}`, []syntax.PrinterOption{syntax.FunctionNextLine(true)}},
		{"comments-heredoc-single", "# keep 🎉\ncat <<'EOF'\n你好 e\u0301\nEOF\necho done\n", `{"SingleLine":true}`, []syntax.PrinterOption{syntax.SingleLine(true)}},
		{"comments-heredoc-minify", "# skip\ncat <<'EOF'\n你好\nEOF\n", `{"Minify":true}`, []syntax.PrinterOption{syntax.Minify(true)}},
		{"combined", "f() {\ncase x in\na) echo a >out |\ncat;;\nesac\n}\n", `{"Indent":3,"KeepPadding":true,"SpaceRedirects":true,"FunctionNextLine":true,"SwitchCaseIndent":true,"BinaryNextLine":true}`, []syntax.PrinterOption{syntax.Indent(3), syntax.BinaryNextLine(true), syntax.SwitchCaseIndent(true), syntax.SpaceRedirects(true), syntax.KeepPadding(true), syntax.FunctionNextLine(true)}},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			file := printFixture(t, fixture.source)
			actual := comparePrint(t, file, fixture.options, fixture.native...)
			if fixture.name != "comments-heredoc-single" && fixture.name != "comments-heredoc-minify" && fixture.name != "combined" {
				plain, _, _ := nativePrint(file)
				if actual == plain {
					t.Fatal("fixture must exercise option effect, not only accept the key")
				}
			}
		})
	}
	file := printFixture(t, "# comment\nf() {\necho hi >out |\ncat\n}\n")
	defaults := `{"Indent":0,"BinaryNextLine":false,"SwitchCaseIndent":false,"SpaceRedirects":false,"KeepPadding":false,"Minify":false,"SingleLine":false,"FunctionNextLine":false}`
	comparePrint(t, file, defaults)
	comparePrint(t, file, `{"Indent":{"Int":"0"}}`, syntax.Indent(0))
	comparePrint(t, file, `{"Minify":true,"SingleLine":true}`, syntax.Minify(true), syntax.SingleLine(true))
	comparePrint(t, file, `{"SingleLine":true,"Minify":true}`, syntax.SingleLine(true), syntax.Minify(true))
	// The upstream incompatibility is checked before inspecting the root.
	comparePrint(t, (*syntax.Word)(nil), `{"Minify":true,"SingleLine":true}`, syntax.Minify(true), syntax.SingleLine(true))
	comparePrint(t, &syntax.File{}, `{"Indent":{"Int":"18446744073709551615"}}`, syntax.Indent(^uint(0)))
}

func TestPrinterEditsConstructedNodesBytesAndRecovery(t *testing.T) {
	file := printFixture(t, "# keep 🎉\nprintf '%s\\n' 'old 🎉'\n")
	call := file.Stmts[0].Cmd.(*syntax.CallExpr)
	call.Args[2].Parts[0].(*syntax.SglQuoted).Value = "new 🎉"
	output := comparePrint(t, file, `{}`)
	if output != "# keep 🎉\nprintf '%s\\n' 'new 🎉'\n" {
		t.Fatalf("edited argument lost: %q", output)
	}
	reparsed := printFixture(t, output).Stmts[0].Cmd.(*syntax.CallExpr)
	if len(reparsed.Args) != 3 || reparsed.Args[1].Parts[0].(*syntax.SglQuoted).Value != "%s\\n" || reparsed.Args[2].Parts[0].(*syntax.SglQuoted).Value != "new 🎉" {
		t.Fatal("edited output changed unrelated command meaning")
	}
	operator := printFixture(t, "echo left && echo 你好\n")
	operator.Stmts[0].Cmd.(*syntax.BinaryCmd).Op = syntax.OrStmt
	if actual := comparePrint(t, operator, `{}`); actual != "echo left || echo 你好\n" {
		t.Fatalf("operator edit lost: %q", actual)
	}
	constructed := &syntax.Word{Parts: []syntax.WordPart{&syntax.Lit{Value: "hello"}, &syntax.SglQuoted{Value: " 🎉"}}}
	if actual := comparePrint(t, constructed, `{}`); actual != "hello' 🎉'" {
		t.Fatalf("zero-position construction changed: %q", actual)
	}
	// New text is authoritative even when parsed ValueEnd retains its old span.
	stale := printFixture(t, "echo x\n").Stmts[0].Cmd.(*syntax.CallExpr).Args[1].Parts[0].(*syntax.Lit)
	stale.Value = "longer🎉"
	if actual := comparePrint(t, stale, `{}`); actual != "longer🎉" {
		t.Fatalf("printer sliced stale source bounds: %q", actual)
	}
	byteLiteral := &syntax.Lit{Value: string([]byte{'x', 0xfe})}
	if actual := comparePrint(t, byteLiteral, `{}`); actual != string([]byte{'x', 0xfe}) {
		t.Fatalf("byte value changed: %q", actual)
	}
	// Upstream's tabwriter uses 0xff as an internal escape byte and strips it.
	// Matching the native printer is the contract, not preserving input bytes
	// which upstream formatting itself consumes.
	if actual := comparePrint(t, &syntax.Lit{Value: string([]byte{'x', 0xff})}, `{}`); actual != "x" {
		t.Fatalf("upstream tabwriter escape semantics changed: %q", actual)
	}
	recovered := printFixture(t, "(foo |", syntax.RecoverErrors(2))
	comparePrint(t, recovered, `{}`)
	for _, node := range []syntax.Node{(*syntax.Word)(nil), (*syntax.Comment)(nil), &syntax.Word{}, &syntax.ParamExp{Short: true, Param: &syntax.Lit{Value: "a"}, Index: (*syntax.Word)(nil)}} {
		comparePrint(t, node, `{}`)
	}
	// New printer construction must not leak formatting flags between calls.
	comparePrint(t, file, `{"Minify":true}`, syntax.Minify(true))
	if actual := comparePrint(t, file, `{}`); actual != output {
		t.Fatal("printer options leaked across calls")
	}
	if actual := comparePrint(t, printFixture(t, "echo hi\n").Stmts[0], `{}`); actual != "echo hi" {
		t.Fatalf("Stmt incorrectly acquired File newline: %q", actual)
	}
}

func TestPrinterRejectsUnrepresentableInputWithoutChangingOptionDomains(t *testing.T) {
	encoded, err := syntaxwire.Encode(&syntax.File{})
	if err != nil {
		t.Fatal(err)
	}
	for _, options := range []string{`null`, `[]`, `{"Unknown":true}`, `{"Indent":-1}`, `{"Indent":1.5}`, `{"Indent":9007199254740992}`, `{"Indent":{"Int":"18446744073709551616"}}`, `{"Indent":{"Int":"-1"}}`, `{"Minify":"yes"}`, `{"KeepPadding":null}`} {
		result := response(t, "print", string(encoded), options)
		if failure, ok := result["Error"].(map[string]any); !ok || failure["Kind"] != "InputError" {
			t.Errorf("invalid options accepted: %s -> %#v", options, result)
		}
	}
	for _, payload := range []string{`null`, `[]`, `{"Type":"File"}`, `{"Type":"Slice","Offset":null,"Length":null}`, `{"Type":"TypedNil","Kind":"Missing"}`} {
		result := response(t, "print", payload, `{}`)
		if failure, ok := result["Error"].(map[string]any); !ok || failure["Kind"] != "InputError" {
			t.Errorf("invalid tree accepted: %s -> %#v", payload, result)
		}
	}
}
