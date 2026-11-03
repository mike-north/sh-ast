package syntaxbridge

import (
	"encoding/json"
	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
	"reflect"
	"sort"
)

// positionSnapshot exposes decoded outcomes for test assertions. Paths exist only
// in this independent native oracle and are never transported by production.
type positionSnapshot struct {
	Path               []any
	Pos, End           *syntaxwire.Position
	PosError, EndError any
}

// nativeOccurrences derives lexical preorder from exported upstream fields,
// independently of encoder plans and generated metadata. Paths let tests retain
// explicit semantic anchors while production correlates by occurrence index.
func nativeOccurrences(root syntax.Node) ([]syntax.Node, [][]any) {
	var nodes []syntax.Node
	var paths [][]any
	var visit func(reflect.Value, []any, bool)
	visit = func(v reflect.Value, path []any, slot bool) {
		if !v.IsValid() {
			return
		}
		for v.Kind() == reflect.Interface {
			slot = true
			if v.IsNil() {
				return
			}
			v = v.Elem()
		}
		if v.Kind() == reflect.Pointer {
			if v.IsNil() && !slot {
				return
			}
			if node, ok := v.Interface().(syntax.Node); ok {
				nodes = append(nodes, node)
				paths = append(paths, append([]any{}, path...))
			}
			if v.IsNil() {
				return
			}
			v = v.Elem()
		} else if v.Kind() == reflect.Struct && v.CanAddr() {
			if node, ok := v.Addr().Interface().(syntax.Node); ok {
				nodes = append(nodes, node)
				paths = append(paths, append([]any{}, path...))
			}
		}
		switch v.Kind() {
		case reflect.Struct:
			var names []string
			for i := 0; i < v.NumField(); i++ {
				f := v.Type().Field(i)
				if f.IsExported() {
					names = append(names, f.Name)
				}
			}
			sort.Strings(names)
			for _, name := range names {
				visit(v.FieldByName(name), append(append([]any{}, path...), name), false)
			}
		case reflect.Slice:
			for i := 0; i < v.Len(); i++ {
				visit(v.Index(i), append(append([]any{}, path...), i), false)
			}
		}
	}
	visit(reflect.ValueOf(root), []any{}, true)
	return nodes, paths
}

// decodeCompactSnapshots interprets the documented numeric layout directly; it
// does not use the production position codec to derive expected observations.
func decodeCompactSnapshots(data []byte, paths [][]any) []positionSnapshot {
	var wire struct {
		Positions      []uint
		PositionErrors [][]json.RawMessage
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		panic(err)
	}
	if len(wire.Positions) != 8*len(paths) {
		panic("wrong compact occurrence count")
	}
	result := make([]positionSnapshot, len(paths))
	bound := func(q []uint) *syntaxwire.Position {
		return &syntaxwire.Position{Offset: q[0], Line: q[1], Col: q[2], IsValid: q[3]&1 != 0, IsRecovered: q[3]&2 != 0, OffsetOverflow: q[3]&4 != 0}
	}
	for i, path := range paths {
		result[i] = positionSnapshot{Path: path, Pos: bound(wire.Positions[8*i:]), End: bound(wire.Positions[8*i+4:])}
	}
	for _, row := range wire.PositionErrors {
		if len(row) != 3 {
			panic("wrong error row length")
		}
		var i int
		if err := json.Unmarshal(row[0], &i); err != nil {
			panic(err)
		}
		if err := json.Unmarshal(row[1], &result[i].PosError); err != nil {
			panic(err)
		}
		if err := json.Unmarshal(row[2], &result[i].EndError); err != nil {
			panic(err)
		}
		if result[i].PosError != nil {
			result[i].Pos = nil
		}
		if result[i].EndError != nil {
			result[i].End = nil
		}
	}
	return result
}

// positionSnapshots exercises the real writer queue and flat sidecar together.
func positionSnapshots(root syntax.Node) []positionSnapshot {
	_, nodes, err := syntaxwire.AppendWithOccurrences(nil, root)
	if err != nil {
		panic(err)
	}
	_, paths := nativeOccurrences(root)
	return decodeCompactSnapshots(append(appendCompactPositionSidecar([]byte("{"), nodes), '}'), paths)
}
