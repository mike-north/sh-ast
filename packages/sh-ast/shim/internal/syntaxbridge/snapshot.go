package syntaxbridge

import (
	"fmt"
	"reflect"

	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

// positionSnapshot is an observation of one Node occurrence in the original
// parsed tree. Paths use exported Go field names and slice indices from File.
// Bounds and errors are separate metadata, never stored back into syntax records;
// later caller edits do not change these observations or make them live bounds.
type positionSnapshot struct {
	// Path identifies an occurrence, so shared pointers can have distinct entries.
	Path []any
	// Pos and End contain copied public coordinates, or null when that method panics.
	Pos *syntaxwire.Position
	End *syntaxwire.Position
	// Each error retains its own method's failure without hiding the other bound.
	PosError any
	EndError any
}

// parseWithPositions supplements a successful parse with original-tree bounds.
// Parser errors and partial Files retain the ordinary parse envelope unchanged;
// metadata failures cannot substitute for the parser's own structured result.
func parseWithPositions(source, options string) map[string]any {
	file, result := parseResult(source, options)
	if result["Error"] == nil {
		result["Positions"] = positionSnapshots(file)
	}
	return result
}

// positionSnapshots walks the already parsed, acyclic Go graph once. Reflection
// supplies only occurrence paths: Node membership and bounds come from upstream
// interfaces and methods. Auxiliary records are traversed for their real children
// but never become entries, and token position structs are not Nodes. This is an
// internal data pass with no upstream Walk callback order or control semantics.
func positionSnapshots(root syntax.Node) []positionSnapshot {
	entries := make([]positionSnapshot, 0)
	var visit func(reflect.Value, []any, bool)
	observe := func(node syntax.Node, path []any) {
		start, startError := snapshotPosition(node, syntax.Node.Pos)
		end, endError := snapshotPosition(node, syntax.Node.End)
		entries = append(entries, positionSnapshot{
			Path: append([]any{}, path...), Pos: start, End: end,
			PosError: startError, EndError: endError,
		})
	}
	visit = func(value reflect.Value, path []any, interfaceSlot bool) {
		if !value.IsValid() {
			return
		}
		for value.Kind() == reflect.Interface {
			interfaceSlot = true
			if value.IsNil() {
				return
			}
			value = value.Elem()
		}
		if value.Kind() == reflect.Pointer {
			if value.IsNil() && !interfaceSlot {
				return
			}
			// A typed-nil Node still has observable method failures. Observe it
			// before stopping descent; an ordinary nil pointer field is absent.
			if node, ok := value.Interface().(syntax.Node); ok {
				observe(node, path)
			}
			if value.IsNil() {
				return
			}
			value = value.Elem()
		} else if value.Kind() == reflect.Struct && value.CanAddr() {
			// Comment slices contain values whose pointer receivers implement Node.
			if node, ok := value.Addr().Interface().(syntax.Node); ok {
				observe(node, path)
			}
		}
		switch value.Kind() {
		case reflect.Struct:
			for index := 0; index < value.NumField(); index++ {
				field := value.Type().Field(index)
				if field.IsExported() {
					visit(value.Field(index), snapshotChildPath(path, field.Name), false)
				}
			}
		case reflect.Slice:
			for index := 0; index < value.Len(); index++ {
				visit(value.Index(index), snapshotChildPath(path, index), false)
			}
		}
	}
	visit(reflect.ValueOf(root), []any{}, true)
	return entries
}

// snapshotChildPath owns each traversal path so siblings cannot overwrite a
// retained entry through append capacity reuse. Segments are strings or indices.
func snapshotChildPath(parent []any, segment any) []any {
	path := make([]any, len(parent)+1)
	copy(path, parent)
	path[len(parent)] = segment
	return path
}

// snapshotPosition calls one method independently. A panic becomes source-bound
// observation data instead of aborting the parse or calling the other method.
func snapshotPosition(node syntax.Node, read func(syntax.Node) syntax.Pos) (position *syntaxwire.Position, failure any) {
	defer func() {
		if caught := recover(); caught != nil {
			failure = syntaxwire.String(fmt.Sprintf("upstream node position: %v", caught))
		}
	}()
	observed := syntaxwire.ObservePosition(read(node))
	return &observed, nil
}
