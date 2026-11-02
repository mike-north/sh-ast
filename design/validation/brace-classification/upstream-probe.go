// This standalone probe records pinned-upstream versus Bash argument semantics.
// It does not supply runtime behavior or derive the analyzer test expectations.
package main

import (
	"encoding/json"
	"fmt"
	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/syntax"
	"os/exec"
	"strings"
)

// main prints one JSON evidence record per fixed, harmless argument fixture.
func main() {
	for _, source := range []string{`{a,b}`, `{a}`, `{}`, `a{b`, `{a,b`, `\{a,b\}`, `a{b\,c}`, `{a,b\}`, `\\{a,b}`, `\\\{a,b}`, `{a\,b,c}`, `{a,"b"}`, `"{"a,b"}"`, `{a,'b'}`, `{a,{b,c}}`, `{a,b{c,d}`, `{1..3}`, `{1\2..14}`, `{a,$x}`} {
		f, e := syntax.NewParser().Parse(strings.NewReader("echo "+source), "")
		if e != nil {
			panic(e)
		}
		w := f.Stmts[0].Cmd.(*syntax.CallExpr).Args[1]
		cp := *w
		changed := syntax.SplitBraces(&cp)
		count := 0
		for _, p := range cp.Parts {
			if _, ok := p.(*syntax.BraceExp); ok {
				count++
			}
		}
		fields, err := expand.Fields(&expand.Config{Env: expand.ListEnviron("x=VALUE")}, w)
		b, be := exec.Command("/bin/bash", "-c", `x=VALUE; printf '<%s>\n' `+source).CombinedOutput()
		out := map[string]any{"source": source, "splitReturned": changed, "topLevelBraces": count, "upstreamFields": fields, "upstreamError": fmt.Sprint(err), "bash": string(b), "bashError": fmt.Sprint(be)}
		v, _ := json.Marshal(out)
		fmt.Println(string(v))
	}
}
