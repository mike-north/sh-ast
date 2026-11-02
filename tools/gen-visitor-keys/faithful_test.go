package main

import (
	"encoding/json"
	"go/types"
	"reflect"
	"slices"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// upstreamRecords is an independently maintained inventory of the pinned
// syntax package's public node and auxiliary structs. Reflection over the actual
// Go values verifies the generator's go/types interpretation without reusing its
// field classifier or declarations as expected output.
var upstreamRecords = []reflect.Type{
	reflect.TypeFor[syntax.File](), reflect.TypeFor[syntax.Comment](),
	reflect.TypeFor[syntax.Stmt](), reflect.TypeFor[syntax.Assign](),
	reflect.TypeFor[syntax.Redirect](), reflect.TypeFor[syntax.CallExpr](),
	reflect.TypeFor[syntax.Subshell](), reflect.TypeFor[syntax.Block](),
	reflect.TypeFor[syntax.IfClause](), reflect.TypeFor[syntax.WhileClause](),
	reflect.TypeFor[syntax.ForClause](), reflect.TypeFor[syntax.WordIter](),
	reflect.TypeFor[syntax.CStyleLoop](), reflect.TypeFor[syntax.BinaryCmd](),
	reflect.TypeFor[syntax.FuncDecl](), reflect.TypeFor[syntax.Word](),
	reflect.TypeFor[syntax.Lit](), reflect.TypeFor[syntax.SglQuoted](),
	reflect.TypeFor[syntax.DblQuoted](), reflect.TypeFor[syntax.CmdSubst](),
	reflect.TypeFor[syntax.ParamExp](), reflect.TypeFor[syntax.Slice](),
	reflect.TypeFor[syntax.Replace](), reflect.TypeFor[syntax.Expansion](),
	reflect.TypeFor[syntax.ArithmExp](), reflect.TypeFor[syntax.ArithmCmd](),
	reflect.TypeFor[syntax.BinaryArithm](), reflect.TypeFor[syntax.UnaryArithm](),
	reflect.TypeFor[syntax.ParenArithm](), reflect.TypeFor[syntax.FlagsArithm](),
	reflect.TypeFor[syntax.CaseClause](), reflect.TypeFor[syntax.CaseItem](),
	reflect.TypeFor[syntax.TestClause](), reflect.TypeFor[syntax.BinaryTest](),
	reflect.TypeFor[syntax.UnaryTest](), reflect.TypeFor[syntax.ParenTest](),
	reflect.TypeFor[syntax.DeclClause](), reflect.TypeFor[syntax.ArrayExpr](),
	reflect.TypeFor[syntax.ArrayElem](), reflect.TypeFor[syntax.ExtGlob](),
	reflect.TypeFor[syntax.ProcSubst](), reflect.TypeFor[syntax.TimeClause](),
	reflect.TypeFor[syntax.CoprocClause](), reflect.TypeFor[syntax.LetClause](),
	reflect.TypeFor[syntax.BraceExp](), reflect.TypeFor[syntax.TestDecl](),
}

// TestFaithfulSchemaMatchesUpstreamFields guards completeness, nullability, and
// node membership with independent runtime type information from the pin.
func TestFaithfulSchemaMatchesUpstreamFields(t *testing.T) {
	schema, err := buildFaithfulSchema(loadSyntaxPackage())
	if err != nil {
		t.Fatal(err)
	}
	if len(schema.Records) != len(upstreamRecords) {
		t.Fatalf("record count = %d, upstream inventory has %d", len(schema.Records), len(upstreamRecords))
	}
	for _, typ := range upstreamRecords {
		t.Run(typ.Name(), func(t *testing.T) {
			record, ok := schema.Records[typ.Name()]
			if !ok {
				t.Fatal("public upstream record missing from schema")
			}
			wantNode := reflect.PointerTo(typ).Implements(reflect.TypeFor[syntax.Node]())
			if record.Node != wantNode {
				t.Errorf("node membership = %v, want %v", record.Node, wantNode)
			}
			if len(record.Fields) != typ.NumField() {
				t.Fatalf("field count = %d, want %d", len(record.Fields), typ.NumField())
			}
			for i := range typ.NumField() {
				field := typ.Field(i)
				got, ok := record.Fields[field.Name]
				if !ok {
					t.Errorf("missing upstream field %s", field.Name)
					continue
				}
				want := reflectedField(field.Type)
				if got.Kind != want.Kind || got.Type != want.Type || got.Nullable != want.Nullable || got.Slice != want.Slice || got.ElementNullable != want.ElementNullable {
					t.Errorf("%s descriptor = %+v, want %+v", field.Name, got, want)
				}
			}
		})
	}
}

// reflectedField expresses Go's nil-bearing kinds independently from the
// generator. It deliberately records pointer elements separately from nil slices.
func reflectedField(typ reflect.Type) faithfulField {
	out := faithfulField{}
	if typ.Kind() == reflect.Slice {
		out.Slice, out.Nullable = true, true
		typ = typ.Elem()
		out.ElementNullable = typ.Kind() == reflect.Pointer || typ.Kind() == reflect.Interface
	} else {
		out.Nullable = typ.Kind() == reflect.Pointer || typ.Kind() == reflect.Interface
	}
	if typ.Kind() == reflect.Pointer {
		typ = typ.Elem()
	}
	switch {
	case typ == reflect.TypeFor[syntax.Pos]():
		out.Kind = "position"
	case typ.Kind() == reflect.Bool:
		out.Kind = "boolean"
	case typ.Kind() == reflect.String:
		out.Kind = "string"
	case typ.Kind() == reflect.Uint32:
		out.Kind, out.Type = "operator", typ.Name()
	case typ.Kind() == reflect.Interface:
		out.Kind, out.Type = "interface", typ.Name()
	case typ.Kind() == reflect.Struct:
		out.Kind, out.Type = "struct", typ.Name()
	default:
		panic("unmapped upstream field kind: " + typ.String())
	}
	return out
}

// TestFaithfulInterfaceMembership checks all syntax alternatives against actual
// Go method sets; auxiliary data must never become an invented syntax.Node.
func TestFaithfulInterfaceMembership(t *testing.T) {
	schema, err := buildFaithfulSchema(loadSyntaxPackage())
	if err != nil {
		t.Fatal(err)
	}
	for _, iface := range []reflect.Type{
		reflect.TypeFor[syntax.Node](), reflect.TypeFor[syntax.Command](),
		reflect.TypeFor[syntax.WordPart](), reflect.TypeFor[syntax.ArithmExpr](),
		reflect.TypeFor[syntax.TestExpr](), reflect.TypeFor[syntax.Loop](),
	} {
		var want []string
		for _, typ := range upstreamRecords {
			if reflect.PointerTo(typ).Implements(iface) {
				want = append(want, typ.Name())
			}
		}
		slices.Sort(want)
		if !slices.Equal(schema.Interfaces[iface.Name()], want) {
			t.Errorf("%s alternatives = %v, want %v", iface.Name(), schema.Interfaces[iface.Name()], want)
		}
	}
}

// TestFaithfulConstantValues compares representative constants from every
// operator family and language variants with the actual compiled upstream values.
func TestFaithfulConstantValues(t *testing.T) {
	schema, err := buildFaithfulSchema(loadSyntaxPackage())
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int64{
		"RdrOut": int64(syntax.RdrOut), "ClbOut": int64(syntax.ClbOut),
		"CmdIn": int64(syntax.CmdIn), "GlobExcept": int64(syntax.GlobExcept),
		"AndStmt": int64(syntax.AndStmt), "ResumeKorn": int64(syntax.ResumeKorn),
		"NamesPrefixWords":   int64(syntax.NamesPrefixWords),
		"DefaultUnsetOrNull": int64(syntax.DefaultUnsetOrNull),
		"Minus":              int64(syntax.Minus), "PowAssgn": int64(syntax.PowAssgn),
		"TsNot": int64(syntax.TsNot), "TsAfter": int64(syntax.TsAfter),
		"LangBash": int64(syntax.LangBash), "LangPOSIX": int64(syntax.LangPOSIX),
		"LangMirBSDKorn": int64(syntax.LangMirBSDKorn), "LangBats": int64(syntax.LangBats),
		"LangZsh": int64(syntax.LangZsh), "LangAuto": int64(syntax.LangAuto),
	}
	for name, value := range want {
		got, ok := schema.Constants[name]
		if !ok || got.Value != value {
			t.Errorf("%s = %+v (present %v), want %d", name, got, ok, value)
		}
	}
	if len(schema.Operators) != 11 {
		t.Errorf("operator families = %d, want 11 from pinned tokens.go", len(schema.Operators))
	}
}

// TestFaithfulClassifierRejectsUnknownFields prevents future upstream fields
// from disappearing silently behind a permissive index signature.
func TestFaithfulClassifierRejectsUnknownFields(t *testing.T) {
	if _, err := classifyFaithfulField(types.Typ[types.Float64], nil, nil, nil); err == nil {
		t.Fatal("an unsupported field type must fail generation")
	}
}

// TestFaithfulDeclarationsPreserveValueModel pins API meaning independently of
// the production field mapping: defaults are required, nil remains explicit,
// records are mutable, and bounds are derived outside the data records.
func TestFaithfulDeclarationsPreserveValueModel(t *testing.T) {
	schema, err := buildFaithfulSchema(loadSyntaxPackage())
	if err != nil {
		t.Fatal(err)
	}
	decls := renderFaithfulTypes(schema, "v3.13.1")
	for _, want := range []string{
		"export type GoString = string | Uint8Array;",
		"export interface SyntaxPos", "IsRecovered: boolean;", "OffsetOverflow: boolean;",
		"Type: 'File';", "Stmts: (Stmt | null)[] | null;",
		"Last: Comment[] | null;", "Negated: boolean;",
		"Cmd: Command | null;", "Op: RedirOperator;",
		"Value: GoString;", "Semicolon: SyntaxPos;",
		"Slice: Slice | null;",
	} {
		if !strings.Contains(decls, want) {
			t.Errorf("declarations missing %q", want)
		}
	}
	for _, unwanted := range []string{"[field: string]", "readonly Stmts", "Negated?:", "Pos():", "End():"} {
		if strings.Contains(decls, unwanted) {
			t.Errorf("declarations contain incompatible shape %q", unwanted)
		}
	}
	constants := renderFaithfulConstantsDTS(schema, "v3.13.1")
	if !strings.Contains(constants, "RawOperator<Family extends OperatorFamily>") || !strings.Contains(constants, "RawOperator<'RedirOperator'>") {
		t.Error("operator declarations must preserve branded unnamed uint32 values")
	}
	if !strings.Contains(constants, "export type RedirOperator = 0 |") {
		t.Error("operator declarations must preserve the upstream zero value")
	}
}

// TestFaithfulDescriptorWireShape keeps scalar/position fields explicitly
// unassociated with a named family while retaining names for typed alternatives.
func TestFaithfulDescriptorWireShape(t *testing.T) {
	for _, test := range []struct {
		field faithfulField
		want  any
	}{
		{faithfulField{Kind: "boolean"}, nil},
		{faithfulField{Kind: "position"}, nil},
		{faithfulField{Kind: "operator", Type: "RedirOperator"}, "RedirOperator"},
	} {
		encoded, err := json.Marshal(test.field)
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(encoded, &got); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got["type"], test.want) {
			t.Errorf("descriptor type = %#v, want %#v", got["type"], test.want)
		}
	}
}

// TestFaithfulOperatorAliases keeps every upstream alias available while avoiding
// duplicate union alternatives for aliases with the same numeric identity.
func TestFaithfulOperatorAliases(t *testing.T) {
	schema, err := buildFaithfulSchema(loadSyntaxPackage())
	if err != nil {
		t.Fatal(err)
	}
	decls := renderFaithfulConstantsDTS(schema, "v3.13.1")
	for _, line := range strings.Split(decls, "\n") {
		if strings.HasPrefix(line, "export type RedirOperator =") && strings.Contains(line, "typeof ClbOut") {
			t.Error("deprecated ClbOut alias should not duplicate the RdrClob alternative")
		}
	}
	if !strings.Contains(decls, "export declare const ClbOut:") || !strings.Contains(decls, "typeof RdrClob") {
		t.Error("both upstream alias identity and canonical type alternative must survive")
	}
}
