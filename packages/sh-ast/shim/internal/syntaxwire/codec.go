// Package syntaxwire transports the pinned syntax package's data model without
// typedjson's omission rules. Exported struct fields retain their Go names and
// values; Type identifies concrete structs, including auxiliary non-Node structs.
// Node methods are deliberately absent: bounds are derived from the current tree.
// The format preserves parser-returned and publicly representable tree values,
// not pointer identity or cyclic object graphs. Go-only typed-nil interface fields
// and elements fail closed: the public model cannot preserve their dynamic type
// and non-nil interface identity, which can change upstream method behavior.
package syntaxwire

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
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
// auxiliary structs; unsupported values, typed-nil interface fields/elements, and
// cycles fail rather than lose data. Ordinary nil interfaces and concrete pointers
// remain representable as null.
func Encode(value any) ([]byte, error) {
	encoded, err := Value(value)
	if err != nil {
		return nil, err
	}
	return json.Marshal(encoded)
}

// Value returns a JSON-compatible syntax value for embedding in result envelopes.
func Value(value any) (any, error) {
	return encodeValue(reflect.ValueOf(value), make(map[uintptr]bool))
}

// encodeValue visits the current pointer ancestry to reject cycles while allowing
// repeated children. Every exported field is included, even when it is zero or nil.
func encodeValue(value reflect.Value, ancestry map[uintptr]bool) (any, error) {
	if !value.IsValid() {
		return nil, nil
	}
	if value.Type() == positionType {
		return ObservePosition(value.Interface().(syntax.Pos)), nil
	}
	switch value.Kind() {
	case reflect.Interface:
		if value.IsNil() {
			return nil, nil
		}
		dynamic := value.Elem()
		// A non-nil interface holding a nil pointer takes different upstream
		// control-flow branches from a nil interface. JSON null would erase that
		// distinction; reject it before the ordinary nil-pointer encoding path.
		if dynamic.Kind() == reflect.Pointer && dynamic.IsNil() {
			return nil, fmt.Errorf("typed-nil interface %s holding %s is not representable", value.Type(), dynamic.Type())
		}
		return encodeValue(dynamic, ancestry)
	case reflect.Pointer:
		if value.IsNil() {
			return nil, nil
		}
		ptr := value.Pointer()
		if ancestry[ptr] {
			return nil, fmt.Errorf("cyclic syntax value")
		}
		ancestry[ptr] = true
		defer delete(ancestry, ptr)
		return encodeValue(value.Elem(), ancestry)
	case reflect.Struct:
		typ := value.Type()
		if nodeTypes[typ.Name()] != typ {
			return nil, fmt.Errorf("unsupported syntax struct %s", typ)
		}
		out := map[string]any{"Type": typ.Name()}
		for i := 0; i < typ.NumField(); i++ {
			field := typ.Field(i)
			if !field.IsExported() {
				return nil, fmt.Errorf("unsupported private field %s.%s", typ, field.Name)
			}
			encoded, err := encodeValue(value.Field(i), ancestry)
			if err != nil {
				return nil, fmt.Errorf("%s.%s: %w", typ.Name(), field.Name, err)
			}
			out[field.Name] = encoded
		}
		return out, nil
	case reflect.Slice:
		if value.IsNil() {
			return nil, nil
		}
		out := make([]any, value.Len())
		for i := range out {
			encoded, err := encodeValue(value.Index(i), ancestry)
			if err != nil {
				return nil, err
			}
			out[i] = encoded
		}
		return out, nil
	case reflect.String:
		return String(value.String()), nil
	case reflect.Bool:
		return value.Bool(), nil
	case reflect.Uint32:
		return value.Uint(), nil
	default:
		return nil, fmt.Errorf("unsupported syntax value %s", value.Type())
	}
}

// ReadJSON preserves integer precision and requires exactly one JSON value.
func ReadJSON(data []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, fmt.Errorf("expected exactly one JSON value")
	}
	return value, nil
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

// decodeValue checks the actual destination Go type, including interface
// membership, rather than trusting a caller-supplied discriminator.
func decodeValue(target reflect.Value, value any) error {
	if target.Type() == positionType {
		position, err := readPosition(value)
		if err == nil {
			target.Set(reflect.ValueOf(position))
		}
		return err
	}
	if value == nil {
		switch target.Kind() {
		case reflect.Pointer, reflect.Interface, reflect.Slice:
			target.SetZero()
			return nil
		}
		return fmt.Errorf("null cannot represent %s", target.Type())
	}
	switch target.Kind() {
	case reflect.Pointer:
		target.Set(reflect.New(target.Type().Elem()))
		return decodeValue(target.Elem(), value)
	case reflect.Interface:
		obj, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("expected syntax object")
		}
		name, _ := obj["Type"].(string)
		typ := nodeTypes[name]
		if typ == nil || !reflect.PointerTo(typ).Implements(target.Type()) {
			return fmt.Errorf("%q does not implement %s", name, target.Type())
		}
		node := reflect.New(typ)
		if err := decodeValue(node.Elem(), value); err != nil {
			return err
		}
		target.Set(node)
		return nil
	case reflect.Struct:
		obj, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("expected %s object", target.Type())
		}
		typ := target.Type()
		if obj["Type"] != typ.Name() {
			return fmt.Errorf("expected Type %s", typ.Name())
		}
		if len(obj) != typ.NumField()+1 {
			return fmt.Errorf("%s requires exactly its exported fields", typ.Name())
		}
		for i := 0; i < typ.NumField(); i++ {
			field := typ.Field(i)
			entry, present := obj[field.Name]
			if !present {
				return fmt.Errorf("missing %s.%s", typ.Name(), field.Name)
			}
			if err := decodeValue(target.Field(i), entry); err != nil {
				return fmt.Errorf("%s.%s: %w", typ.Name(), field.Name, err)
			}
		}
		return nil
	case reflect.Slice:
		entries, ok := value.([]any)
		if !ok {
			return fmt.Errorf("expected array for %s", target.Type())
		}
		target.Set(reflect.MakeSlice(target.Type(), len(entries), len(entries)))
		for i, entry := range entries {
			if err := decodeValue(target.Index(i), entry); err != nil {
				return fmt.Errorf("index %d: %w", i, err)
			}
		}
		return nil
	case reflect.String:
		str, err := ReadString(value)
		if err != nil {
			return err
		}
		target.SetString(str)
		return nil
	case reflect.Bool:
		boolean, ok := value.(bool)
		if !ok {
			return fmt.Errorf("expected boolean")
		}
		target.SetBool(boolean)
		return nil
	case reflect.Uint32:
		number, err := readUint32(value)
		if err != nil {
			return err
		}
		target.SetUint(number)
		return nil
	default:
		return fmt.Errorf("unsupported destination %s", target.Type())
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
		position = overflowPosition(uint(line), uint(column))
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

// overflowPosition reconstructs an observationally equivalent non-recovered
// position using only NewPos and Comment.End. The pinned public coordinate
// behavior has 18-bit lines and 14-bit columns. Advancing past the maximum offset
// preserves those coordinates while making the offset hidden and After false.
// A two-byte advance at coordinate wrap avoids accidentally creating the exact
// recovered sentinel. Once invalid, upstream position arithmetic leaves it alone.
func overflowPosition(line, column uint) syntax.Pos {
	const lineMax = (1 << 18) - 1
	const columnMax = (1 << 14) - 1
	var start syntax.Pos
	text := ""
	switch {
	case line == 0 && column <= 1:
		start = syntax.NewPos(maximumPosition.Offset(), lineMax, columnMax-1+column)
		text = "x"
	case column > 0:
		start = syntax.NewPos(maximumPosition.Offset(), line, column-1)
	default:
		start = syntax.NewPos(maximumPosition.Offset(), line-1, columnMax)
	}
	return (&syntax.Comment{Hash: start, Text: text}).End()
}
