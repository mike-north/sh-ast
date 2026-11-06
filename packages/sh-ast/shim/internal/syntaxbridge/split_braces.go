// SplitBraces transport preserves the upstream transformation and observes only
// which input WordPart interfaces survive it. This narrow provenance restores
// JS identities; it does not introduce a general Go pointer or storage model.
package syntaxbridge

import (
	"encoding/json"
	"fmt"
	"reflect"

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
	if depth := splitBracesOutputDepth(word); depth > 0 {
		return errorResponse("InternalError", fmt.Sprintf(
			"SplitBraces output record depth %d exceeds the bridge transport limit %d", depth, maxSplitBracesOutputDepth,
		))
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

// maxSplitBracesOutputDepth bounds recursive response encoding after the exact
// upstream transformation. One shallow literal can produce a very deep graph.
// This conservative empirical transport policy counts Go struct records,
// including position values; slices and interface/pointer wrappers add no units.
// It is distinct from parser work, grammar validity, and an arbitrary caller-stack
// guarantee. Refusing before serialization also avoids poisoning the shared VM.
const maxSplitBracesOutputDepth = 256

// splitOutputFrame retains one container cursor, so the preflight uses memory
// proportional to bounded depth rather than the width of a flat parts list.
type splitOutputFrame struct {
	value   reflect.Value
	depth   int
	next    int
	entered bool
}

// splitBracesOutputDepth iteratively inspects the result's structural records,
// without parsing brace text or imposing AST visitation semantics. The input
// codec and SplitBraces provide an acyclic data graph; unexported Go state is not
// transport data. Zero means within budget; otherwise the first excess is returned.
func splitBracesOutputDepth(word *syntax.Word) int {
	stack := []splitOutputFrame{{value: reflect.ValueOf(word)}}
	for len(stack) > 0 {
		frame := &stack[len(stack)-1]
		if !frame.entered {
			for frame.value.IsValid() && (frame.value.Kind() == reflect.Pointer || frame.value.Kind() == reflect.Interface) {
				if frame.value.IsNil() {
					frame.value = reflect.Value{}
					break
				}
				frame.value = frame.value.Elem()
			}
			if !frame.value.IsValid() {
				stack = stack[:len(stack)-1]
				continue
			}
			frame.entered = true
			if frame.value.Kind() == reflect.Struct {
				frame.depth++
				if frame.depth > maxSplitBracesOutputDepth {
					return frame.depth
				}
			}
		}
		var child reflect.Value
		switch frame.value.Kind() {
		case reflect.Struct:
			if frame.next >= frame.value.NumField() {
				stack = stack[:len(stack)-1]
				continue
			}
			index := frame.next
			frame.next++
			if frame.value.Type().Field(index).PkgPath != "" {
				continue
			}
			child = frame.value.Field(index)
		case reflect.Slice, reflect.Array:
			if frame.next >= frame.value.Len() {
				stack = stack[:len(stack)-1]
				continue
			}
			child = frame.value.Index(frame.next)
			frame.next++
		default:
			stack = stack[:len(stack)-1]
			continue
		}
		stack = append(stack, splitOutputFrame{value: child, depth: frame.depth})
	}
	return 0
}
