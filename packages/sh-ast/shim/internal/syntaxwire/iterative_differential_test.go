package syntaxwire

// Differential proof that the explicit-stack encoder, validator and decoder behave
// exactly like the recursive implementations they replaced (kept in
// reference_recursive_test.go). Both run over every shell source the repository's
// tests parse and over deliberately malformed, cyclic and mutated graphs; bytes,
// collected occurrences, error text and decoded trees must be identical.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// referenceAppendRoot is appendRoot built on the recursive reference functions.
func referenceAppendRoot(dst []byte, root reflect.Value, w *writer) ([]byte, []syntax.Node, error) {
	start := len(dst)
	out, err := w.referenceAppendValue(dst, root, true, false)
	if err == nil {
		if w.nodes == nil {
			return out, nil, nil
		}
		return out, *w.nodes, nil
	}
	if original := referenceValidateValue(root, true, newAncestry()); original != nil {
		err = original
	}
	return dst[:start], nil, err
}

// encodeBoth encodes value with the production writer and the reference one in each
// of the three writer configurations and requires identical outputs.
func encodeBoth(t *testing.T, label string, value any) {
	t.Helper()
	configs := []struct {
		name    string
		compact bool
		collect bool
	}{{"plain", false, false}, {"occurrences", false, true}, {"parsed-file", true, true}}
	for _, config := range configs {
		newWriter := func() *writer {
			w := &writer{active: newAncestry(), compactPositions: config.compact}
			if config.collect {
				nodes := make([]syntax.Node, 0)
				w.nodes = &nodes
			}
			return w
		}
		prefix := []byte("prefix:")
		got, gotNodes, gotErr := appendRoot(prefix[:len(prefix):len(prefix)], reflect.ValueOf(value), newWriter())
		want, wantNodes, wantErr := referenceAppendRoot(prefix[:len(prefix):len(prefix)], reflect.ValueOf(value), newWriter())
		if string(got) != string(want) || errorText(gotErr) != errorText(wantErr) {
			t.Fatalf("%s/%s: got %q / %v; want %q / %v", label, config.name, truncate(got), gotErr, truncate(want), wantErr)
		}
		if len(gotNodes) != len(wantNodes) {
			t.Fatalf("%s/%s: %d occurrences; want %d", label, config.name, len(gotNodes), len(wantNodes))
		}
		for i := range gotNodes {
			if gotNodes[i] != wantNodes[i] {
				t.Fatalf("%s/%s: occurrence %d differs", label, config.name, i)
			}
		}
	}
}

func truncate(data []byte) string {
	if len(data) > 200 {
		return string(data[:200]) + "..."
	}
	return string(data)
}

// repositoryRoot is the checkout root, found from this package's directory.
func repositoryRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs("../../../../..")
	if err != nil {
		t.Fatal(err)
	}
	return root
}

// corpusSources collects the shell sources the repository's tests parse: the Go test
// literals below, the kitchen-sink fixtures, the walk oracle cases and the benchmark
// fixtures.
func corpusSources(t *testing.T) []string {
	t.Helper()
	root := repositoryRoot(t)
	sources := []string{
		"# 中\necho hi", "(foo |", "echo ${a/b/c} ${a:1:2}", "cat <<EOF\n🎉\nEOF\n", "",
		"a && b || c | d |& e", "echo $(( 1 + 2 * (3 - 4) )) $((x++)) ${x:-$(y)}",
		"for i in 1 2; do echo $i; done; while true; do :; done; until false; do break; done",
		"case $x in a|b) echo ab;; *) echo other;; esac", "f() { local x=1; return $x; }",
		"[[ -f x && ( -d y || $a == b* ) ]]", "arr=(a b [3]=c); declare -A m=([k]=v)",
		"cat <<-'EOF' >out 2>&1\n\tbody $x\nEOF\n", "time ! foo | bar &", "coproc x { cmd; }",
		"echo {a,b}{1..3} ~/x *.sh !(a|b) @(c)", "let a=1 b+=2", "echo 'q' \"d $x ${y}\" $'e'",
		"x=1 y=2 cmd; { a; b; } >f; (sub) 2>&1; echo a\xffb",
	}
	for _, pattern := range []string{"packages/sh-ast/test/fixtures/*.sh"} {
		matches, _ := filepath.Glob(filepath.Join(root, pattern))
		for _, name := range matches {
			data, err := os.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			sources = append(sources, string(data))
		}
	}
	var oracle struct {
		Cases []struct {
			Source string `json:"source"`
		} `json:"cases"`
	}
	if data, err := os.ReadFile(filepath.Join(root, "packages/sh-ast/test/fixtures/walk-oracle.json")); err == nil {
		if json.Unmarshal(data, &oracle) == nil {
			for _, c := range oracle.Cases {
				if c.Source != "" {
					sources = append(sources, c.Source)
				}
			}
		}
	}
	matches, _ := filepath.Glob(filepath.Join(root, "tools/benchmark/fixtures/*.json"))
	for _, name := range matches {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		var fixture struct {
			Source string `json:"source"`
		}
		if json.Unmarshal(data, &fixture) == nil && fixture.Source != "" {
			sources = append(sources, fixture.Source)
		}
	}
	return sources
}

var dialects = []syntax.LangVariant{syntax.LangBash, syntax.LangPOSIX, syntax.LangMirBSDKorn, syntax.LangBats, syntax.LangZsh}

// corpusFiles parses every source under every dialect that accepts it.
func corpusFiles(t *testing.T) []*syntax.File {
	t.Helper()
	var files []*syntax.File
	for _, source := range corpusSources(t) {
		for _, dialect := range dialects {
			file, err := syntax.NewParser(syntax.Variant(dialect), syntax.KeepComments(true), syntax.RecoverErrors(2)).Parse(strings.NewReader(source), "")
			if file != nil && (err == nil || len(file.Stmts) > 0) {
				files = append(files, file)
			}
		}
	}
	return files
}

func TestIterativeEncoderMatchesRecursiveReferenceOverCorpus(t *testing.T) {
	files := corpusFiles(t)
	if len(files) < 150 {
		t.Fatalf("corpus is too small to be meaningful: %d parsed files", len(files))
	}
	for i, file := range files {
		encodeBoth(t, fmt.Sprintf("file %d", i), file)
		// Every node of a sample of files as its own root: Stmt, Word, Lit, typed roots.
		if i%7 == 0 {
			syntax.Walk(file, func(node syntax.Node) bool {
				if node != nil {
					encodeBoth(t, fmt.Sprintf("file %d subtree %T", i, node), node)
				}
				return true
			})
		}
	}
}

// badPart satisfies WordPart through Lit but is not a registered syntax struct.
type badPart struct{ syntax.Lit }

// corrupt mutates a freshly parsed file in one of several ways that make encoding
// fail or take unusual paths, returning a description for failure messages.
func corrupt(file *syntax.File, random *rand.Rand) string {
	var stmts []*syntax.Stmt
	var words []*syntax.Word
	syntax.Walk(file, func(node syntax.Node) bool {
		switch n := node.(type) {
		case *syntax.Stmt:
			stmts = append(stmts, n)
		case *syntax.Word:
			words = append(words, n)
		}
		return true
	})
	if len(stmts) == 0 || len(words) == 0 {
		return "nothing to corrupt"
	}
	stmt := stmts[random.Intn(len(stmts))]
	word := words[random.Intn(len(words))]
	switch random.Intn(5) {
	case 0:
		// A cycle: a statement contains a subshell holding its own ancestor.
		stmt.Cmd = &syntax.Subshell{Stmts: []*syntax.Stmt{stmts[0], stmt}}
		return "cycle through root statement"
	case 1:
		word.Parts = append(word.Parts, &badPart{})
		return "unregistered struct in word"
	case 2:
		stmt.Cmd = &syntax.Subshell{Stmts: []*syntax.Stmt{stmt}}
		return "statement contains itself"
	case 3:
		word.Parts = append(word.Parts, (*badPart)(nil))
		return "unregistered typed nil"
	default:
		word.Parts = append(word.Parts, word.Parts...)
		return "duplicated parts"
	}
}

func TestIterativeEncoderMatchesRecursiveReferenceOnCorruptedGraphs(t *testing.T) {
	random := rand.New(rand.NewSource(1))
	rejected := 0
	for i, file := range corpusFiles(t) {
		if i%3 != 0 {
			continue
		}
		description := corrupt(file, random)
		encodeBoth(t, fmt.Sprintf("file %d (%s)", i, description), file)
		if _, err := Encode(file); err != nil {
			rejected++
		}
	}
	if rejected < 50 {
		t.Fatalf("only %d corrupted graphs were rejected; the corruptions prove nothing", rejected)
	}
}

func TestIterativeEncoderMatchesRecursiveReferenceOnSyntheticMalformedRecords(t *testing.T) {
	type malformed struct {
		Z      any
		A      any
		hidden bool
	}
	type nested struct {
		Z any
		A any
	}
	for _, typ := range []reflect.Type{reflect.TypeFor[malformed](), reflect.TypeFor[nested]()} {
		nodeTypes[typ.Name()] = typ
		defer delete(nodeTypes, typ.Name())
	}
	slice := make([]any, 1)
	slice[0] = slice
	for i, value := range []any{
		malformed{Z: int(1), A: make(chan int)}, malformed{Z: nil, A: make(chan int)}, malformed{},
		&nested{Z: &nested{Z: []any{methodSentinel("ok"), int64(1)}, A: make(chan bool)}, A: func() {}},
		nested{Z: slice, A: int(1)}, slice, []any{slice, slice}, nil, (*syntax.Word)(nil),
		[]any{"x", uint32(2), true, []string(nil), []string{}},
	} {
		encodeBoth(t, fmt.Sprintf("synthetic %d", i), value)
	}
}

// referenceDecodeAny is Decode built on the recursive decodeValue.
func referenceDecodeAny(value any) (any, error) {
	obj, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("syntax root must be an object")
	}
	if obj["Type"] == "TypedNil" {
		pointer, err := readTypedNil(obj)
		if err != nil {
			return nil, err
		}
		return pointer.Interface(), nil
	}
	name, ok := obj["Type"].(string)
	typ := nodeTypes[name]
	if !ok || typ == nil {
		return nil, fmt.Errorf("unknown syntax Type %q", name)
	}
	out := reflect.New(typ)
	if err := referenceDecodeValue(out.Elem(), value); err != nil {
		return nil, err
	}
	return out.Interface(), nil
}

// decodeAnyNew is Decode's body without the JSON read, to feed both decoders the
// same mutated value.
func decodeAnyNew(value any) (any, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return Decode(data)
}

// mutateValue edits a generic JSON value in place at a random position. Edits
// include removing and adding members, changing types and nulling values.
func mutateValue(root any, random *rand.Rand) {
	var containers []any
	pending := []any{root}
	for len(pending) > 0 {
		value := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		switch v := value.(type) {
		case map[string]any:
			containers = append(containers, v)
			for _, child := range v {
				pending = append(pending, child)
			}
		case []any:
			containers = append(containers, v)
			pending = append(pending, v...)
		}
	}
	if len(containers) == 0 {
		return
	}
	switch c := containers[random.Intn(len(containers))].(type) {
	case map[string]any:
		keys := make([]string, 0, len(c))
		for key := range c {
			keys = append(keys, key)
		}
		if len(keys) == 0 {
			return
		}
		sortStrings(keys)
		key := keys[random.Intn(len(keys))]
		switch random.Intn(7) {
		case 0:
			delete(c, key)
		case 1:
			c[key] = nil
		case 2:
			c[key] = "text"
		case 3:
			c[key] = json.Number("-1")
		case 4:
			c["Extra"] = true
		case 5:
			c[key] = []any{}
		default:
			if key == "Type" {
				c[key] = "Lit"
			} else {
				c[key] = map[string]any{"Type": "Word"}
			}
		}
	case []any:
		if len(c) == 0 {
			return
		}
		switch i := random.Intn(len(c)); random.Intn(3) {
		case 0:
			c[i] = nil
		case 1:
			c[i] = true
		default:
			c[i] = "x"
		}
	}
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}

func TestIterativeDecoderMatchesRecursiveReference(t *testing.T) {
	random := rand.New(rand.NewSource(2))
	rejected, accepted := 0, 0
	for i, file := range corpusFiles(t) {
		data, err := Encode(file)
		if err != nil {
			t.Fatal(err)
		}
		// Unmodified: decoded trees are deeply equal.
		value, err := ReadJSON(data)
		if err != nil {
			t.Fatal(err)
		}
		got, gotErr := Decode(data)
		want, wantErr := referenceDecodeAny(value)
		if errorText(gotErr) != errorText(wantErr) || !reflect.DeepEqual(got, want) {
			t.Fatalf("file %d: decode differs: %v / %v", i, gotErr, wantErr)
		}
		if gotErr == nil {
			accepted++
		}
		// Mutated: the same error text, and the same partially decoded result on success.
		for round := 0; round < 4; round++ {
			mutated, _ := ReadJSON(data)
			for edit := 0; edit <= round%2; edit++ {
				mutateValue(mutated, random)
			}
			encoded, _ := json.Marshal(mutated)
			got, gotErr := Decode(encoded)
			reread, _ := ReadJSON(encoded)
			want, wantErr := referenceDecodeAny(reread)
			if errorText(gotErr) != errorText(wantErr) || !reflect.DeepEqual(got, want) {
				t.Fatalf("file %d round %d: %v / %v", i, round, gotErr, wantErr)
			}
			if gotErr != nil {
				rejected++
			} else {
				accepted++
			}
		}
	}
	if rejected < 500 || accepted < 200 {
		t.Fatalf("mutations must produce both outcomes: %d rejected, %d accepted", rejected, accepted)
	}
}

func TestIterativeDecoderRetainsMessagesForMalformedInput(t *testing.T) {
	valid, err := Encode(&syntax.BinaryCmd{})
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{
		``, `{`, `[1,`, `nul`, `{"Type":"File"} {}`, `{"a":1,}`, `"unterminated`, `{"Type":"Missing"}`,
		strings.Replace(string(valid), `"Op":0`, `"Op":1.5`, 1), string(valid) + `x`,
	} {
		_, gotErr := ReadJSON([]byte(input))
		var want any
		decoder := json.NewDecoder(strings.NewReader(input))
		decoder.UseNumber()
		wantErr := decoder.Decode(&want)
		if wantErr == nil {
			var extra any
			if decoder.Decode(&extra) != io.EOF {
				wantErr = errors.New("expected exactly one JSON value")
			}
		}
		if errorText(gotErr) != errorText(wantErr) {
			t.Errorf("%q: got %v; want %v", input, gotErr, wantErr)
		}
	}
}
