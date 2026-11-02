package syntaxbridge

import (
	"fmt"

	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

// wordBraces observes the pinned upstream brace grammar on a reconstructed,
// private Word. SplitBraces may rewrite malformed or singleton braces and return
// true without creating an expansion, so only actual BraceExp parts count. No
// expanded fields or rewritten tree cross the boundary. The analyzer separately
// rejects escape-uncertain candidates because upstream does not protect them.
func wordBraces(payload string) (result map[string]any) {
	defer func() {
		if failure := recover(); failure != nil {
			result = errorResponse("InputError", fmt.Sprintf("upstream brace observation: %v", failure))
		}
	}()
	node, err := syntaxwire.DecodeNode([]byte(payload))
	if err != nil {
		return errorResponse("InputError", err.Error())
	}
	word, ok := node.(*syntax.Word)
	if !ok || word == nil {
		return errorResponse("InputError", "brace observation requires a Word")
	}
	for _, part := range word.Parts {
		if part == nil {
			return errorResponse("InputError", "brace observation requires non-nil word parts")
		}
	}
	private := *word
	syntax.SplitBraces(&private)
	for _, part := range private.Parts {
		if _, ok := part.(*syntax.BraceExp); ok {
			return map[string]any{"Brace": true}
		}
	}
	return map[string]any{"Brace": false}
}
