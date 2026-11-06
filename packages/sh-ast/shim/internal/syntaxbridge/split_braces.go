// SplitBraces transport preserves the upstream transformation and observes only
// which input WordPart interfaces survive it. This narrow provenance restores
// JS identities; it does not introduce a general Go pointer or storage model.
package syntaxbridge

import (
	"encoding/json"

	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

// splitBraces invokes selected Go syntax exactly once. False has no replacement
// payload because upstream leaves the caller's Word untouched. Native panics use
// Process's InternalError boundary rather than becoming analysis uncertainty.
func splitBraces(payload string) map[string]any {
	node, err := syntaxwire.DecodeNode([]byte(payload))
	if err != nil {
		return errorResponse("InputError", err.Error())
	}
	word, ok := node.(*syntax.Word)
	if !ok || word == nil {
		return errorResponse("InputError", "SplitBraces requires a non-nil Word")
	}
	origins := make(map[syntax.WordPart][]int, len(word.Parts))
	for i, part := range word.Parts {
		origins[part] = append(origins[part], i)
	}
	if !syntax.SplitBraces(word) {
		return map[string]any{"Changed": false}
	}
	retained := retainedBraceParts(word, origins)
	encoded, err := syntaxwire.Encode(word)
	if err != nil {
		return errorResponse("InputError", err.Error())
	}
	return map[string]any{"Changed": true, "Word": json.RawMessage(encoded), "RetainedParts": retained}
}

// retainedBracePart locates one reused input occurrence. Paths alternate a
// Word.Parts index and BraceExp.Elems index, ending at the retained part. Nil
// interfaces can compare equal across input occurrences; ordered queues retain
// those occurrences without collapsing distinct JS typed-nil tags into one.
type retainedBracePart struct {
	Input int
	Path  []int
}

// braceWordFrame walks newly created brace/word containers in source order.
// Existing input parts are terminal: retaining the whole object also preserves
// its original nested aliases. An explicit stack avoids extra native recursion.
type braceWordFrame struct {
	word *syntax.Word
	path []int
	next int
}

func retainedBraceParts(word *syntax.Word, origins map[syntax.WordPart][]int) []retainedBracePart {
	retained := make([]retainedBracePart, 0)
	stack := []braceWordFrame{{word: word}}
	for len(stack) > 0 {
		frame := &stack[len(stack)-1]
		if frame.next >= len(frame.word.Parts) {
			stack = stack[:len(stack)-1]
			continue
		}
		index := frame.next
		frame.next++
		part := frame.word.Parts[index]
		path := append(append([]int(nil), frame.path...), index)
		if inputs := origins[part]; len(inputs) > 0 {
			retained = append(retained, retainedBracePart{Input: inputs[0], Path: path})
			origins[part] = inputs[1:]
			continue
		}
		brace, ok := part.(*syntax.BraceExp)
		if !ok || brace == nil {
			continue
		}
		// Push in reverse so the first element is observed before its siblings.
		for i := len(brace.Elems) - 1; i >= 0; i-- {
			stack = append(stack, braceWordFrame{word: brace.Elems[i], path: append(append([]int(nil), path...), i)})
		}
	}
	return retained
}
