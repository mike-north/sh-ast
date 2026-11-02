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
