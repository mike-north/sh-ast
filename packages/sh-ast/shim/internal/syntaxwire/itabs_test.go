package syntaxwire

import (
	"reflect"
	"sort"
	"testing"
)

// The warm-up must cover every interface the bridge converts to at run time.
// The expected set is written by hand from the pinned mvdan.cc/sh/v3 v3.13.1
// syntax package, independently of the reflection that derives it; a new
// interface-typed field upstream fails here until it is reviewed.
func TestWarmupCoversEverySyntaxInterface(t *testing.T) {
	var got []string
	for _, iface := range syntaxInterfaces() {
		got = append(got, iface.String())
	}
	sort.Strings(got)
	want := []string{"syntax.ArithmExpr", "syntax.Command", "syntax.Loop", "syntax.Node", "syntax.TestExpr", "syntax.WordPart"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("syntax interfaces %v; want %v", got, want)
	}
}
