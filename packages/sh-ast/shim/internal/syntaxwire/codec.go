// Package syntaxwire transports the pinned syntax package's data model without
// typedjson's omission rules. Exported struct fields retain their Go names and
// values; Type identifies concrete structs, including auxiliary non-Node structs.
// Node methods are deliberately absent: bounds are derived from the current tree.
// The format preserves tree values, not pointer identity or cyclic object graphs.
// TypedNil tags preserve interface values holding nil concrete pointers: their
// dynamic type and non-nil interface identity can affect upstream node methods.
// Ordinary nil concrete pointer fields and slice elements remain plain nulls.
package syntaxwire

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"mvdan.cc/sh/v3/syntax"
)

// Position preserves the public behavior of a syntax.Pos. Invalid coordinates are
// not automatically zero. OffsetOverflow distinguishes out-of-range offsets from
// ordinary invalid values: the five direct getters alone do not preserve After.
// This is observational equivalence, not a promise about Go's private words or ==.
type Position struct {
	// Offset is the upstream byte offset, including zero when an offset is hidden.
	Offset uint `json:"Offset"`
	// Line retains upstream numbering and zero on line overflow or missing data.
	Line uint `json:"Line"`
	// Col counts bytes and retains zero on column overflow or missing data.
	Col uint `json:"Col"`
	// IsValid reports whether upstream considers the position useful.
	IsValid bool `json:"IsValid"`
	// IsRecovered distinguishes the parser's synthesized missing-token position.
	IsRecovered bool `json:"IsRecovered"`
	// OffsetOverflow means the hidden offset exceeds the valid offset range. This
	// includes the recovered sentinel; every valid position compares before it.
	OffsetOverflow bool `json:"OffsetOverflow"`
}

// maximumPosition is a valid rightmost position obtained through NewPos's public
// saturation behavior. Its After comparison exposes hidden overflow without
// reading or manipulating the private representation of Pos.
var maximumPosition = syntax.NewPos(^uint(0), 1, 1)

// ObservePosition preserves coordinates, state, String, and After behavior.
func ObservePosition(p syntax.Pos) Position {
	overflow := !p.IsValid() && p.Offset() == 0 && !maximumPosition.After(p)
	return Position{p.Offset(), p.Line(), p.Col(), p.IsValid(), p.IsRecovered(), overflow}
}

// String represents a Go string without assuming valid UTF-8. Ordinary strings
// stay readable JSON; byte-bearing strings use base64 so encoding/json cannot
// substitute replacement characters. This applies to filenames as well as AST data.
func String(value string) any {
	if utf8.ValidString(value) {
		return value
	}
	return map[string]string{"Bytes": base64.StdEncoding.EncodeToString([]byte(value))}
}

// ReadString is the inverse of String; other object shapes are not strings.
func ReadString(value any) (string, error) {
	if str, ok := value.(string); ok {
		return str, nil
	}
	obj, ok := value.(map[string]any)
	if !ok || len(obj) != 1 {
		return "", fmt.Errorf("expected a string or a Bytes record")
	}
	encoded, ok := obj["Bytes"].(string)
	if !ok {
		return "", fmt.Errorf("Bytes must be a base64 string")
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("invalid Bytes encoding: %w", err)
	}
	return string(decoded), nil
}

// nodeTypes is the pinned package's concrete syntax inventory. Reflection on the
// exported structs supplies field shape; this registry only selects concrete
// implementers for interface fields and roots. Auxiliary structs are registered
// separately from Node membership, which is checked using Go's type system.
var nodeTypes = func() map[string]reflect.Type {
	values := []any{
		syntax.ArithmCmd{}, syntax.ArithmExp{}, syntax.ArrayElem{}, syntax.ArrayExpr{},
		syntax.Assign{}, syntax.BinaryArithm{}, syntax.BinaryCmd{}, syntax.BinaryTest{},
		syntax.Block{}, syntax.BraceExp{}, syntax.CStyleLoop{}, syntax.CallExpr{},
		syntax.CaseClause{}, syntax.CaseItem{}, syntax.CmdSubst{}, syntax.Comment{},
		syntax.CoprocClause{}, syntax.DblQuoted{}, syntax.DeclClause{}, syntax.Expansion{},
		syntax.ExtGlob{}, syntax.File{}, syntax.FlagsArithm{}, syntax.ForClause{},
		syntax.FuncDecl{}, syntax.IfClause{}, syntax.LetClause{}, syntax.Lit{},
		syntax.ParamExp{}, syntax.ParenArithm{}, syntax.ParenTest{}, syntax.ProcSubst{},
		syntax.Redirect{}, syntax.Replace{}, syntax.SglQuoted{}, syntax.Slice{},
		syntax.Stmt{}, syntax.Subshell{}, syntax.TestClause{}, syntax.TestDecl{},
		syntax.TimeClause{}, syntax.UnaryArithm{}, syntax.UnaryTest{}, syntax.WhileClause{},
		syntax.Word{}, syntax.WordIter{},
	}
	result := make(map[string]reflect.Type, len(values))
	for _, value := range values {
		typ := reflect.TypeOf(value)
		result[typ.Name()] = typ
	}
	return result
}()

// positionType distinguishes the opaque Pos value from ordinary exported structs.
var positionType = reflect.TypeFor[syntax.Pos]()

// recoveredPosition obtains the upstream sentinel using only supported parsing
// APIs. Pos is a value type, so copies retain recovery without shared mutable
// state. The invariant is tested against the pinned parser; no private layout,
// unsafe conversion, or replacement fork is involved.
var recoveredPosition = sync.OnceValues(func() (syntax.Pos, error) {
	file, err := syntax.NewParser(syntax.RecoverErrors(2)).Parse(strings.NewReader("(foo |"), "")
	if err != nil {
		return syntax.Pos{}, fmt.Errorf("obtain recovered position: %w", err)
	}
	if len(file.Stmts) != 1 {
		return syntax.Pos{}, fmt.Errorf("recovery fixture no longer produces one statement")
	}
	subshell, ok := file.Stmts[0].Cmd.(*syntax.Subshell)
	if !ok || !subshell.Rparen.IsRecovered() {
		return syntax.Pos{}, fmt.Errorf("recovery fixture no longer produces a recovered closing parenthesis")
	}
	return subshell.Rparen, nil
})

// Encode returns a complete syntax record. Values must be syntax nodes or
// auxiliary structs; unsupported values and cycles fail rather than lose data.
// A root value is passed through an interface, so a typed-nil root retains its
// concrete pointer type just like an interface-typed field or slice element.
func Encode(value any) ([]byte, error) {
	return Append(nil, value)
}

// readTypedNil reconstructs only the dynamic nil pointer; the caller separately
// checks its compatibility with the destination interface or required root API.
func readTypedNil(obj map[string]any) (reflect.Value, error) {
	name, ok := obj["Kind"].(string)
	typ := nodeTypes[name]
	if len(obj) != 2 || obj["Type"] != "TypedNil" || !ok || typ == nil {
		return reflect.Value{}, fmt.Errorf("expected a TypedNil tag naming a known syntax record")
	}
	return reflect.Zero(reflect.PointerTo(typ)), nil
}

// ReadJSON preserves integer precision and requires exactly one JSON value.
// Documents nested deeper than encoding/json allows (its decoder refuses more
// than 10,000 open arrays and objects) are read by readJSONIterative instead, so
// the limit on depth is the tree a caller can build rather than that parser's
// constant. Every other outcome, including every malformed-input message, is
// encoding/json's own.
func ReadJSON(data []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		if exceededNestingLimit(err) {
			return readJSONIterative(data)
		}
		return nil, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, fmt.Errorf("expected exactly one JSON value")
	}
	return value, nil
}

// exceededNestingLimit recognizes encoding/json's refusal of deep documents. The
// package exposes it only as the text of a SyntaxError, so tests pin the wording
// against the toolchain that builds the shim.
func exceededNestingLimit(err error) bool {
	var syntaxError *json.SyntaxError
	return errors.As(err, &syntaxError) && strings.HasSuffix(syntaxError.Error(), "exceeded max depth")
}

// jsonFrame is one array or object whose members readJSONIterative is collecting.
type jsonFrame struct {
	object  map[string]any
	array   []any
	key     string
	hasKey  bool
	isArray bool
}

// readJSONIterative builds the same values as ReadJSON (maps, slices, json.Number,
// strings, booleans and nil) from the decoder's token stream, keeping open
// containers on an explicit stack instead of recursing once per level. The token
// reader has no nesting limit of its own, so only memory bounds the depth.
func readJSONIterative(data []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var stack []jsonFrame
	var root any
	place := func(value any) {
		if len(stack) == 0 {
			root = value
			return
		}
		top := &stack[len(stack)-1]
		if top.isArray {
			top.array = append(top.array, value)
			return
		}
		top.object[top.key] = value
		top.hasKey = false
	}
	for {
		token, err := decoder.Token()
		if err != nil {
			if err == io.EOF {
				err = io.ErrUnexpectedEOF
			}
			return nil, err
		}
		if delim, ok := token.(json.Delim); ok {
			switch delim {
			case '{':
				stack = append(stack, jsonFrame{object: map[string]any{}})
			case '[':
				stack = append(stack, jsonFrame{array: []any{}, isArray: true})
			default:
				top := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				if top.isArray {
					place(top.array)
				} else {
					place(top.object)
				}
			}
		} else if top := len(stack) - 1; top >= 0 && !stack[top].isArray && !stack[top].hasKey {
			stack[top].key = token.(string)
			stack[top].hasKey = true
		} else {
			place(token)
		}
		if len(stack) == 0 {
			break
		}
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, fmt.Errorf("expected exactly one JSON value")
	}
	return root, nil
}

// Decode reconstructs a concrete node or auxiliary struct, preserving all stored
// values. A complete record is required so typos and omissions cannot become zeros.
func Decode(data []byte) (any, error) {
	value, err := ReadJSON(data)
	if err != nil {
		return nil, err
	}
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
	if err := decodeValue(out.Elem(), value); err != nil {
		return nil, err
	}
	return out.Interface(), nil
}

// DecodeNode rejects auxiliary roots where a syntax.Node operation is required.
func DecodeNode(data []byte) (syntax.Node, error) {
	value, err := Decode(data)
	if err != nil {
		return nil, err
	}
	node, ok := value.(syntax.Node)
	if !ok {
		return nil, fmt.Errorf("%T is not a syntax.Node", value)
	}
	return node, nil
}

// decodeFrame is one struct, slice or interface whose children decodeValue is
// filling in. A struct or slice frame names the child being decoded by next-1, so
// that a failure can be wrapped with the same field or index prefix that a
// recursive descent would add as it unwinds.
type decodeFrame struct {
	kind    decodeFrameKind
	target  reflect.Value
	object  map[string]any
	entries []any
	node    reflect.Value
	next    int
}

type decodeFrameKind uint8

const (
	// decodeStruct decodes each exported field from an object.
	decodeStruct decodeFrameKind = iota
	// decodeSlice decodes each element of an array.
	decodeSlice
	// decodeInterface decodes one concrete node, then stores it in the interface.
	decodeInterface
)

// decodeValue checks the actual destination Go type, including interface
// membership, rather than trusting a caller-supplied discriminator.
//
// It descends on an explicit stack of decodeFrames, not by recursion, so the
// depth of a decoded tree is bounded by memory rather than by the call stack.
// Fields and elements are decoded in declaration and index order, and a failure
// is wrapped by each enclosing struct field and slice index exactly as a
// recursive descent would wrap it while unwinding.
func decodeValue(rootTarget reflect.Value, rootValue any) error {
	var stack []decodeFrame
	target, value := rootTarget, rootValue
	for {
		descend, err := beginDecode(&stack, &target, &value)
		if err != nil {
			return unwindDecode(stack, err)
		}
		if descend {
			continue
		}
		// The value just finished (a scalar, or a frame was pushed without a child
		// to visit first). Resume the innermost frame that still has work.
		for {
			if len(stack) == 0 {
				return nil
			}
			top := &stack[len(stack)-1]
			switch top.kind {
			case decodeInterface:
				// The node under this interface is complete; only now is it stored.
				top.target.Set(top.node)
				stack = stack[:len(stack)-1]
				continue
			case decodeStruct:
				typ := top.target.Type()
				if top.next == typ.NumField() {
					stack = stack[:len(stack)-1]
					continue
				}
				field := typ.Field(top.next)
				entry, present := top.object[field.Name]
				if !present {
					stack = stack[:len(stack)-1]
					return unwindDecode(stack, fmt.Errorf("missing %s.%s", typ.Name(), field.Name))
				}
				target, value = top.target.Field(top.next), entry
				top.next++
			case decodeSlice:
				if top.next == len(top.entries) {
					stack = stack[:len(stack)-1]
					continue
				}
				target, value = top.target.Index(top.next), top.entries[top.next]
				top.next++
			}
			break
		}
	}
}

// unwindDecode prefixes err with every enclosing frame's field or index,
// outermost first, reproducing the message of a recursive descent. Interface
// frames add nothing. The prefix is assembled once, so a failure at depth n costs
// time proportional to n.
func unwindDecode(stack []decodeFrame, err error) error {
	var prefix strings.Builder
	for _, frame := range stack {
		switch frame.kind {
		case decodeStruct:
			typ := frame.target.Type()
			prefix.WriteString(typ.Name())
			prefix.WriteByte('.')
			prefix.WriteString(typ.Field(frame.next - 1).Name)
			prefix.WriteString(": ")
		case decodeSlice:
			prefix.WriteString("index ")
			prefix.WriteString(strconv.Itoa(frame.next - 1))
			prefix.WriteString(": ")
		}
	}
	return prefixed(prefix, err)
}

// beginDecode decodes one value. A scalar (or null) is stored immediately. A
// struct, slice or interface pushes a frame. When the value is the pointer or
// interface wrapper of a node that is decoded in place, *target and *value are
// replaced by that inner destination and descend is true, so the caller loops
// without growing the stack.
func beginDecode(stack *[]decodeFrame, target *reflect.Value, value *any) (descend bool, err error) {
	if target.Type() == positionType {
		position, err := readPosition(*value)
		if err == nil {
			target.Set(reflect.ValueOf(position))
		}
		return false, err
	}
	if *value == nil {
		switch target.Kind() {
		case reflect.Pointer, reflect.Interface, reflect.Slice:
			target.SetZero()
			return false, nil
		}
		return false, fmt.Errorf("null cannot represent %s", target.Type())
	}
	switch target.Kind() {
	case reflect.Pointer:
		target.Set(reflect.New(target.Type().Elem()))
		*target = target.Elem()
		return true, nil
	case reflect.Interface:
		obj, ok := (*value).(map[string]any)
		if !ok {
			return false, fmt.Errorf("expected syntax object")
		}
		if obj["Type"] == "TypedNil" {
			pointer, err := readTypedNil(obj)
			if err != nil {
				return false, err
			}
			if !pointer.Type().Implements(target.Type()) {
				return false, fmt.Errorf("typed-nil %s does not implement %s", pointer.Type(), target.Type())
			}
			target.Set(pointer)
			return false, nil
		}
		name, _ := obj["Type"].(string)
		typ := nodeTypes[name]
		if typ == nil || !reflect.PointerTo(typ).Implements(target.Type()) {
			return false, fmt.Errorf("%q does not implement %s", name, target.Type())
		}
		node := reflect.New(typ)
		*stack = append(*stack, decodeFrame{kind: decodeInterface, target: *target, node: node})
		*target = node.Elem()
		return true, nil
	case reflect.Struct:
		obj, ok := (*value).(map[string]any)
		if !ok {
			return false, fmt.Errorf("expected %s object", target.Type())
		}
		typ := target.Type()
		if obj["Type"] != typ.Name() {
			return false, fmt.Errorf("expected Type %s", typ.Name())
		}
		if len(obj) != typ.NumField()+1 {
			return false, fmt.Errorf("%s requires exactly its exported fields", typ.Name())
		}
		*stack = append(*stack, decodeFrame{kind: decodeStruct, target: *target, object: obj})
		return false, nil
	case reflect.Slice:
		entries, ok := (*value).([]any)
		if !ok {
			return false, fmt.Errorf("expected array for %s", target.Type())
		}
		target.Set(reflect.MakeSlice(target.Type(), len(entries), len(entries)))
		*stack = append(*stack, decodeFrame{kind: decodeSlice, target: *target, entries: entries})
		return false, nil
	case reflect.String:
		str, err := ReadString(*value)
		if err != nil {
			return false, err
		}
		target.SetString(str)
		return false, nil
	case reflect.Bool:
		boolean, ok := (*value).(bool)
		if !ok {
			return false, fmt.Errorf("expected boolean")
		}
		target.SetBool(boolean)
		return false, nil
	case reflect.Uint8, reflect.Uint32:
		number, err := readUint32(*value)
		if err != nil {
			return false, err
		}
		// Named uint8 option states and uint32 operators retain their full
		// storage domain; reject overflow before reflection can truncate it.
		if target.OverflowUint(number) {
			return false, fmt.Errorf("integer overflows %s", target.Type())
		}
		target.SetUint(number)
		return false, nil
	default:
		return false, fmt.Errorf("unsupported destination %s", target.Type())
	}
}

// readUint32 validates storage precision only. Named operator constants describe
// useful values, but arbitrary uint32 and zero are representable upstream states.
func readUint32(value any) (uint64, error) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, fmt.Errorf("expected uint32 integer")
	}
	integer, err := number.Int64()
	if err != nil || integer < 0 || integer > 0xffffffff {
		return 0, fmt.Errorf("expected uint32 integer")
	}
	return uint64(integer), nil
}

// readPosition validates the observation record against the public constructor
// or recovered value. It rejects contradictory state rather than normalizing it.
func readPosition(value any) (syntax.Pos, error) {
	obj, ok := value.(map[string]any)
	if !ok || len(obj) != 6 {
		return syntax.Pos{}, fmt.Errorf("position requires Offset, Line, Col, IsValid, IsRecovered, OffsetOverflow")
	}
	offset, err := readUint32(obj["Offset"])
	if err != nil {
		return syntax.Pos{}, err
	}
	line, err := readUint32(obj["Line"])
	if err != nil {
		return syntax.Pos{}, err
	}
	column, err := readUint32(obj["Col"])
	if err != nil {
		return syntax.Pos{}, err
	}
	valid, ok := obj["IsValid"].(bool)
	if !ok {
		return syntax.Pos{}, fmt.Errorf("IsValid must be boolean")
	}
	recovered, ok := obj["IsRecovered"].(bool)
	if !ok {
		return syntax.Pos{}, fmt.Errorf("IsRecovered must be boolean")
	}
	overflow, ok := obj["OffsetOverflow"].(bool)
	if !ok {
		return syntax.Pos{}, fmt.Errorf("OffsetOverflow must be boolean")
	}
	var position syntax.Pos
	if recovered {
		position, err = recoveredPosition()
	} else if overflow {
		// The current pin clamps arithmetic at the valid offset maximum.
		// Recovery is now the only constructible hidden-overflow position.
		return syntax.Pos{}, fmt.Errorf("non-recovered overflow position is not representable")
	} else {
		position = syntax.NewPos(uint(offset), uint(line), uint(column))
	}
	if err != nil {
		return syntax.Pos{}, err
	}
	expected := Position{uint(offset), uint(line), uint(column), valid, recovered, overflow}
	if ObservePosition(position) != expected {
		return syntax.Pos{}, fmt.Errorf("position observations are inconsistent with upstream state")
	}
	return position, nil
}
