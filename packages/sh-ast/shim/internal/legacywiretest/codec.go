// Frozen compatibility oracle from 80bdcd9. Imported only by tests; keep its
// map construction and reflection independent of production streaming helpers.
// Package syntaxwire transports the pinned syntax package's data model without
// typedjson's omission rules. Exported struct fields retain their Go names and
// values; Type identifies concrete structs, including auxiliary non-Node structs.
// Node methods are deliberately absent: bounds are derived from the current tree.
// The format preserves tree values, not pointer identity or cyclic object graphs.
// TypedNil tags preserve interface values holding nil concrete pointers: their
// dynamic type and non-nil interface identity can affect upstream node methods.
// Ordinary nil concrete pointer fields and slice elements remain plain nulls.
package legacywiretest

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
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

// Encode returns a complete syntax record. Values must be syntax nodes or
// auxiliary structs; unsupported values and cycles fail rather than lose data.
// A root value is passed through an interface, so a typed-nil root retains its
// concrete pointer type just like an interface-typed field or slice element.
func Encode(value any) ([]byte, error) {
	encoded, err := Value(value)
	if err != nil {
		return nil, err
	}
	return json.Marshal(encoded)
}

// Value returns a JSON-compatible syntax value for embedding in result envelopes.
func Value(value any) (any, error) {
	root := reflect.ValueOf(value)
	if root.IsValid() && root.Kind() == reflect.Pointer && root.IsNil() {
		return typedNilValue(root.Type())
	}
	return encodeValue(root, make(map[uintptr]bool))
}

// typedNilValue identifies a nil pointer inside a Go interface, including the
// root any argument. Registry validation prevents unsupported dynamic types from
// acquiring the same marker as known upstream syntax records.
func typedNilValue(pointer reflect.Type) (any, error) {
	typ := pointer.Elem()
	if nodeTypes[typ.Name()] != typ {
		return nil, fmt.Errorf("unsupported typed-nil syntax pointer %s", pointer)
	}
	return map[string]string{"Type": "TypedNil", "Kind": typ.Name()}, nil
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
		// Null alone would erase the dynamic pointer type and change upstream
		// control flow. Concrete pointer slots still take the plain-null path.
		if dynamic.Kind() == reflect.Pointer && dynamic.IsNil() {
			return typedNilValue(dynamic.Type())
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
