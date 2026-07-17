// Command gen-visitor-keys reads mvdan/sh's syntax package types (via
// go/packages + go/types, i.e. real Go type information rather than a
// regex/text scrape of syntax/nodes.go) and emits the checked-in artifacts
// consumed by sh-ast:
//
//   - generated/visitor-keys.js(.d.ts)      — per-node-type traversal keys
//   - generated/child-type-schema.js(.d.ts) — (parentType, fieldName) -> childType
//   - generated/node-types.d.ts             — ShNode subtypes for every node
//
// See design/ARCHITECTURE.md, "The schema table is generated, not
// hand-written", and design/PACKAGES.md's `tools/gen-visitor-keys` entry.
//
// Determinism: every map is walked in sorted key order, and the only
// mvdan/sh-version-derived text in the output is the module version reported
// by runtime/debug.ReadBuildInfo() (a fact about the pinned dependency, not a
// timestamp or VCS stamp) — regenerating against the same go.sum reproduces
// byte-identical output, which is what the CI verify step checks.
package main

import (
	"flag"
	"fmt"
	"go/types"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

const syntaxPkgPath = "mvdan.cc/sh/v3/syntax"

// nodeType describes one mvdan/sh syntax node: a struct type reachable from
// *syntax.File that implements syntax.Node (Pos() Pos / End() Pos on a
// pointer receiver).
type nodeType struct {
	name   string
	fields []nodeField
}

// nodeField describes one struct field that holds child node(s) — i.e. every
// field is either omitted entirely (scalars, positions, and fields whose
// static type doesn't implement syntax.Node) or present here. Exactly one of
// iface/childType is set: childType for a field whose static Go type is a
// concrete node struct (typedjson never emits a discriminator for these —
// this is the child-type-schema's whole reason to exist), iface for a field
// whose static Go type is a Node-derived interface (Command, WordPart,
// ArithmExpr, TestExpr, Loop — typedjson already emits "Type" for these).
type nodeField struct {
	goName    string
	jsonName  string
	slice     bool
	iface     string
	childType string
}

func main() {
	outDir := flag.String("out", "", "output directory for generated files (required)")
	flag.Parse()
	if *outDir == "" {
		log.Fatal("gen-visitor-keys: -out is required")
	}

	loaded := loadSyntaxPackage()
	pkg := loaded.Types
	nodeIface := lookupInterface(pkg, "Node")
	childIfaceNames := discoverChildInterfaceNames(pkg, nodeIface)
	coreNodeTypes := discoverNodeTypes(pkg, nodeIface)
	coreNames := make(map[string]bool, len(coreNodeTypes))
	for _, nt := range coreNodeTypes {
		coreNames[nt.name] = true
	}

	// Discover auxiliary structs: concrete struct types that do NOT
	// implement syntax.Node (no Pos()/End()) but are reachable via a
	// struct-typed field of a type we already know about — mvdan/sh's
	// ParamExp.Slice/.Repl/.Exp (*Slice/*Replace/*Expansion) are exactly
	// this. typedjson never emits a "Type" discriminator for these (only
	// Node-implementing values get one), so — like every other
	// undiscriminated struct-typed field — they need a schema entry.
	// Without this, normalize() silently drops their entire subtree (see
	// issue #13): e.g. `${USER:-nobody}`'s `nobody` never reaches the
	// normalized tree, because `ParamExp.Exp` had no schema entry at all.
	auxNames := discoverAuxStructTypes(pkg, coreNames)
	nodeTypes := append([]*nodeType(nil), coreNodeTypes...)
	for _, name := range auxNames {
		nodeTypes = append(nodeTypes, &nodeType{name: name})
	}
	sort.Slice(nodeTypes, func(i, j int) bool { return nodeTypes[i].name < nodeTypes[j].name })

	classifyFields(pkg, nodeTypes, childIfaceNames)

	// Prune any auxiliary struct that, after classification, turned out to
	// have zero child-bearing fields of its own (a true scalar-only leaf) —
	// it needs no schema entry, and any field pointing to it should be
	// treated as a scalar, not a child. Iterate to a fixed point: pruning
	// one aux struct can turn a sibling aux struct's own field scalar too.
	// Core Node-implementing types are exempt — a childless Node type
	// (`Lit`, `Comment`, `SglQuoted`, …) is still a real, traversable AST
	// position and always gets an entry (possibly empty).
	for {
		var pruned []*nodeType
		removedAny := false
		for _, nt := range nodeTypes {
			if !coreNames[nt.name] && len(nt.fields) == 0 {
				removedAny = true
				continue
			}
			pruned = append(pruned, nt)
		}
		nodeTypes = pruned
		if !removedAny {
			break
		}
		classifyFields(pkg, nodeTypes, childIfaceNames)
	}

	// Restrict to interfaces actually used as a field's static type. The
	// package also declares interfaces embedding Node purely as internal
	// generic-constraint helpers (e.g. walk.go's unexported `nilableNode`,
	// embedding `Node` + `comparable`) that no struct field is ever declared
	// with; discovering "implements Node" structurally would otherwise pull
	// those in too.
	usedIfaces := make(map[string]bool)
	for _, nt := range nodeTypes {
		for _, f := range nt.fields {
			if f.iface != "" {
				usedIfaces[f.iface] = true
			}
		}
	}
	for name := range childIfaceNames {
		if !usedIfaces[name] {
			delete(childIfaceNames, name)
		}
	}

	implementers := buildImplementers(pkg, nodeTypes, childIfaceNames)

	version := mvdanShVersion(loaded)

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		log.Fatalf("gen-visitor-keys: %v", err)
	}
	writeFile(filepath.Join(*outDir, "visitor-keys.js"), renderVisitorKeysJS(nodeTypes, version))
	writeFile(filepath.Join(*outDir, "visitor-keys.d.ts"), renderVisitorKeysDTS(version))
	writeFile(filepath.Join(*outDir, "child-type-schema.js"), renderChildTypeSchemaJS(nodeTypes, version))
	writeFile(filepath.Join(*outDir, "child-type-schema.d.ts"), renderChildTypeSchemaDTS(version))
	writeFile(filepath.Join(*outDir, "node-types.d.ts"), renderNodeTypesDTS(nodeTypes, implementers, version))
}

func writeFile(path, contents string) {
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		log.Fatalf("gen-visitor-keys: writing %s: %v", path, err)
	}
}

// mvdanShVersion reports the resolved mvdan.cc/sh/v3 module version for the
// loaded package, straight from the Go module graph `go list` consulted —
// never a hand-typed literal, so it can't drift from the actual pinned
// dependency in go.mod/go.sum.
func mvdanShVersion(pkg *packages.Package) string {
	if pkg.Module == nil {
		log.Fatal("gen-visitor-keys: no module info available for the loaded package")
	}
	return pkg.Module.Version
}

func loadSyntaxPackage() *packages.Package {
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedTypes | packages.NeedTypesInfo |
			packages.NeedSyntax | packages.NeedDeps | packages.NeedImports | packages.NeedModule,
	}
	pkgs, err := packages.Load(cfg, syntaxPkgPath)
	if err != nil {
		log.Fatalf("gen-visitor-keys: loading %s: %v", syntaxPkgPath, err)
	}
	if packages.PrintErrors(pkgs) > 0 {
		log.Fatalf("gen-visitor-keys: errors loading %s", syntaxPkgPath)
	}
	if len(pkgs) != 1 {
		log.Fatalf("gen-visitor-keys: expected exactly one package, got %d", len(pkgs))
	}
	return pkgs[0]
}

func lookupInterface(pkg *types.Package, name string) *types.Interface {
	obj := pkg.Scope().Lookup(name)
	if obj == nil {
		log.Fatalf("gen-visitor-keys: %s.%s not found", syntaxPkgPath, name)
	}
	iface, ok := obj.Type().Underlying().(*types.Interface)
	if !ok {
		log.Fatalf("gen-visitor-keys: %s.%s is not an interface", syntaxPkgPath, name)
	}
	return iface
}

// discoverChildInterfaceNames finds every named interface in the package
// (other than Node itself) whose method set is a superset of Node's — i.e.
// Command, WordPart, ArithmExpr, TestExpr, Loop. Discovered structurally so a
// future mvdan/sh version adding a new node-family interface doesn't silently
// need a hand update here.
func discoverChildInterfaceNames(pkg *types.Package, nodeIface *types.Interface) map[string]*types.Named {
	out := make(map[string]*types.Named)
	scope := pkg.Scope()
	for _, name := range scope.Names() {
		if name == "Node" {
			continue
		}
		obj, ok := scope.Lookup(name).(*types.TypeName)
		if !ok {
			continue
		}
		named, ok := obj.Type().(*types.Named)
		if !ok {
			continue
		}
		if _, ok := named.Underlying().(*types.Interface); !ok {
			continue
		}
		if types.Implements(named, nodeIface) {
			out[name] = named
		}
	}
	return out
}

// discoverNodeTypes finds every named struct type in the package whose
// pointer implements Node, sorted by name for deterministic output.
func discoverNodeTypes(pkg *types.Package, nodeIface *types.Interface) []*nodeType {
	scope := pkg.Scope()
	var names []string
	for _, name := range scope.Names() {
		obj, ok := scope.Lookup(name).(*types.TypeName)
		if !ok {
			continue
		}
		named, ok := obj.Type().(*types.Named)
		if !ok {
			continue
		}
		if _, ok := named.Underlying().(*types.Struct); !ok {
			continue
		}
		if !types.Implements(types.NewPointer(named), nodeIface) {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	result := make([]*nodeType, 0, len(names))
	for _, name := range names {
		result = append(result, &nodeType{name: name})
	}
	return result
}

// structFieldTargetName resolves a field's static type to the name of the
// concrete struct type it (or its slice/pointer element) refers to. Returns
// ok=false for anything that isn't ultimately a named struct (interfaces,
// scalars, `Pos`, slices of non-struct element types, ...).
func structFieldTargetName(t types.Type) (name string, ok bool) {
	elem := t
	if s, isSlice := t.Underlying().(*types.Slice); isSlice {
		elem = s.Elem()
	}
	if p, isPtr := elem.(*types.Pointer); isPtr {
		elem = p.Elem()
	}
	named, isNamed := elem.(*types.Named)
	if !isNamed {
		return "", false
	}
	if _, isStruct := named.Underlying().(*types.Struct); !isStruct {
		return "", false
	}
	return named.Obj().Name(), true
}

// discoverAuxStructTypes finds every named struct type reachable
// (transitively) via a struct-typed field of a known type, that does *not*
// itself implement syntax.Node. mvdan/sh's `Slice`/`Replace`/`Expansion`
// (all three reachable only from `ParamExp`) are exactly this: concrete
// helper structs with no `Pos()`/`End()`, so typedjson never discriminates
// them with a "Type" key — they need a static schema entry exactly like any
// other undiscriminated struct-typed field, or their entire subtree
// silently vanishes during normalization (see issue #13).
//
// Discovered structurally (BFS over field types, starting from `known`) so
// a future mvdan/sh version adding another such helper struct — anywhere,
// not just under ParamExp — doesn't silently need a hand update here.
func discoverAuxStructTypes(pkg *types.Package, known map[string]bool) []string {
	scope := pkg.Scope()
	found := make(map[string]bool)
	visited := make(map[string]bool, len(known))
	frontier := make([]string, 0, len(known))
	for name := range known {
		frontier = append(frontier, name)
	}

	for len(frontier) > 0 {
		name := frontier[len(frontier)-1]
		frontier = frontier[:len(frontier)-1]
		if visited[name] {
			continue
		}
		visited[name] = true

		obj, ok := scope.Lookup(name).(*types.TypeName)
		if !ok {
			continue
		}
		named, ok := obj.Type().(*types.Named)
		if !ok {
			continue
		}
		st, ok := named.Underlying().(*types.Struct)
		if !ok {
			continue
		}
		for i := range st.NumFields() {
			f := st.Field(i)
			if !f.Exported() {
				continue
			}
			targetName, isStruct := structFieldTargetName(f.Type())
			if !isStruct || targetName == "Pos" {
				continue
			}
			if known[targetName] {
				continue // already a known Node-implementing type
			}
			if !found[targetName] {
				found[targetName] = true
			}
			if !visited[targetName] {
				frontier = append(frontier, targetName)
			}
		}
	}

	names := make([]string, 0, len(found))
	for name := range found {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// classifyFields fills in each node type's child-bearing fields by
// inspecting the underlying struct's field types directly.
func classifyFields(pkg *types.Package, nodeTypes []*nodeType, childIfaces map[string]*types.Named) {
	nodeTypeNames := make(map[string]bool, len(nodeTypes))
	for _, nt := range nodeTypes {
		nodeTypeNames[nt.name] = true
	}
	scope := pkg.Scope()

	for _, nt := range nodeTypes {
		obj := scope.Lookup(nt.name).(*types.TypeName)
		st := obj.Type().(*types.Named).Underlying().(*types.Struct)
		var fields []nodeField
		for i := range st.NumFields() {
			f := st.Field(i)
			if !f.Exported() {
				continue
			}
			field, ok := classifyFieldType(f.Type(), nodeTypeNames, childIfaces)
			if !ok {
				continue
			}
			field.goName = f.Name()
			field.jsonName = strings.ToLower(f.Name())
			fields = append(fields, field)
		}
		sort.Slice(fields, func(i, j int) bool { return fields[i].goName < fields[j].goName })
		nt.fields = fields
	}
}

// classifyFieldType classifies a single field's static type. `nodeTypeNames`
// covers both real Node-implementing struct types and the auxiliary structs
// `discoverAuxStructTypes` found (e.g. `Slice`/`Replace`/`Expansion`) — from
// this function's perspective they're classified identically, since both
// need their concrete type name injected by the schema rather than reading
// a typedjson "Type" discriminator. Returns ok=false for scalars, position
// fields, and fields whose target struct isn't in `nodeTypeNames` at all
// (i.e. it has no child-bearing fields of its own and was pruned as a leaf).
func classifyFieldType(t types.Type, nodeTypeNames map[string]bool, childIfaces map[string]*types.Named) (nodeField, bool) {
	slice := false
	elem := t
	if s, ok := t.Underlying().(*types.Slice); ok {
		slice = true
		elem = s.Elem()
	}
	if p, ok := elem.(*types.Pointer); ok {
		elem = p.Elem()
	}
	named, ok := elem.(*types.Named)
	if !ok {
		return nodeField{}, false
	}
	name := named.Obj().Name()
	if name == "Pos" {
		return nodeField{}, false
	}
	if _, ok := childIfaces[name]; ok {
		return nodeField{slice: slice, iface: name}, true
	}
	if nodeTypeNames[name] {
		return nodeField{slice: slice, childType: name}, true
	}
	return nodeField{}, false
}

// buildImplementers computes, for each child interface, the sorted list of
// concrete node type names whose pointer implements it — the exact union
// mvdan/sh allows wherever that interface is used as a field's static type.
func buildImplementers(pkg *types.Package, nodeTypes []*nodeType, childIfaces map[string]*types.Named) map[string][]string {
	scope := pkg.Scope()
	out := make(map[string][]string, len(childIfaces))
	for ifaceName, named := range childIfaces {
		iface := named.Underlying().(*types.Interface)
		var names []string
		for _, nt := range nodeTypes {
			obj := scope.Lookup(nt.name).(*types.TypeName)
			ptr := types.NewPointer(obj.Type().(*types.Named))
			if types.Implements(ptr, iface) {
				names = append(names, nt.name)
			}
		}
		sort.Strings(names)
		out[ifaceName] = names
	}
	return out
}

func header(version string) string {
	return fmt.Sprintf(
		"// Code generated by tools/gen-visitor-keys from mvdan.cc/sh/v3 %s. DO NOT EDIT.\n"+
			"// See design/ARCHITECTURE.md, \"The schema table is generated, not hand-written\".\n",
		version,
	)
}

func renderVisitorKeysJS(nodeTypes []*nodeType, version string) string {
	var b strings.Builder
	b.WriteString(header(version))
	b.WriteString("export const visitorKeys = {\n")
	for _, nt := range nodeTypes {
		names := make([]string, len(nt.fields))
		for i, f := range nt.fields {
			names[i] = f.jsonName
		}
		sort.Strings(names)
		b.WriteString("  " + jsKey(nt.name) + ": [")
		for i, n := range names {
			if i > 0 {
				b.WriteString(", ")
			}
			b.WriteString(jsString(n))
		}
		b.WriteString("],\n")
	}
	b.WriteString("};\n")
	return b.String()
}

func renderVisitorKeysDTS(version string) string {
	return header(version) +
		"/**\n" +
		" * Per-node-type traversal keys (lowercased field names, matching the\n" +
		" * normalizer's output shape). See design/ARCHITECTURE.md, \"The schema\n" +
		" * table is generated, not hand-written\" — re-exported publicly via\n" +
		" * `src/visitor-keys.ts`.\n" +
		" *\n" +
		" * @internal\n" +
		" */\n" +
		"export declare const visitorKeys: Record<string, string[]>;\n"
}

func renderChildTypeSchemaJS(nodeTypes []*nodeType, version string) string {
	var b strings.Builder
	b.WriteString(header(version))
	b.WriteString("export const CHILD_TYPE_SCHEMA = {\n")
	for _, nt := range nodeTypes {
		b.WriteString("  " + jsKey(nt.name) + ": {\n")
		fields := append([]nodeField(nil), nt.fields...)
		sort.Slice(fields, func(i, j int) bool { return fields[i].goName < fields[j].goName })
		for _, f := range fields {
			value := "null"
			if f.childType != "" {
				value = jsString(f.childType)
			}
			b.WriteString("    " + jsKey(f.goName) + ": " + value + ",\n")
		}
		b.WriteString("  },\n")
	}
	b.WriteString("};\n")
	return b.String()
}

func renderChildTypeSchemaDTS(version string) string {
	return header(version) +
		"/**\n" +
		" * `(parentType, fieldName) -> childType` for node fields whose static Go\n" +
		" * type is a concrete struct rather than an interface — typedjson only\n" +
		" * emits a \"Type\" discriminator for interface-typed fields, so these need\n" +
		" * the child type injected during normalization. A `null` value means the\n" +
		" * field's static type is a Node-derived interface (already\n" +
		" * self-discriminating). See design/ARCHITECTURE.md, \"The schema table is\n" +
		" * generated, not hand-written\".\n" +
		" *\n" +
		" * @internal\n" +
		" */\n" +
		"export declare const CHILD_TYPE_SCHEMA: Record<string, Record<string, string | null>>;\n"
}

// renderNodeTypesDTS emits one ShNode subtype per node type, plus a union
// alias per child interface (ShCommandNode, ShWordPartNode, ...) and an
// ShAnyNode union of every node type — criterion 3's "TypeScript node
// typings (ShNode subtypes for every node)".
//
// Deliberately self-contained (no `import type { ShNode } from
// '../src/types.js'` + `extends ShNode`): this file is a checked-in,
// hand-shaped .d.ts living outside the tsc-compiled src/dist graph, and API
// Extractor's dtsRollup only accepts compiler *output* (.d.ts) in that
// graph — a relative import reaching back into src/*.ts (never compiled at
// that path) fails its ae-wrong-input-file-type check. Structural typing
// means every interface here is still assignable to `ShNode` (same `type`,
// `range`, `loc` shape plus an index signature) without an explicit
// `extends`.
//
// Every well-known field is `readonly`, mirroring `ShNode`/`ShFile`'s
// "readonly by contract, not convention" typing in `src/types.ts` — a
// stronger-typed view of an immutable node shape should not itself claim to
// be more mutable than the base contract it's assignable to.
func renderNodeTypesDTS(nodeTypes []*nodeType, implementers map[string][]string, version string) string {
	var b strings.Builder
	b.WriteString(header(version))

	ifaceNames := make([]string, 0, len(implementers))
	for name := range implementers {
		ifaceNames = append(ifaceNames, name)
	}
	sort.Strings(ifaceNames)

	const baseFields = "" +
		"  readonly range: readonly [number, number];\n" +
		"  readonly loc: {\n" +
		"    readonly start: { readonly line: number; readonly column: number };\n" +
		"    readonly end: { readonly line: number; readonly column: number };\n" +
		"  };\n" +
		"  [field: string]: unknown;\n"

	for _, nt := range nodeTypes {
		b.WriteString(fmt.Sprintf("/**\n * mvdan/sh's `syntax.%s`, normalized.\n *\n * @public\n */\n", nt.name))
		b.WriteString(fmt.Sprintf("export interface Sh%sNode {\n", nt.name))
		b.WriteString(fmt.Sprintf("  readonly type: %s;\n", jsString(nt.name)))
		b.WriteString(baseFields)
		fields := append([]nodeField(nil), nt.fields...)
		sort.Slice(fields, func(i, j int) bool { return fields[i].jsonName < fields[j].jsonName })
		for _, f := range fields {
			var elemTS string
			if f.iface != "" {
				elemTS = "Sh" + f.iface + "Node"
			} else {
				elemTS = "Sh" + f.childType + "Node"
			}
			if f.slice {
				b.WriteString(fmt.Sprintf("  readonly %s: readonly %s[];\n", f.jsonName, elemTS))
			} else {
				b.WriteString(fmt.Sprintf("  readonly %s?: %s;\n", f.jsonName, elemTS))
			}
		}
		b.WriteString("}\n\n")
	}

	for _, ifaceName := range ifaceNames {
		members := implementers[ifaceName]
		tsMembers := make([]string, len(members))
		for i, m := range members {
			tsMembers[i] = "Sh" + m + "Node"
		}
		b.WriteString(fmt.Sprintf(
			"/**\n * The union of concrete node types mvdan/sh's `syntax.%s` interface can\n * hold.\n *\n * @public\n */\n",
			ifaceName,
		))
		b.WriteString(fmt.Sprintf("export type Sh%sNode = %s;\n\n", ifaceName, strings.Join(tsMembers, " | ")))
	}

	allNames := make([]string, len(nodeTypes))
	for i, nt := range nodeTypes {
		allNames[i] = "Sh" + nt.name + "Node"
	}
	b.WriteString("/**\n * The union of every normalized node type this bridge can produce.\n *\n * @public\n */\n")
	b.WriteString(fmt.Sprintf("export type ShAnyNode = %s;\n\n", strings.Join(allNames, " | ")))

	typeNameLiterals := make([]string, len(nodeTypes))
	for i, nt := range nodeTypes {
		typeNameLiterals[i] = jsString(nt.name)
	}
	b.WriteString("/**\n * Every normalized node `type` string this bridge can produce.\n *\n * @public\n */\n")
	b.WriteString(fmt.Sprintf("export type ShNodeTypeName = %s;\n", strings.Join(typeNameLiterals, " | ")))

	return b.String()
}

func jsKey(name string) string {
	// All Go field/type names here are valid JS identifiers (letters only),
	// so an unquoted key is safe and matches typical generated-code style.
	return name
}

func jsString(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "\\'") + "'"
}
