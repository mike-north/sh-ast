// Snapshot streaming preserves declaration-order occurrences independently of
// syntax JSON key order. Only successfully encoded acyclic graphs reach this pass.
package syntaxbridge

import (
	"eslint-sh-shim/internal/syntaxwire"
	"fmt"
	"mvdan.cc/sh/v3/syntax"
	"reflect"
	"strconv"
)

// pathSegment keeps traversal indices unboxed and borrowed field names immutable.
// The stack is serialized immediately; no entry retains its backing storage.
type pathSegment struct {
	name    string
	index   int
	isIndex bool
}

// appendPositionSnapshots observes each Node occurrence before its children, using
// real pointer receivers for addressable Comment values and preserving typed-nil
// interface occurrences. Bounds are never cached or written into the input graph.
// The caller must have successfully encoded the graph before invoking methods.
func appendPositionSnapshots(dst []byte, root syntax.Node) []byte {
	dst = append(dst, '[')
	first := true
	path := make([]pathSegment, 0, 16)
	observe := func(node syntax.Node) {
		start, startError := snapshotPosition(node, syntax.Node.Pos)
		end, endError := snapshotPosition(node, syntax.Node.End)
		if !first {
			dst = append(dst, ',')
		}
		first = false
		dst = append(dst, `{"Path":[`...)
		for i, segment := range path {
			if i > 0 {
				dst = append(dst, ',')
			}
			if segment.isIndex {
				dst = strconv.AppendInt(dst, int64(segment.index), 10)
			} else {
				dst = syntaxwire.AppendString(dst, segment.name)
			}
		}
		dst = append(dst, `],"Pos":`...)
		dst = appendSnapshotBound(dst, start)
		dst = append(dst, `,"End":`...)
		dst = appendSnapshotBound(dst, end)
		dst = append(dst, `,"PosError":`...)
		dst = appendSnapshotError(dst, startError)
		dst = append(dst, `,"EndError":`...)
		dst = appendSnapshotError(dst, endError)
		dst = append(dst, '}')
	}
	var visit func(reflect.Value, bool)
	visit = func(value reflect.Value, interfaceSlot bool) {
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
			if node, ok := value.Interface().(syntax.Node); ok {
				observe(node)
			}
			if value.IsNil() {
				return
			}
			value = value.Elem()
		} else if value.Kind() == reflect.Struct && value.CanAddr() {
			if node, ok := value.Addr().Interface().(syntax.Node); ok {
				observe(node)
			}
		}
		switch value.Kind() {
		case reflect.Struct:
			for i := 0; i < value.NumField(); i++ {
				field := value.Type().Field(i)
				if field.IsExported() {
					path = append(path, pathSegment{name: field.Name})
					visit(value.Field(i), false)
					path = path[:len(path)-1]
				}
			}
		case reflect.Slice:
			for i := 0; i < value.Len(); i++ {
				path = append(path, pathSegment{index: i, isIndex: true})
				visit(value.Index(i), false)
				path = path[:len(path)-1]
			}
		}
	}
	visit(reflect.ValueOf(root), true)
	return append(dst, ']')
}

// appendSnapshotBound retains explicit null slots when the corresponding method failed.
func appendSnapshotBound(dst []byte, position *syntaxwire.Position) []byte {
	if position == nil {
		return append(dst, "null"...)
	}
	return syntaxwire.AppendPosition(dst, *position)
}

// appendSnapshotError keeps failure bytes separate from successful coordinates.
func appendSnapshotError(dst []byte, failure *string) []byte {
	if failure == nil {
		return append(dst, "null"...)
	}
	return syntaxwire.AppendString(dst, *failure)
}

// snapshotPosition calls one method independently. A panic becomes source-bound
// observation data instead of aborting the parse or calling the other method.
func snapshotPosition(node syntax.Node, read func(syntax.Node) syntax.Pos) (position *syntaxwire.Position, failure *string) {
	defer func() {
		if caught := recover(); caught != nil {
			message := fmt.Sprintf("upstream node position: %v", caught)
			failure = &message
		}
	}()
	observed := syntaxwire.ObservePosition(read(node))
	return &observed, nil
}
