// Faithful syntax generation preserves the pinned upstream data model alongside
// the older normalized projection. It owns declarations, numeric constants, and
// field metadata; runtime parsing, derived bounds, and traversal live elsewhere.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/constant"
	"go/types"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

// faithfulSchema is the complete data boundary of the pinned syntax package.
// Unlike the normalized visitor schema, it keeps scalars, positions, nil-bearing
// kinds, and auxiliary records even when they have no traversable children.
type faithfulSchema struct {
	Records    map[string]faithfulRecord
	Interfaces map[string][]string
	Operators  map[string][]string
	Constants  map[string]faithfulConstant
	License    string
}

// faithfulRecord separates syntax.Node membership from the mere presence of
// child-bearing data. Auxiliary structs have fields but no derived node bounds.
type faithfulRecord struct {
	Node   bool                     `json:"node"`
	Fields map[string]faithfulField `json:"fields"`
	Doc    string                   `json:"-"`
}

// faithfulField describes the meaning of a wire value independently of whether
// its current value is zero. Slice nil and nil elements are distinct concerns;
// preserving both prevents caller-created Go values from being conflated.
type faithfulField struct {
	Kind            string `json:"kind"`
	Type            string `json:"type"`
	Nullable        bool   `json:"nullable"`
	Slice           bool   `json:"slice"`
	ElementNullable bool   `json:"elementNullable"`
	Doc             string `json:"-"`
}

// MarshalJSON distinguishes an unnamed scalar/position domain from a named
// operator or record domain without inventing an empty upstream type name.
func (field faithfulField) MarshalJSON() ([]byte, error) {
	type data faithfulField
	var typeName *string
	if field.Type != "" {
		typeName = &field.Type
	}
	return json.Marshal(struct {
		data
		Type *string `json:"type"`
	}{data: data(field), Type: typeName})
}

// faithfulConstant retains the upstream numeric identity, declared family, and
// semantic documentation of an exported operator or language variant constant.
type faithfulConstant struct {
	Family string
	Value  int64
	Doc    string
}

// syntaxDocumentation associates source comments with the compiler-resolved
// declarations they describe. Comments are explanatory input, never type data.
type syntaxDocumentation struct {
	Types  map[string]string
	Fields map[string]map[string]string
	Values map[string]string
}

// buildFaithfulSchema discovers every public syntax node plus all reachable
// auxiliary structs. Unsupported exported field kinds fail generation rather
// than silently widening declarations or dropping values.
func buildFaithfulSchema(loaded *packages.Package) (*faithfulSchema, error) {
	pkg := loaded.Types
	nodeIface := lookupInterface(pkg, "Node")
	nodes := discoverNodeTypes(pkg, nodeIface)
	recordNames := make(map[string]bool, len(nodes))
	for _, node := range nodes {
		recordNames[node.name] = true
	}
	for _, name := range discoverAuxStructTypes(pkg, recordNames) {
		recordNames[name] = true
	}

	schema := &faithfulSchema{
		Records: map[string]faithfulRecord{}, Interfaces: map[string][]string{},
		Operators: map[string][]string{}, Constants: map[string]faithfulConstant{},
	}
	docs := readSyntaxDocumentation(loaded.Syntax)
	ifaceNames := map[string]bool{"Node": true}
	for name := range discoverChildInterfaceNames(pkg, nodeIface) {
		if ast.IsExported(name) {
			ifaceNames[name] = true
		}
	}
	for _, name := range pkg.Scope().Names() {
		obj, ok := pkg.Scope().Lookup(name).(*types.TypeName)
		if !ok || !obj.Exported() {
			continue
		}
		basic, ok := obj.Type().Underlying().(*types.Basic)
		if ok && basic.Kind() == types.Uint32 {
			schema.Operators[name] = nil
		}
	}
	for name := range recordNames {
		obj := pkg.Scope().Lookup(name).(*types.TypeName)
		named := obj.Type().(*types.Named)
		st := named.Underlying().(*types.Struct)
		record := faithfulRecord{
			Node:   types.Implements(types.NewPointer(named), nodeIface),
			Fields: map[string]faithfulField{}, Doc: docs.Types[name],
		}
		for i := range st.NumFields() {
			field := st.Field(i)
			if !field.Exported() {
				continue
			}
			if field.Name() == "Type" {
				return nil, fmt.Errorf("syntax.%s.Type collides with the binding discriminator", name)
			}
			shape, err := classifyFaithfulField(field.Type(), recordNames, ifaceNames, schema.Operators)
			if err != nil {
				return nil, fmt.Errorf("syntax.%s.%s: %w", name, field.Name(), err)
			}
			shape.Doc = docs.Fields[name][field.Name()]
			record.Fields[field.Name()] = shape
		}
		schema.Records[name] = record
	}
	for name := range ifaceNames {
		iface := pkg.Scope().Lookup(name).Type().Underlying().(*types.Interface)
		for recordName := range recordNames {
			named := pkg.Scope().Lookup(recordName).Type().(*types.Named)
			if types.Implements(types.NewPointer(named), iface) {
				schema.Interfaces[name] = append(schema.Interfaces[name], recordName)
			}
		}
		sort.Strings(schema.Interfaces[name])
	}
	for _, name := range pkg.Scope().Names() {
		obj, ok := pkg.Scope().Lookup(name).(*types.Const)
		if !ok || !obj.Exported() {
			continue
		}
		named, ok := obj.Type().(*types.Named)
		if !ok {
			continue
		}
		family := named.Obj().Name()
		_, operator := schema.Operators[family]
		if !operator && family != "LangVariant" {
			continue
		}
		value, exact := constant.Int64Val(obj.Val())
		if !exact {
			return nil, fmt.Errorf("syntax.%s is outside the supported exact integer domain", name)
		}
		schema.Constants[name] = faithfulConstant{Family: family, Value: value, Doc: docs.Values[name]}
		if operator {
			schema.Operators[family] = append(schema.Operators[family], name)
		}
	}
	if loaded.Module == nil {
		return nil, fmt.Errorf("syntax package has no module provenance")
	}
	license, err := os.ReadFile(filepath.Join(loaded.Module.Dir, "LICENSE"))
	if err != nil {
		return nil, fmt.Errorf("read upstream documentation license: %w", err)
	}
	schema.License = string(license)
	return schema, nil
}

// classifyFaithfulField models Go's field-level value alternatives. It does not
// infer requiredness from samples or from typedjson's omission behavior.
func classifyFaithfulField(t types.Type, records, interfaces map[string]bool, operators map[string][]string) (faithfulField, error) {
	out := faithfulField{}
	elem := t
	if slice, ok := elem.(*types.Slice); ok {
		out.Slice, out.Nullable = true, true
		elem = slice.Elem()
		_, pointer := elem.(*types.Pointer)
		_, iface := elem.Underlying().(*types.Interface)
		out.ElementNullable = pointer || iface
	} else {
		_, pointer := elem.(*types.Pointer)
		_, iface := elem.Underlying().(*types.Interface)
		out.Nullable = pointer || iface
	}
	if pointer, ok := elem.(*types.Pointer); ok {
		elem = pointer.Elem()
	}
	if basic, ok := elem.(*types.Basic); ok {
		switch basic.Kind() {
		case types.Bool:
			out.Kind = "boolean"
		case types.String:
			out.Kind = "string"
		default:
			return out, fmt.Errorf("unsupported field type %s", t)
		}
		return out, nil
	}
	named, ok := elem.(*types.Named)
	if !ok {
		return out, fmt.Errorf("unsupported field type %s", t)
	}
	name := named.Obj().Name()
	switch {
	case name == "Pos":
		out.Kind = "position"
	case records[name]:
		out.Kind, out.Type = "struct", name
	case interfaces[name]:
		out.Kind, out.Type = "interface", name
	default:
		if _, ok := operators[name]; !ok {
			return out, fmt.Errorf("unsupported named field type %s", t)
		}
		out.Kind, out.Type = "operator", name
	}
	return out, nil
}

// readSyntaxDocumentation retains explanatory upstream comments, including
// grouped field declarations, while leaving generation decisions to go/types.
func readSyntaxDocumentation(files []*ast.File) syntaxDocumentation {
	out := syntaxDocumentation{Types: map[string]string{}, Fields: map[string]map[string]string{}, Values: map[string]string{}}
	for _, file := range files {
		for _, declaration := range file.Decls {
			group, ok := declaration.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, spec := range group.Specs {
				switch spec := spec.(type) {
				case *ast.TypeSpec:
					out.Types[spec.Name.Name] = commentText(spec.Doc, group.Doc)
					st, ok := spec.Type.(*ast.StructType)
					if !ok {
						continue
					}
					fields := map[string]string{}
					for _, field := range st.Fields.List {
						for _, name := range field.Names {
							fields[name.Name] = strings.TrimSpace(commentText(field.Doc) + "\n" + commentText(field.Comment))
						}
					}
					out.Fields[spec.Name.Name] = fields
				case *ast.ValueSpec:
					for _, name := range spec.Names {
						out.Values[name.Name] = strings.TrimSpace(commentText(spec.Doc) + "\n" + commentText(spec.Comment))
					}
				}
			}
		}
	}
	return out
}

// commentText chooses the most local available comment. Go compiler directives
// and future-work notes are not part of the durable public semantic contract.
func commentText(groups ...*ast.CommentGroup) string {
	for _, group := range groups {
		if group == nil {
			continue
		}
		var lines []string
		for _, line := range strings.Split(group.Text(), "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "TODO") || strings.HasPrefix(strings.TrimSpace(line), "go:") {
				continue
			}
			lines = append(lines, line)
		}
		return strings.TrimSpace(strings.Join(lines, "\n"))
	}
	return ""
}

// sortedKeys makes all generated projections deterministic regardless of Go's
// map iteration order. The order is for reviewability, not traversal semantics.
func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// faithfulHeader carries the upstream license with copied semantic comments so
// published declarations retain their provenance without an external file lookup.
func faithfulHeader(schema *faithfulSchema, version string) string {
	return fmt.Sprintf("// Code generated by tools/gen-visitor-keys from mvdan.cc/sh/v3 %s. DO NOT EDIT.\n"+
		"// Faithful syntax values; see design/ARCHITECTURE.md.\n/*\n%s\n*/\n\n", version, strings.TrimSpace(schema.License))
}

// goDocLink converts upstream's Go documentation links to harmless code spans;
// TypeScript documentation does not resolve Go's pointer or member link syntax.
var goDocLink = regexp.MustCompile(`\[\*?([A-Za-z][A-Za-z0-9_.]*)\]`)

// writeSemanticComment keeps upstream meaning beside the represented field or
// record, adding binding-specific invariants without narrating implementation.
func writeSemanticComment(b *strings.Builder, indent, text, tag string) {
	text = goDocLink.ReplaceAllString(strings.ReplaceAll(text, "*/", "* /"), "`$1`")
	// Go prose contains shell punctuation with a different meaning in TSDoc.
	// Preserve literal code spans while protecting prose from tag/HTML parsing.
	parts := strings.Split(text, "`")
	escaper := strings.NewReplacer("\\", "\\\\", "{", "\\{", "}", "\\}", "<", "\\<", ">", "\\>", "@", "\\@")
	for i := range parts {
		if i%2 == 0 {
			parts[i] = escaper.Replace(parts[i])
		}
	}
	text = strings.Join(parts, "`")
	b.WriteString(indent + "/**\n")
	for _, line := range strings.Split(text, "\n") {
		b.WriteString(indent + " * " + line + "\n")
	}
	if tag != "" {
		b.WriteString(indent + " *\n" + indent + " * @" + tag + "\n")
	}
	b.WriteString(indent + " */\n")
}

// faithfulFieldMeaning supplements source comments with the preservation
// obligations shared by each value kind, especially absent and zero values.
func faithfulFieldMeaning(field faithfulField) string {
	meaning := field.Doc
	var boundary string
	switch {
	case field.Slice:
		boundary = "Ordered upstream entries. Null preserves a nil slice and differs from an empty array."
		if field.ElementNullable {
			boundary += " Null entries preserve nil elements."
		}
	case field.Nullable:
		boundary = "Null preserves the upstream absence of this component."
	case field.Kind == "position":
		boundary = "Recorded source position; invalid and recovered states remain distinct."
	case field.Kind == "string":
		boundary = "Upstream string bytes; non-UTF-8 values remain bytes rather than replacement text."
	case field.Kind == "boolean":
		boundary = "False is an explicit upstream value and is never omitted."
	case field.Kind == "operator":
		boundary = "Upstream operator value, preserving named tokens, zero, and explicitly represented raw uint32 values."
	}
	if meaning == "" {
		return boundary
	}
	return meaning + "\n\n" + boundary
}

// faithfulFieldType preserves optional values as explicit null unions instead of
// optional properties. Pointer elements remain distinct from the slice itself.
func faithfulFieldType(field faithfulField) string {
	var value string
	switch field.Kind {
	case "boolean":
		value = "boolean"
	case "string":
		value = "GoString"
	case "position":
		value = "SyntaxPos"
	default:
		value = field.Type
	}
	if field.Slice {
		if field.ElementNullable {
			value = "(" + value + " | null)"
		}
		value += "[]"
	}
	if field.Nullable {
		value += " | null"
	}
	return value
}

// renderFaithfulTypes emits data records only. Node.Pos/End remain operations on
// the current tree, so mutable records never carry independently stale bounds.
func renderFaithfulTypes(schema *faithfulSchema, version string) string {
	var b strings.Builder
	b.WriteString(faithfulHeader(schema, version))
	b.WriteString("import type { " + strings.Join(sortedKeys(schema.Operators), ", ") + " } from './syntax-constants.js';\n\n")
	writeSemanticComment(&b, "", "A Go string's exact bytes. Valid UTF-8 is represented as a JavaScript string; other bytes use Uint8Array. String inputs must not contain unpaired surrogates, which have no faithful UTF-8 representation.", "public")
	b.WriteString("export type GoString = string | Uint8Array;\n\n")
	writeSemanticComment(&b, "", "The observable value of an upstream syntax.Pos. Offset and Col count bytes; Line and Col use upstream numbering and overflow behavior. IsValid, IsRecovered, and OffsetOverflow retain distinctions that coordinates alone cannot express. Token positions are data; node bounds are derived operations.", "public")
	b.WriteString("export interface SyntaxPos {\n")
	for _, field := range []struct{ name, typ, doc string }{
		{"Offset", "number", "Zero-based source byte offset, including upstream saturation behavior."},
		{"Line", "number", "One-based source line; zero retains upstream invalid or overflow information."},
		{"Col", "number", "One-based byte column; zero retains upstream invalid or overflow information."},
		{"IsValid", "boolean", "Whether upstream considers this position useful; recovered positions are not valid."},
		{"IsRecovered", "boolean", "Whether upstream synthesized this missing syntax position during error recovery."},
		{"OffsetOverflow", "boolean", "Whether the stored upstream offset exceeds its representable source-offset maximum, including the recovered sentinel. This preserves ordering distinctions even when Offset() reports zero; ordinary zero-invalid positions have false here."},
	} {
		writeSemanticComment(&b, "  ", field.doc, "")
		fmt.Fprintf(&b, "  %s: %s;\n", field.name, field.typ)
	}
	b.WriteString("}\n\n")
	for _, name := range sortedKeys(schema.Records) {
		record := schema.Records[name]
		doc := record.Doc
		if doc == "" {
			doc = "The upstream syntax." + name + " record."
		}
		if record.Node {
			doc += "\n\nA syntax node with mutable upstream fields. Its source bounds are derived from the current fields and children."
		} else {
			doc += "\n\nAuxiliary syntax data, not a syntax.Node; it has no independent source bounds."
		}
		writeSemanticComment(&b, "", doc, "public")
		fmt.Fprintf(&b, "export interface %s {\n", name)
		writeSemanticComment(&b, "  ", "Identifies the upstream concrete record when carried through an interface union.", "")
		fmt.Fprintf(&b, "  Type: '%s';\n", name)
		for _, fieldName := range sortedKeys(record.Fields) {
			field := record.Fields[fieldName]
			writeSemanticComment(&b, "  ", faithfulFieldMeaning(field), "")
			fmt.Fprintf(&b, "  %s: %s;\n", fieldName, faithfulFieldType(field))
		}
		b.WriteString("}\n\n")
	}
	for _, name := range sortedKeys(schema.Interfaces) {
		writeSemanticComment(&b, "", "The concrete records accepted by upstream syntax."+name+". Auxiliary records are excluded unless the upstream interface actually admits them.", "public")
		fmt.Fprintf(&b, "export type %s = %s;\n\n", name, strings.Join(schema.Interfaces[name], " | "))
	}
	return b.String()
}

// renderFaithfulConstantsJS exposes exact upstream values without a runtime
// enum translation, preserving numeric identity at the WASM boundary.
func renderFaithfulConstantsJS(schema *faithfulSchema, version string) string {
	var b strings.Builder
	b.WriteString(faithfulHeader(schema, version))
	for _, name := range sortedKeys(schema.Constants) {
		value := schema.Constants[name]
		writeSemanticComment(&b, "", constantMeaning(name, value), "public")
		fmt.Fprintf(&b, "export const %s = %d;\n\n", name, value.Value)
	}
	return b.String()
}

// constantMeaning associates punctuation-oriented upstream token comments with
// their domain, so a numeric literal remains meaningful without implementation.
func constantMeaning(name string, value faithfulConstant) string {
	meaning := "Upstream " + value.Family + " constant " + name + ". Its numeric value is preserved exactly."
	if value.Doc != "" {
		meaning += "\n\n" + value.Doc
	}
	return meaning
}

// renderFaithfulConstantsDTS distinguishes intended token alternatives while
// allowing callers to preserve unnamed uint32 values through a checked brand.
func renderFaithfulConstantsDTS(schema *faithfulSchema, version string) string {
	var b strings.Builder
	b.WriteString(faithfulHeader(schema, version))
	for _, name := range sortedKeys(schema.Constants) {
		value := schema.Constants[name]
		writeSemanticComment(&b, "", constantMeaning(name, value), "public")
		fmt.Fprintf(&b, "export declare const %s: %d;\n\n", name, value.Value)
	}
	writeSemanticComment(&b, "", "The upstream uint32 operator families. A family name identifies the Go named type, not the spelling of one token.", "public")
	var families []string
	for _, name := range sortedKeys(schema.Operators) {
		families = append(families, jsString(name))
	}
	fmt.Fprintf(&b, "export type OperatorFamily = %s;\n\n", strings.Join(families, " | "))
	writeSemanticComment(&b, "", "An explicitly represented unnamed uint32 value in one upstream operator family. The runtime constructor checks integer range; this type does not claim that every value is meaningful to every parser or printer operation. The structural family marker remains interoperable across package entry points while preventing accidental cross-family assignment.", "public")
	b.WriteString("export type RawOperator<Family extends OperatorFamily> = number & { readonly __shAstOperatorFamily: Family };\n\n")
	for _, name := range sortedKeys(schema.Operators) {
		writeSemanticComment(&b, "", "The upstream "+name+" domain: exact named tokens, the Go zero value, and explicitly validated unnamed uint32 values. Constants shared by upstream families retain their shared numeric identity.", "public")
		values := []string{"0"}
		canonical := map[int64]string{}
		for _, constant := range schema.Operators[name] {
			value := schema.Constants[constant]
			previous, exists := canonical[value.Value]
			if !exists || strings.Contains(schema.Constants[previous].Doc, "Deprecated:") {
				canonical[value.Value] = constant
			}
		}
		var names []string
		for _, constant := range canonical {
			names = append(names, constant)
		}
		sort.Strings(names)
		for _, constant := range names {
			values = append(values, "typeof "+constant)
		}
		values = append(values, "RawOperator<"+jsString(name)+">")
		fmt.Fprintf(&b, "export type %s = %s;\n\n", name, strings.Join(values, " | "))
	}
	writeSemanticComment(&b, "", "Known upstream language variant values, including legacy zero and LangAuto. Each operation retains its own constraints: the parser Variant option rejects LangAuto even though the language-value type includes it.", "public")
	variants := []string{"0"}
	for _, name := range sortedKeys(schema.Constants) {
		if schema.Constants[name].Family == "LangVariant" {
			variants = append(variants, "typeof "+name)
		}
	}
	fmt.Fprintf(&b, "export type LangVariant = %s;\n", strings.Join(variants, " | "))
	return b.String()
}

// renderFaithfulSchemaJS emits complete field metadata for boundary validation
// and consumer adaptation. Field iteration order is not upstream Walk order.
func renderFaithfulSchemaJS(schema *faithfulSchema, version string) string {
	var b strings.Builder
	b.WriteString(faithfulHeader(schema, version))
	writeSemanticComment(&b, "", "Complete upstream field shapes for reflection and consumer adaptation. Ordering is deterministic for review, not the upstream Walk order. The public binding freezes this shared metadata; represented syntax records remain mutable.", "public")
	records, _ := json.MarshalIndent(schema.Records, "", "  ")
	b.WriteString("export const SYNTAX_SCHEMA = " + string(records) + ";\n\n")
	writeSemanticComment(&b, "", "Concrete alternatives for upstream interfaces; syntax.Node deliberately excludes auxiliary structs. This is reflection metadata, not a traversal implementation.", "public")
	interfaces, _ := json.MarshalIndent(schema.Interfaces, "", "  ")
	b.WriteString("export const SYNTAX_INTERFACES = " + string(interfaces) + ";\n")
	return b.String()
}

// renderFaithfulSchemaDTS makes reflection metadata immutable while leaving AST
// values mutable. Its descriptions aid adaptation without inventing traversal.
func renderFaithfulSchemaDTS(schema *faithfulSchema, version string) string {
	return faithfulHeader(schema, version) + `/**
 * A field's upstream value kind and nil-bearing boundaries. Null type names
 * identify scalar/position kinds; other names identify concrete Go types.
 * @public
 */
export interface SyntaxFieldSchema {
  /** The upstream value domain, independent of a field's current value. */
  readonly kind: 'boolean' | 'string' | 'position' | 'operator' | 'struct' | 'interface';
  /** Named operator, record, or interface domain; null for scalar/position data. */
  readonly type: string | null;
  /** Whether the entire field may hold the upstream nil value. */
  readonly nullable: boolean;
  /** Whether the field is an ordered Go slice, preserving nil versus empty. */
  readonly slice: boolean;
  /** Whether a slice element may independently hold a nil pointer/interface. */
  readonly elementNullable: boolean;
}
/** Complete data fields and real syntax.Node membership. @public */
export interface SyntaxRecordSchema {
  /** Whether the actual upstream type implements syntax.Node. */
  readonly node: boolean;
  /** Every exported upstream field, retaining its original spelling. */
  readonly fields: Readonly<Record<string, SyntaxFieldSchema>>;
}
/** Reflection metadata; field order is not upstream Walk order. @public */
export declare const SYNTAX_SCHEMA: Readonly<Record<string, SyntaxRecordSchema>>;
/** Concrete alternatives accepted by upstream interfaces. @public */
export declare const SYNTAX_INTERFACES: Readonly<Record<string, readonly string[]>>;
`
}
