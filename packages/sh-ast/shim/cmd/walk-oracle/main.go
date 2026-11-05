// Command walk-oracle records actual pinned syntax.Walk observations without
// importing the production bridge, codec, generated schema, or TypeScript walker.
// Run from shim with -out ../test/fixtures/walk-oracle.json to refresh fixtures.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

// specification selects a source or a hand-built Go shape and callback behavior.
type specification struct {
	ID      string             `json:"id"`
	Setup   string             `json:"setup"`
	Mode    string             `json:"mode,omitempty"`
	Source  string             `json:"source,omitempty"`
	Variant syntax.LangVariant `json:"variant,omitempty"`
}

// event describes callback values without calling Pos/End and altering failure behavior.
type event struct {
	Type   string `json:"type"`
	Value  string `json:"value,omitempty"`
	Kind   string `json:"kind,omitempty"`
	Origin string `json:"origin,omitempty"`
}

// commentState observes value-copy versus pointer mutations after a walk completes or panics.
type commentState struct {
	Path   string `json:"path"`
	Text   string `json:"text"`
	Offset uint   `json:"offset"`
}

// observation retains successful prefixes even when upstream aborts traversal.
type observation struct {
	specification
	Events   []event        `json:"events"`
	Panic    string         `json:"panic,omitempty"`
	Comments []commentState `json:"comments,omitempty"`
}

// sliceObservation exposes storage facts absent from ordinary serialized arrays.
type sliceObservation struct {
	Capacity    int      `json:"capacity,omitempty"`
	Mutation    string   `json:"mutation"`
	Trace       []string `json:"trace"`
	FinalLength int      `json:"finalLength"`
}

// word supplies explicit token positions; no parser or bridge derives its shape.
func word(value string, offset uint) *syntax.Word {
	return &syntax.Word{Parts: []syntax.WordPart{&syntax.Lit{Value: value, ValuePos: syntax.NewPos(offset, 1, offset+1), ValueEnd: syntax.NewPos(offset+uint(len(value)), 1, offset+uint(len(value))+1)}}}
}

// comment creates an independently positioned upstream comment value.
func comment(value string, offset uint) syntax.Comment {
	return syntax.Comment{Text: value, Hash: syntax.NewPos(offset, 1, offset+1)}
}

// statement is a minimal invoked command, with no statement comments of its own.
func statement(value string, offset uint) *syntax.Stmt {
	return &syntax.Stmt{Position: syntax.NewPos(offset, 1, offset+1), Cmd: &syntax.CallExpr{Args: []*syntax.Word{word(value, offset)}}}
}

// construct uses real Go types, including nil interfaces and concrete nil pointers.
func construct(spec specification) syntax.Node {
	switch spec.Setup {
	case "source":
		file, err := syntax.NewParser(syntax.KeepComments(true), syntax.Variant(spec.Variant)).Parse(strings.NewReader(spec.Source), spec.ID+".sh")
		if err != nil {
			panic(fmt.Sprintf("oracle source %s: %v", spec.ID, err))
		}
		return file
	case "call":
		args := make([]*syntax.Word, 2, 4)
		args[0] = word("a", 1)
		args[1] = word("b", 3)
		return &syntax.CallExpr{Args: args}
	case "assign-before-args":
		return &syntax.CallExpr{Assigns: []*syntax.Assign{{Name: &syntax.Lit{Value: "A"}, Value: word("seed", 2)}}, Args: []*syntax.Word{word("old", 10)}}
	case "stmt-comments", "stmt-overflow", "file-comments":
		stmt := statement("cmd", 10)
		stmt.Comments = []syntax.Comment{comment("leading", 0), comment("trailing", 20), comment("ignored", 30)}
		if spec.Setup == "stmt-overflow" {
			stmt.Semicolon = syntax.NewPos(1<<32-12, 1, 1<<14-1)
			stmt.Coprocess = true
		}
		if spec.Setup == "file-comments" {
			return &syntax.File{Stmts: []*syntax.Stmt{stmt}, Last: []syntax.Comment{comment("last", 40)}}
		}
		return stmt
	case "case-comments", "case-recovered":
		item := &syntax.CaseItem{Patterns: []*syntax.Word{word("pattern", 10)}, Stmts: []*syntax.Stmt{statement("cmd", 20)}, Comments: []syntax.Comment{comment("leading", 0), comment("trailing", 30), comment("ignored", 40)}, Last: []syntax.Comment{comment("last", 50)}}
		if spec.Setup == "case-recovered" {
			file, err := syntax.NewParser(syntax.RecoverErrors(1)).Parse(strings.NewReader("(echo"), "")
			if err != nil {
				panic(err)
			}
			item.Patterns[0].Parts[0].(*syntax.Lit).ValuePos = file.Stmts[0].Cmd.(*syntax.Subshell).Rparen
		}
		return item
	case "array-comments", "array-invalid":
		elem := &syntax.ArrayElem{Index: word("index", 10), Value: word("value", 20), Comments: []syntax.Comment{comment("leading", 0), comment("trailing", 30), comment("ignored", 40)}}
		if spec.Setup == "array-invalid" {
			elem.Index.(*syntax.Word).Parts[0].(*syntax.Lit).ValuePos = syntax.NewPos(25, 0, 0)
			elem.Comments[0].Hash = syntax.NewPos(20, 1, 21)
		}
		return elem
	case "param-aux":
		return &syntax.ParamExp{Param: &syntax.Lit{Value: "p"}, Slice: &syntax.Slice{Offset: word("first", 1), Length: word("old-length", 2)}, Repl: &syntax.Replace{Orig: word("orig", 3), With: word("old-with", 4)}, Exp: &syntax.Expansion{Word: word("fallback", 5)}}
	case "nil-parts":
		return &syntax.Word{Parts: []syntax.WordPart{nil, &syntax.Lit{Value: "after"}}}
	case "nil-args":
		return &syntax.CallExpr{Args: []*syntax.Word{nil, word("after", 2)}}
	case "nil-required":
		return &syntax.BinaryCmd{Y: statement("after", 2)}
	case "empty-pattern-boundary":
		return &syntax.CaseItem{Comments: []syntax.Comment{comment("leading", 0)}}
	case "nil-pattern-boundary":
		return &syntax.CaseItem{Patterns: []*syntax.Word{nil}, Comments: []syntax.Comment{comment("leading", 0)}}
	case "empty-word-boundary":
		return &syntax.Stmt{Comments: []syntax.Comment{comment("leading", 0)}, Cmd: &syntax.CallExpr{Args: []*syntax.Word{{}}}}
	case "nil-command-boundary":
		var call *syntax.CallExpr
		return &syntax.Stmt{Comments: []syntax.Comment{comment("leading", 0)}, Cmd: call}
	case "optional-nil":
		return &syntax.Assign{}
	case "typed-nil-Lit":
		var node *syntax.Lit
		return node
	case "typed-nil-Comment":
		var node *syntax.Comment
		return node
	case "typed-nil-SglQuoted":
		var node *syntax.SglQuoted
		return node
	case "typed-nil-Word":
		var node *syntax.Word
		return node
	case "typed-nil-BraceExp":
		var node *syntax.BraceExp
		return node
	case "brace":
		return &syntax.BraceExp{Elems: []*syntax.Word{word("a", 1), word("b", 3)}}
	case "cycle":
		block := &syntax.Block{}
		block.Stmts = []*syntax.Stmt{{Cmd: block}}
		return block
	default:
		panic("unknown oracle setup: " + spec.Setup)
	}
}

// commentOrigins discovers actual slice-element addresses, never traversal order.
func commentOrigins(root syntax.Node) map[*syntax.Comment]string {
	result := map[*syntax.Comment]string{}
	seen := map[uintptr]bool{}
	commentType := reflect.TypeFor[syntax.Comment]()
	var visit func(reflect.Value, string)
	visit = func(value reflect.Value, path string) {
		if !value.IsValid() {
			return
		}
		switch value.Kind() {
		case reflect.Interface:
			if !value.IsNil() {
				visit(value.Elem(), path)
			}
		case reflect.Pointer:
			if value.IsNil() || seen[value.Pointer()] {
				return
			}
			seen[value.Pointer()] = true
			visit(value.Elem(), path)
		case reflect.Struct:
			if value.Type() == commentType {
				result[value.Addr().Interface().(*syntax.Comment)] = path
				return
			}
			for i := range value.NumField() {
				if value.Type().Field(i).IsExported() {
					visit(value.Field(i), path+"."+value.Type().Field(i).Name)
				}
			}
		case reflect.Slice:
			for i := range value.Len() {
				visit(value.Index(i), fmt.Sprintf("%s[%d]", path, i))
			}
		}
	}
	visit(reflect.ValueOf(root), "$")
	return result
}

// describe recognizes typed nil values before dereferencing literal/comment fields.
func describe(node syntax.Node, origins map[*syntax.Comment]string) event {
	if node == nil {
		return event{Type: "nil"}
	}
	value := reflect.ValueOf(node)
	kind := value.Type().Elem().Name()
	if value.IsNil() {
		return event{Type: "TypedNil", Kind: kind}
	}
	entry := event{Type: kind}
	switch node := node.(type) {
	case *syntax.Lit:
		entry.Value = node.Value
	case *syntax.Comment:
		entry.Value = node.Text
		entry.Origin = origins[node]
		if entry.Origin == "" {
			entry.Origin = "copy"
		}
	}
	return entry
}

// eventLabel keeps the small hand-derived native assertions readable.
func eventLabel(entry event) string {
	if entry.Kind != "" {
		return entry.Type + ":" + entry.Kind
	}
	if entry.Value != "" {
		return entry.Type + ":" + entry.Value
	}
	return entry.Type
}

// observe executes the real upstream walker and records caller-controlled edits and panic unwinding.
func observe(spec specification) (result observation) {
	result.specification = spec
	root := construct(spec)
	origins := commentOrigins(root)
	var stack []string
	reentered := false
	defer func() {
		if failure := recover(); failure != nil {
			result.Panic = fmt.Sprint(failure)
		}
		for node, path := range commentOrigins(root) {
			result.Comments = append(result.Comments, commentState{path, node.Text, node.Hash.Offset()})
		}
		sort.Slice(result.Comments, func(i, j int) bool { return result.Comments[i].Path < result.Comments[j].Path })
	}()
	var callback func(syntax.Node) bool
	callback = func(node syntax.Node) bool {
		entry := describe(node, origins)
		result.Events = append(result.Events, entry)
		if spec.Mode == "prune-root" && len(result.Events) == 1 {
			return false
		}
		if spec.Mode == "prune-nested" && entry.Type == "CmdSubst" {
			return false
		}
		if spec.Mode == "prune-typed-nil" && entry.Type == "TypedNil" {
			return false
		}
		if node == nil {
			exited := ""
			if len(stack) > 0 {
				exited = stack[len(stack)-1]
				stack = stack[:len(stack)-1]
			}
			if spec.Mode == "panic-exit" && exited == "Stmt" {
				panic("callback-exit")
			}
			return spec.Mode != "exit-false" && spec.Mode != "nil-false"
		}
		stack = append(stack, entry.Type)
		if spec.Mode == "force-boundaries" {
			// A source node with no comments otherwise need not evaluate its
			// methods during Walk. These comments force the real upstream
			// live boundary paths across the grammar fixtures.
			switch node := node.(type) {
			case *syntax.Stmt:
				node.Comments = []syntax.Comment{comment("boundary-probe", 0)}
			case *syntax.CaseItem:
				node.Comments = []syntax.Comment{comment("boundary-probe", 0)}
			case *syntax.ArrayElem:
				node.Comments = []syntax.Comment{comment("boundary-probe", 0)}
			}
		}
		if spec.Mode == "replace-before-range" && node == root {
			root.(*syntax.CallExpr).Args = []*syntax.Word{word("fresh", 1)}
		}
		if lit, ok := node.(*syntax.Lit); ok && lit != nil {
			if lit.Value == "a" {
				switch spec.Mode {
				case "slot-replace":
					root.(*syntax.CallExpr).Args[1] = word("replacement", 3)
				case "field-replace":
					root.(*syntax.CallExpr).Args = []*syntax.Word{word("fresh", 1)}
				case "append-and-replace":
					call := root.(*syntax.CallExpr)
					call.Args = append(call.Args, word("appended", 5))
					call.Args[1] = word("replacement", 3)
				case "reenter":
					if !reentered {
						reentered = true
						syntax.Walk(word("inner", 1), callback)
					}
				}
			}
			if lit.Value == "A" && spec.Mode == "assign-args" {
				root.(*syntax.CallExpr).Args = []*syntax.Word{word("fresh", 10)}
			}
			if lit.Value == "first" {
				switch spec.Mode {
				case "aux-replace":
					root.(*syntax.ParamExp).Slice = &syntax.Slice{Length: word("new-length", 6)}
				case "aux-nil":
					root.(*syntax.ParamExp).Slice = nil
				}
			}
			if lit.Value == "orig" && spec.Mode == "aux-replace" {
				root.(*syntax.ParamExp).Repl = &syntax.Replace{With: word("new-with", 7)}
			}
			if lit.Value == "orig" && spec.Mode == "repl-nil" {
				root.(*syntax.ParamExp).Repl = nil
			}
			if lit.Value == "cmd" && (spec.Mode == "panic-child" || spec.Mode == "panic-child-and-deferred") {
				panic("callback-child")
			}
		}
		if c, ok := node.(*syntax.Comment); ok && c != nil {
			if spec.Mode == "comments-mutate" {
				c.Text += "!"
				c.Hash = syntax.NewPos(99, 1, 100)
			}
			if c.Text == "trailing" && spec.Mode == "panic-child-and-deferred" {
				panic("callback-deferred")
			}
			if c.Text == "leading" && spec.Mode == "move-boundary" {
				switch root := root.(type) {
				case *syntax.Stmt:
					root.Semicolon = syntax.NewPos(200, 1, 201)
				case *syntax.CaseItem:
					root.Patterns[0].Parts[0].(*syntax.Lit).ValuePos = syntax.NewPos(200, 1, 201)
				case *syntax.ArrayElem:
					root.Index.(*syntax.Word).Parts[0].(*syntax.Lit).ValuePos = syntax.NewPos(200, 1, 201)
				}
			}
		}
		return true
	}
	syntax.Walk(root, callback)
	return
}

// storageProbes retain minimal runnable evidence for the representation decision.
func storageProbes() []sliceObservation {
	var result []sliceObservation
	for _, capacity := range []int{2, 4} {
		args := make([]*syntax.Word, 2, capacity)
		args[0] = word("a", 1)
		args[1] = word("b", 3)
		root := &syntax.CallExpr{Args: args}
		observation := sliceObservation{Capacity: capacity, Mutation: "append then replace slot"}
		syntax.Walk(root, func(node syntax.Node) bool {
			if lit, ok := node.(*syntax.Lit); ok {
				observation.Trace = append(observation.Trace, lit.Value)
				if lit.Value == "a" {
					root.Args = append(root.Args, word("c", 5))
					root.Args[1] = word("replacement", 3)
				}
			}
			return true
		})
		observation.FinalLength = len(root.Args)
		result = append(result, observation)
	}
	root := &syntax.CallExpr{Args: []*syntax.Word{word("a", 1), word("b", 3), word("c", 5)}}
	observation := sliceObservation{Mutation: "replace slot then reslice to length one"}
	syntax.Walk(root, func(node syntax.Node) bool {
		if lit, ok := node.(*syntax.Lit); ok {
			observation.Trace = append(observation.Trace, lit.Value)
			if lit.Value == "a" {
				root.Args[1] = word("replacement", 3)
				root.Args = root.Args[:1]
			}
		}
		return true
	})
	observation.FinalLength = len(root.Args)
	result = append(result, observation)
	file := &syntax.File{Last: []syntax.Comment{comment("before", 0)}}
	commentObservation := sliceObservation{Mutation: "replace active comment value slot", FinalLength: 1}
	syntax.Walk(file, func(node syntax.Node) bool {
		if c, ok := node.(*syntax.Comment); ok {
			commentObservation.Trace = append(commentObservation.Trace, c.Text)
			file.Last[0] = comment("after", 0)
			commentObservation.Trace = append(commentObservation.Trace, c.Text)
		}
		return true
	})
	return append(result, commentObservation)
}

// specifications combine broad hand-authored grammar fixtures with isolated semantic probes.
func specifications(fixtures string) []specification {
	var specs []specification
	for _, item := range []struct {
		name    string
		variant syntax.LangVariant
	}{{"bash", syntax.LangBash}, {"zsh", syntax.LangZsh}, {"bats", syntax.LangBats}} {
		source, err := os.ReadFile(filepath.Join(fixtures, "kitchen-sink."+item.name+".sh"))
		if err != nil {
			panic(err)
		}
		specs = append(specs, specification{ID: "grammar-" + item.name, Setup: "source", Source: string(source), Variant: item.variant})
		specs = append(specs, specification{ID: "grammar-boundaries-" + item.name, Setup: "source", Source: string(source), Variant: item.variant, Mode: "force-boundaries"})
	}
	specs = append(specs, specification{ID: "unicode-comments", Setup: "source", Source: "# 前 🎉\nFOO=$(準備) printf '你好' >結果 # 後\n# 終\n", Variant: syntax.LangBash})
	for _, mode := range []string{"prune-root", "prune-nested", "exit-false"} {
		specs = append(specs, specification{ID: mode, Setup: "source", Mode: mode, Source: "echo $(hidden) tail; other", Variant: syntax.LangBash})
	}
	for _, mode := range []string{"replace-before-range", "slot-replace", "field-replace", "append-and-replace", "reenter"} {
		specs = append(specs, specification{ID: mode, Setup: "call", Mode: mode})
	}
	specs = append(specs, specification{ID: "assign-args", Setup: "assign-before-args", Mode: "assign-args"})
	for _, setup := range []string{"stmt-comments", "case-comments", "array-comments", "file-comments"} {
		specs = append(specs, specification{ID: setup, Setup: setup}, specification{ID: setup + "-copy", Setup: setup, Mode: "comments-mutate"})
		if setup != "file-comments" {
			specs = append(specs, specification{ID: setup + "-move", Setup: setup, Mode: "move-boundary"})
		}
	}
	for _, mode := range []string{"panic-child", "panic-exit", "panic-child-and-deferred"} {
		specs = append(specs, specification{ID: mode, Setup: "stmt-comments", Mode: mode})
	}
	for _, mode := range []string{"", "aux-replace", "aux-nil", "repl-nil"} {
		specs = append(specs, specification{ID: "param-" + mode, Setup: "param-aux", Mode: mode})
	}
	for _, setup := range []string{"nil-parts", "nil-args", "nil-required", "empty-pattern-boundary", "nil-pattern-boundary", "empty-word-boundary", "nil-command-boundary", "optional-nil", "typed-nil-Lit", "typed-nil-Comment", "typed-nil-SglQuoted", "typed-nil-Word", "typed-nil-BraceExp", "brace", "stmt-overflow", "case-recovered", "array-invalid"} {
		specs = append(specs, specification{ID: setup, Setup: setup})
	}
	specs = append(specs, specification{ID: "nil-parts-pruned", Setup: "nil-parts", Mode: "nil-false"}, specification{ID: "nil-args-pruned", Setup: "nil-args", Mode: "prune-typed-nil"}, specification{ID: "nil-required-pruned", Setup: "nil-required", Mode: "prune-typed-nil"}, specification{ID: "typed-nil-pruned", Setup: "typed-nil-Word", Mode: "prune-root"}, specification{ID: "brace-pruned", Setup: "brace", Mode: "prune-root"}, specification{ID: "cycle-pruned", Setup: "cycle", Mode: "prune-root"})
	return specs
}

// main emits replayable observations; it does not implement or approximate Walk.
func main() {
	fixtures := flag.String("fixtures", "../test/fixtures", "directory containing source fixtures")
	output := flag.String("out", "", "output JSON file; empty writes stdout")
	flag.Parse()
	report := struct {
		Upstream string             `json:"upstream"`
		Cases    []observation      `json:"cases"`
		Storage  []sliceObservation `json:"storageProbes"`
	}{Upstream: "mvdan.cc/sh/v3 v3.14.1", Storage: storageProbes()}
	for _, spec := range specifications(*fixtures) {
		report.Cases = append(report.Cases, observe(spec))
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		panic(err)
	}
	data = append(data, '\n')
	if *output == "" {
		_, err = os.Stdout.Write(data)
	} else {
		err = os.WriteFile(*output, data, 0o644)
	}
	if err != nil {
		panic(err)
	}
}
