package syntaxwire

import (
	"bytes"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// The inventory oracle reads the pinned upstream source, independently of the
// registry and repository schema generator. Each exported struct in nodes.go must
// reconstruct with every zero field intact, including auxiliary non-Node roots.
func TestRegistryCoversUpstreamExportedStructs(t *testing.T) {
	function := runtime.FuncForPC(reflect.ValueOf(syntax.NewPos).Pointer())
	filename, _ := function.FileLine(function.Entry())
	file, err := parser.ParseFile(token.NewFileSet(), filename, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	ast.Inspect(file, func(node ast.Node) bool {
		spec, ok := node.(*ast.TypeSpec)
		if !ok || !spec.Name.IsExported() || spec.Name.Name == "Pos" {
			return true
		}
		if _, ok := spec.Type.(*ast.StructType); !ok {
			return true
		}
		count++
		typ := nodeTypes[spec.Name.Name]
		if typ == nil {
			t.Errorf("upstream struct %s is missing from the codec", spec.Name.Name)
			return true
		}
		original := reflect.New(typ).Interface()
		encoded, err := Encode(original)
		if err != nil {
			t.Error(err)
			return true
		}
		decoded, err := Decode(encoded)
		if err != nil {
			t.Error(err)
			return true
		}
		if !reflect.DeepEqual(original, decoded) {
			t.Errorf("zero fields changed for %s", spec.Name.Name)
		}
		return true
	})
	if count != len(nodeTypes) {
		t.Errorf("upstream has %d exported AST structs; codec has %d", count, len(nodeTypes))
	}
}

// Independent upstream struct values are the oracle: no expected tree is derived
// from the production registry, a schema generator, or typedjson's omission rules.
func TestEncodeKeepsAllFieldsAndDistinguishesNilAndEmpty(t *testing.T) {
	file := &syntax.File{Name: "", Stmts: []*syntax.Stmt{}, Last: nil}
	encoded, err := Encode(file)
	if err != nil {
		t.Fatal(err)
	}
	const expected = `{"Last":null,"Name":"","Stmts":[],"Type":"File"}`
	if string(encoded) != expected {
		t.Fatalf("got %s; want %s", encoded, expected)
	}
	decoded, err := DecodeNode(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decoded, file) {
		t.Fatalf("nil/empty changed: %#v", decoded)
	}
}

func TestPositionAndArbitraryStringRoundTrip(t *testing.T) {
	file, err := syntax.NewParser(syntax.RecoverErrors(2)).Parse(strings.NewReader("(foo |"), "")
	if err != nil {
		t.Fatal(err)
	}
	recovered := file.Stmts[0].Cmd.(*syntax.Subshell).Rparen
	for _, position := range []syntax.Pos{{}, syntax.NewPos(7, 0, 0), syntax.NewPos(12, 1, 13), recovered} {
		original := &syntax.Lit{ValuePos: position, ValueEnd: position, Value: string([]byte{'x', 0xff})}
		encoded, err := Encode(original)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(encoded, []byte(`"Value":{"Bytes":"eP8="}`)) {
			t.Fatalf("string bytes lost: %s", encoded)
		}
		if bytes.Contains(encoded, []byte(`"End":`)) || bytes.Contains(encoded, []byte(`"Pos":`)) {
			t.Fatalf("computed bounds must not become stored fields: %s", encoded)
		}
		decoded, err := DecodeNode(encoded)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(decoded, original) {
			t.Fatalf("position/string changed: %s", encoded)
		}
	}
}

func TestUint32OperatorsArePreservedWithoutInventingSemanticValidation(t *testing.T) {
	for _, op := range []syntax.BinCmdOperator{0, syntax.AndStmt, syntax.BinCmdOperator(0xffffffff)} {
		original := &syntax.BinaryCmd{Op: op}
		encoded, err := Encode(original)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := DecodeNode(encoded)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(decoded, original) {
			t.Fatalf("operator changed: %s", encoded)
		}
	}
}

func TestRoundTripMatchesNativeStructsAndPrivatePrinting(t *testing.T) {
	fixtures := []struct {
		name    string
		variant syntax.LangVariant
		source  string
	}{
		{"empty", syntax.LangBash, ""},
		{"comments", syntax.LangBash, "# only\n"},
		{"unicode", syntax.LangBash, "echo \"🎉\" 你好 é\r\n"},
		{"empty-values", syntax.LangBash, "echo '' ${a:-}\n"},
		{"heredoc", syntax.LangBash, "cat <<'EOF'\n🎉\nEOF\n"},
	}
	for _, name := range []string{"bash", "zsh", "bats"} {
		data, err := os.ReadFile("../../../test/fixtures/kitchen-sink." + name + ".sh")
		if err != nil {
			t.Fatal(err)
		}
		var variant syntax.LangVariant
		if err := variant.Set(name); err != nil {
			t.Fatal(err)
		}
		fixtures = append(fixtures, struct {
			name    string
			variant syntax.LangVariant
			source  string
		}{name, variant, string(data)})
	}
	for _, fixture := range fixtures {
		t.Run(fixture.name, func(t *testing.T) {
			original, err := syntax.NewParser(syntax.Variant(fixture.variant), syntax.KeepComments(true)).Parse(strings.NewReader(fixture.source), fixture.name)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := Encode(original)
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := DecodeNode(encoded)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(original, decoded) {
				t.Fatal("public upstream struct values changed across the wire")
			}
			var before, after bytes.Buffer
			if err := syntax.NewPrinter().Print(&before, original); err != nil {
				t.Fatal(err)
			}
			if err := syntax.NewPrinter().Print(&after, decoded); err != nil {
				t.Fatal(err)
			}
			if before.String() != after.String() {
				t.Fatal("private upstream printing changed across the wire")
			}
		})
	}
}

// Edited values, not cached source or parse-time snapshots, must reach upstream
// printing after reconstruction. The native comparison and fixed expected source
// separately establish codec fidelity and the intended edit, including Unicode.
func TestEditedTreeRoundTripMatchesNativePrintingAndMeaning(t *testing.T) {
	const source = "# keep 🎉 e\u0301\necho old && echo 你好\n"
	const expected = "# keep 🎉 e\u0301\necho new🎉 || echo 你好\n"
	parse := func(source string) *syntax.File {
		t.Helper()
		file, err := syntax.NewParser(syntax.KeepComments(true)).Parse(strings.NewReader(source), "edited.sh")
		if err != nil {
			t.Fatal(err)
		}
		return file
	}
	print := func(node syntax.Node) string {
		t.Helper()
		var output bytes.Buffer
		if err := syntax.NewPrinter().Print(&output, node); err != nil {
			t.Fatal(err)
		}
		return output.String()
	}
	original := parse(source)
	originalOutput := print(original)
	if originalOutput != source || originalOutput == expected {
		t.Fatal("unchanged source must print unchanged and cannot satisfy the edited expectation")
	}
	encoded, err := Encode(original)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeNode(encoded)
	if err != nil {
		t.Fatal(err)
	}
	// Mutate the reconstructed public structs before a second wire transfer.
	// The longer literal deliberately leaves its parse-time ValueEnd unchanged;
	// the native printer must honor the edited text rather than source slicing.
	edited := decoded.(*syntax.File)
	editedBinary := edited.Stmts[0].Cmd.(*syntax.BinaryCmd)
	editedBinary.Op = syntax.OrStmt
	editedBinary.X.Cmd.(*syntax.CallExpr).Args[1].Parts[0].(*syntax.Lit).Value = "new🎉"
	editedWire, err := Encode(edited)
	if err != nil {
		t.Fatal(err)
	}
	reconstructed, err := DecodeNode(editedWire)
	if err != nil {
		t.Fatal(err)
	}
	// This independent parser instance never passes through the codec. Its
	// separately edited structs are the native upstream printer oracle.
	native := parse(source)
	nativeBinary := native.Stmts[0].Cmd.(*syntax.BinaryCmd)
	nativeBinary.Op = syntax.OrStmt
	nativeBinary.X.Cmd.(*syntax.CallExpr).Args[1].Parts[0].(*syntax.Lit).Value = "new🎉"
	actual, nativeOutput := print(reconstructed), print(native)
	if actual != nativeOutput {
		t.Fatalf("edited codec output %q differs from native output %q", actual, nativeOutput)
	}
	if actual != expected {
		t.Fatalf("edited output %q; want independently specified source %q", actual, expected)
	}
	if print(original) != originalOutput {
		t.Fatal("editing the decoded tree changed the original parser result")
	}
	// Reparse meaning is asserted from the intended command, operator and
	// retained comment/literal values, not from either edited tree's fields.
	reparsed := parse(actual)
	if len(reparsed.Stmts) != 1 || len(reparsed.Stmts[0].Comments) != 1 || reparsed.Stmts[0].Comments[0].Text != " keep 🎉 e\u0301" {
		t.Fatal("edited output lost the statement or its original Unicode comment")
	}
	binary := reparsed.Stmts[0].Cmd.(*syntax.BinaryCmd)
	if binary.Op != syntax.OrStmt {
		t.Fatal("edited output did not reparse as an OR command")
	}
	left, right := binary.X.Cmd.(*syntax.CallExpr), binary.Y.Cmd.(*syntax.CallExpr)
	if len(left.Args) != 2 || len(right.Args) != 2 ||
		left.Args[0].Parts[0].(*syntax.Lit).Value != "echo" ||
		left.Args[1].Parts[0].(*syntax.Lit).Value != "new🎉" ||
		right.Args[0].Parts[0].(*syntax.Lit).Value != "echo" ||
		right.Args[1].Parts[0].(*syntax.Lit).Value != "你好" {
		t.Fatal("edited output did not retain the intended command arguments")
	}
}

// A typed-nil interface compares non-nil and can affect an upstream method
// without affecting another. The tag preserves that dynamic type instead of
// dropping the value or rejecting otherwise meaningful operations.
func TestTypedNilInterfacesRetainDynamicTypeAndIndependentBounds(t *testing.T) {
	fixtures := []struct {
		name      string
		node      syntax.Node
		position  syntax.Pos
		end       syntax.Pos
		endPanics bool
	}{
		{"exact-review-parameter", &syntax.ParamExp{Short: true, Param: &syntax.Lit{ValueEnd: syntax.NewPos(3, 1, 4)}, Index: (*syntax.Word)(nil)}, syntax.Pos{}, syntax.Pos{}, true},
		{"short-parameter", &syntax.ParamExp{Dollar: syntax.NewPos(7, 2, 3), Short: true, Param: &syntax.Lit{ValueEnd: syntax.NewPos(10, 2, 6)}, Index: (*syntax.Word)(nil)}, syntax.NewPos(7, 2, 3), syntax.Pos{}, true},
		{"long-parameter", &syntax.ParamExp{Dollar: syntax.NewPos(7, 2, 3), Rbrace: syntax.NewPos(12, 2, 8), Index: (*syntax.Word)(nil)}, syntax.NewPos(7, 2, 3), syntax.NewPos(13, 2, 9), false},
		{"statement", &syntax.Stmt{Position: syntax.NewPos(5, 1, 6), Cmd: (*syntax.CallExpr)(nil)}, syntax.NewPos(5, 1, 6), syntax.Pos{}, true},
		{"terminated-statement", &syntax.Stmt{Position: syntax.NewPos(5, 1, 6), Semicolon: syntax.NewPos(9, 1, 10), Cmd: (*syntax.CallExpr)(nil)}, syntax.NewPos(5, 1, 6), syntax.NewPos(10, 1, 11), false},
		{"loop", &syntax.ForClause{ForPos: syntax.NewPos(0, 1, 1), DonePos: syntax.NewPos(15, 1, 16), Loop: (*syntax.WordIter)(nil)}, syntax.NewPos(0, 1, 1), syntax.NewPos(19, 1, 20), false},
		{"test", &syntax.UnaryTest{OpPos: syntax.NewPos(3, 1, 4), X: (*syntax.Word)(nil)}, syntax.NewPos(3, 1, 4), syntax.Pos{}, true},
		{"quoted-parts", &syntax.DblQuoted{Left: syntax.NewPos(0, 1, 1), Right: syntax.NewPos(3, 1, 4), Parts: []syntax.WordPart{(*syntax.Lit)(nil)}}, syntax.NewPos(0, 1, 1), syntax.NewPos(4, 1, 5), false},
	}
	for _, fixture := range fixtures {
		t.Run(fixture.name, func(t *testing.T) {
			encoded, err := Encode(fixture.node)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Contains(encoded, []byte(`"Type":"TypedNil"`)) {
				t.Fatalf("dynamic nil was not tagged: %s", encoded)
			}
			decoded, err := DecodeNode(encoded)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(fixture.node, decoded) {
				t.Fatal("interface dynamic type or nil pointer changed")
			}
			for _, node := range []syntax.Node{fixture.node, decoded} {
				if got := node.Pos(); got != fixture.position {
					t.Fatalf("Pos=%v; want independent expected position %v", got, fixture.position)
				}
				var got syntax.Pos
				panicked := false
				func() {
					defer func() { panicked = recover() != nil }()
					got = node.End()
				}()
				if panicked != fixture.endPanics || !panicked && got != fixture.end {
					t.Fatalf("End=%v panic=%v; want End=%v panic=%v", got, panicked, fixture.end, fixture.endPanics)
				}
			}
		})
	}
	// Ordinary nil has a distinct successful End path for the exact review case.
	ordinaryNil := &syntax.ParamExp{Short: true, Param: &syntax.Lit{ValueEnd: syntax.NewPos(3, 1, 4)}}
	if ordinaryNil.End() != syntax.NewPos(3, 1, 4) {
		t.Fatal("ordinary nil must remain distinguishable from the typed-nil index")
	}
}

// Roots enter through a Go interface too; their dynamic nil pointer type must
// survive even when their own methods cannot run without dereferencing it.
func TestTypedNilNodeRootRoundTrip(t *testing.T) {
	var original syntax.Node = (*syntax.Word)(nil)
	encoded, err := Encode(original)
	if err != nil {
		t.Fatal(err)
	}
	const expected = `{"Kind":"Word","Type":"TypedNil"}`
	if string(encoded) != expected {
		t.Fatalf("typed-nil root=%s; want %s", encoded, expected)
	}
	decoded, err := DecodeNode(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if decoded == nil || reflect.TypeOf(decoded) != reflect.TypeFor[*syntax.Word]() || !reflect.ValueOf(decoded).IsNil() {
		t.Fatalf("root dynamic type changed: %T", decoded)
	}
}

// Tags are accepted only in an interface-compatible context. Concrete pointer
// fields keep ordinary nulls, and a marker cannot impersonate an arbitrary Node.
func TestTypedNilTagsRejectMalformedOrIncompatibleTypes(t *testing.T) {
	for _, input := range []string{
		`{"Type":"TypedNil"}`, `{"Type":"TypedNil","Kind":"Missing"}`,
		`{"Type":"TypedNil","Kind":42}`, `{"Type":"TypedNil","Kind":"Word","Extra":true}`,
		`{"Type":"TypedNil","Kind":"Slice"}`,
	} {
		if _, err := DecodeNode([]byte(input)); err == nil {
			t.Errorf("accepted invalid Node root tag %s", input)
		}
	}
	for _, fixture := range []struct {
		node  syntax.Node
		field string
		kind  string
	}{
		{&syntax.ParamExp{}, "Index", "CallExpr"},
		{&syntax.Stmt{}, "Cmd", "Word"},
		{&syntax.ParamExp{}, "Param", "Lit"},
	} {
		encoded, err := Encode(fixture.node)
		if err != nil {
			t.Fatal(err)
		}
		value, err := ReadJSON(encoded)
		if err != nil {
			t.Fatal(err)
		}
		value.(map[string]any)[fixture.field] = map[string]any{"Type": "TypedNil", "Kind": fixture.kind}
		malformed, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := DecodeNode(malformed); err == nil {
			t.Errorf("accepted typed-nil %s in incompatible %T.%s", fixture.kind, fixture.node, fixture.field)
		}
	}
}

// Nil interface fields, nil interface elements, and nil concrete pointer elements
// have direct null representations; tagging typed-nil interfaces must not change
// these ordinary nil values or turn an empty collection into a nil collection.
func TestOrdinaryNilFieldsAndSliceElementsStillRoundTrip(t *testing.T) {
	if encoded, err := Encode(nil); err != nil || string(encoded) != "null" {
		t.Fatalf("untyped nil root must remain null: %s %v", encoded, err)
	}
	fixtures := []syntax.Node{
		&syntax.ParamExp{Short: true, Param: &syntax.Lit{ValueEnd: syntax.NewPos(3, 1, 4)}, Index: nil},
		&syntax.Stmt{Cmd: nil},
		&syntax.Word{Parts: []syntax.WordPart{nil}},
		&syntax.File{Stmts: []*syntax.Stmt{nil}, Last: []syntax.Comment{}},
		&syntax.CallExpr{Args: []*syntax.Word{nil}, Assigns: nil},
	}
	for _, original := range fixtures {
		encoded, err := Encode(original)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := DecodeNode(encoded)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(original, decoded) {
			t.Fatalf("ordinary nil boundaries changed for %T: %s", original, encoded)
		}
	}
}

func TestDecodeRejectsMalformedRepresentations(t *testing.T) {
	valid, err := Encode(&syntax.BinaryCmd{})
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{
		`null`, `[]`, `{"Type":"Missing"}`, `{"Type":"File"}`, string(valid) + ` {}`,
		strings.Replace(string(valid), `"Op":0`, `"Op":-1`, 1),
		strings.Replace(string(valid), `"Op":0`, `"Op":4294967296`, 1),
		strings.Replace(string(valid), `"Op":0`, `"Op":0.5`, 1),
		strings.Replace(string(valid), `"X":null`, `"X":{"Type":"File","Name":"","Stmts":null,"Last":null}`, 1),
	} {
		if _, err := DecodeNode([]byte(input)); err == nil {
			t.Errorf("accepted invalid wire value %s", input)
		}
	}
	var obj map[string]any
	if err := json.Unmarshal(valid, &obj); err != nil {
		t.Fatal(err)
	}
	obj["Extra"] = true
	data, _ := json.Marshal(obj)
	if _, err := DecodeNode(data); err == nil {
		t.Error("accepted unknown field")
	}
}

func TestEncodeRejectsCyclesButAcceptsSharedChildren(t *testing.T) {
	stmt := &syntax.Stmt{}
	stmt.Cmd = &syntax.BinaryCmd{X: stmt, Y: stmt}
	if _, err := Encode(stmt); err == nil {
		t.Fatal("cyclic syntax cannot be represented as a tree")
	}
	shared := &syntax.Stmt{Cmd: &syntax.CallExpr{}}
	if _, err := Encode(&syntax.BinaryCmd{X: shared, Y: shared}); err != nil {
		t.Fatal(err)
	}
}

func TestDecodeRejectsContradictoryPositionsAndInvalidByteStrings(t *testing.T) {
	encoded, err := Encode(&syntax.Lit{ValuePos: syntax.NewPos(0, 1, 1)})
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{
		strings.Replace(string(encoded), `"IsValid":true`, `"IsValid":false`, 1),
		strings.Replace(string(encoded), `"IsValid":true,"IsRecovered":false`, `"IsValid":true,"IsRecovered":true`, 1),
		strings.Replace(string(encoded), `"Col":1`, `"Col":16384`, 1),
		strings.Replace(string(encoded), `"Value":""`, `"Value":{"Bytes":"not base64"}`, 1),
		strings.Replace(string(encoded), `"Value":""`, `"Value":{"Bytes":"","extra":true}`, 1),
	} {
		if _, err := DecodeNode([]byte(input)); err == nil {
			t.Errorf("accepted malformed syntax record %s", input)
		}
	}
}

// Public comparisons, including an invalid position on After's right side, are
// the oracle. Go's hidden words need not be identical when all exposed behavior
// agrees; collapsing offset overflow to an ordinary invalid zero does not agree.
func TestPositionRoundTripPreservesAllPublicMethods(t *testing.T) {
	file, err := syntax.NewParser(syntax.RecoverErrors(2)).Parse(strings.NewReader("(foo |"), "")
	if err != nil {
		t.Fatal(err)
	}
	maximum := syntax.NewPos(^uint(0), 1, 1).Offset()
	fixtures := []struct {
		name     string
		position syntax.Pos
		overflow bool
	}{
		{"zero", syntax.Pos{}, false},
		{"invalid-offset", syntax.NewPos(7, 0, 0), false},
		{"invalid-maximum-offset", syntax.NewPos(maximum, 0, 0), false},
		{"origin", syntax.NewPos(0, 1, 1), false},
		{"line-only", syntax.NewPos(3, 1, 0), false},
		{"column-only", syntax.NewPos(3, 0, 1), false},
		{"maximum", syntax.NewPos(maximum, 1, 1), false},
		{"recovered", file.Stmts[0].Cmd.(*syntax.Subshell).Rparen, true},
		{"overflow", (&syntax.Comment{Hash: syntax.NewPos(maximum, 1, 1)}).End(), true},
		{"column-carry", (&syntax.Comment{Hash: syntax.NewPos(maximum, 1, 16383)}).End(), true},
		{"wrapped-zero", (&syntax.Comment{Hash: syntax.NewPos(maximum, 262143, 16382), Text: "x"}).End(), true},
		{"wrapped-one", (&syntax.Comment{Hash: syntax.NewPos(maximum, 262143, 16383), Text: "x"}).End(), true},
	}
	for _, fixture := range fixtures {
		t.Run(fixture.name, func(t *testing.T) {
			encoded, err := Encode(&syntax.Lit{ValuePos: fixture.position})
			if err != nil {
				t.Fatal(err)
			}
			value, err := ReadJSON(encoded)
			if err != nil {
				t.Fatal(err)
			}
			positionRecord := value.(map[string]any)["ValuePos"].(map[string]any)
			if positionRecord["OffsetOverflow"] != fixture.overflow {
				t.Errorf("overflow distinction lost: %#v", positionRecord)
			}
			decoded, err := DecodeNode(encoded)
			if err != nil {
				t.Fatal(err)
			}
			actual := decoded.(*syntax.Lit).ValuePos
			if ObservePosition(actual) != ObservePosition(fixture.position) || actual.String() != fixture.position.String() {
				t.Fatal("position getters or String changed")
			}
			for _, other := range fixtures {
				if actual.After(other.position) != fixture.position.After(other.position) || other.position.After(actual) != other.position.After(fixture.position) {
					t.Fatalf("After changed against %s", other.name)
				}
			}
			derived := (&syntax.Comment{Hash: actual, Text: "x"}).End()
			wanted := (&syntax.Comment{Hash: fixture.position, Text: "x"}).End()
			if ObservePosition(derived) != ObservePosition(wanted) {
				t.Fatal("subsequent upstream position arithmetic changed")
			}
		})
	}
}
