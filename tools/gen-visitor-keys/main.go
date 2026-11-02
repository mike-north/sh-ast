// Command gen-visitor-keys derives the faithful syntax records, exact constants,
// and complete field metadata from mvdan/sh compiler type information. Generated
// ordering is deterministic metadata order, not the upstream Walk protocol.
package main

import (
	"flag"
	"go/types"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

// syntaxPkgPath identifies the upstream contract whose pinned types are inspected.
const syntaxPkgPath = "mvdan.cc/sh/v3/syntax"

// nodeType names a concrete upstream struct implementing syntax.Node.
type nodeType struct{ name string }

// main writes the complete supported artifact set to the requested directory.
func main() {
	outDir := flag.String("out", "", "output directory for generated files (required)")
	flag.Parse()
	if *outDir == "" {
		log.Fatal("gen-visitor-keys: -out is required")
	}
	loaded := loadSyntaxPackage()
	faithful, err := buildFaithfulSchema(loaded)
	if err != nil {
		log.Fatalf("gen-visitor-keys: faithful schema: %v", err)
	}
	version := mvdanShVersion(loaded)
	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		log.Fatalf("gen-visitor-keys: %v", err)
	}
	writeFile(filepath.Join(*outDir, "syntax-types.d.ts"), renderFaithfulTypes(faithful, version))
	writeFile(filepath.Join(*outDir, "syntax-constants.js"), renderFaithfulConstantsJS(faithful, version))
	writeFile(filepath.Join(*outDir, "syntax-constants.d.ts"), renderFaithfulConstantsDTS(faithful, version))
	writeFile(filepath.Join(*outDir, "syntax-schema.js"), renderFaithfulSchemaJS(faithful, version))
	writeFile(filepath.Join(*outDir, "syntax-schema.d.ts"), renderFaithfulSchemaDTS(faithful, version))
}

// writeFile replaces one generated artifact, failing the command on incomplete output.
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

// loadSyntaxPackage resolves the pinned compiler types, source comments, and module identity.
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

// lookupInterface obtains an upstream interface contract for method-set discovery.
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
// helper structs with no `Pos()`/`End()`. Their fields remain part of the
// complete data model even though these records are not syntax.Nodes.
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

// jsString quotes upstream identifier text for a TypeScript string literal.
func jsString(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "\\'") + "'"
}
