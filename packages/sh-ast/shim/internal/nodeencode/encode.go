// Package nodeencode is an internal, performance-adapted fork of
// mvdan.cc/sh/v3/syntax/typedjson's encode path (see LICENSE-mvdan-sh in this
// directory for the original's BSD-3-Clause license and copyright notice,
// which this fork retains as required). Only the encode direction is
// vendored — the shim never decodes — and `main.go` calls this package's
// [Encode] instead of typedjson.Encode.
//
// # Why fork instead of depend on typedjson directly
//
// Profiling a ~700-line/~9k-node fixture (see design/ARCHITECTURE.md's
// "Performance") found upstream typedjson's `encodeValue` spending ~70-90ms
// of a ~90ms total encode inside `reflect.StructOf` — called once per **node
// instance**, not once per node **type** — to build the synthetic struct
// typedjson uses to inject a `Type` discriminator alongside `Pos`/`End`.
// Every `Stmt`, `Word`, `Lit`, … instance in the tree re-derives and
// re-registers an identical struct shape for its type. `structTypeCache`
// below memoizes that shape per source `reflect.Type`, cutting the same
// fixture's encode time from ~90ms to ~14ms in local measurement — the
// dominant fix behind this package's parent PR hitting the ≤30ms warm-parse
// target (see the PR description for full before/after numbers). Filed
// upstream as a potential typedjson improvement; this fork exists so the
// fix isn't blocked on that landing and releasing.
//
// Everything else — the recursive walk, the Pos/End encoding, the
// omitempty-style zero-value skipping — is unchanged from upstream, since
// this package's whole purpose is to produce byte-identical output to
// typedjson.Encode (verified in encode_test.go against the real
// mvdan.cc/sh/v3/syntax/typedjson package on representative fixtures).
package nodeencode

import (
	"encoding/json"
	"io"
	"reflect"
	"sync"

	"mvdan.cc/sh/v3/syntax"
)

// Encode is a shortcut for [EncodeOptions.Encode] with the default options.
func Encode(w io.Writer, node syntax.Node) error {
	return EncodeOptions{}.Encode(w, node)
}

// EncodeOptions allows configuring how syntax nodes are encoded.
type EncodeOptions struct {
	Indent string // e.g. "\t"
}

// Encode writes node to w in its typed JSON form, matching
// mvdan.cc/sh/v3/syntax/typedjson.Encode's output exactly.
func (opts EncodeOptions) Encode(w io.Writer, node syntax.Node) error {
	val := reflect.ValueOf(node)
	encVal, tname := encodeValue(val)
	if tname == "" {
		panic("node did not contain a named type?")
	}
	encVal.Elem().Field(0).SetString(tname)
	enc := json.NewEncoder(w)
	if opts.Indent != "" {
		enc.SetIndent("", opts.Indent)
	}
	return enc.Encode(encVal.Interface())
}

// structTypeCache memoizes the synthetic struct type built for each source
// node type (keyed by the source's own reflect.Type), so the (Type, Pos,
// End, ...fields) shape is computed once per distinct struct — not once per
// instance. This is the whole optimization this fork exists for; see the
// package doc comment above for measurements.
var structTypeCache sync.Map // reflect.Type -> reflect.Type

func encodeValue(val reflect.Value) (reflect.Value, string) {
	switch val.Kind() {
	case reflect.Pointer:
		if val.IsNil() {
			break
		}
		return encodeValue(val.Elem())
	case reflect.Interface:
		if val.IsNil() {
			break
		}
		enc, tname := encodeValue(val.Elem())
		if tname == "" {
			panic("interface did not contain a named type?")
		}
		enc.Elem().Field(0).SetString(tname)
		return enc, ""
	case reflect.Struct:
		// Construct a new struct with an optional Type, Pos and End, and then
		// all the visible fields which aren't positions — deriving the shape
		// once per source type (structTypeCache) rather than once per node
		// instance, unlike upstream typedjson.
		typ := val.Type()
		var encTyp reflect.Type
		if cached, ok := structTypeCache.Load(typ); ok {
			encTyp = cached.(reflect.Type)
		} else {
			fields := []reflect.StructField{typeField, posField, endField}
			for i := range typ.NumField() {
				field := typ.Field(i)
				ftyp := anyType
				if field.Type == posType {
					ftyp = exportedPosType
				}
				fields = append(fields, reflect.StructField{
					Name: field.Name,
					Type: ftyp,
					Tag:  `json:",omitempty"`,
				})
			}
			encTyp = reflect.StructOf(fields)
			structTypeCache.Store(typ, encTyp)
		}
		enc := reflect.New(encTyp).Elem()

		// Node methods are defined on struct pointer receivers.
		if node, _ := val.Addr().Interface().(syntax.Node); node != nil {
			encodePos(enc.Field(1), node.Pos()) // posField
			encodePos(enc.Field(2), node.End()) // endField
		}
		// Do the rest of the fields.
		for i := 3; i < encTyp.NumField(); i++ {
			ftyp := encTyp.Field(i)
			fval := val.FieldByName(ftyp.Name)
			if ftyp.Type == exportedPosType {
				encodePos(enc.Field(i), fval.Interface().(syntax.Pos))
			} else {
				encElem, _ := encodeValue(fval)
				if encElem.IsValid() {
					enc.Field(i).Set(encElem)
				}
			}
		}

		// Addr helps prevent an allocation as we use any fields.
		return enc.Addr(), typ.Name()
	case reflect.Slice:
		n := val.Len()
		if n == 0 {
			break
		}
		enc := reflect.MakeSlice(anySliceType, n, n)
		for i := range n {
			elem := val.Index(i)
			encElem, _ := encodeValue(elem)
			enc.Index(i).Set(encElem)
		}
		return enc, ""
	case reflect.Bool:
		if val.Bool() {
			return val, ""
		}
	case reflect.String:
		if val.String() != "" {
			return val, ""
		}
	case reflect.Uint32:
		if val.Uint() != 0 {
			return val, ""
		}
	default:
		panic(val.Kind().String())
	}
	return noValue, ""
}

var (
	noValue reflect.Value

	anyType         = reflect.TypeFor[any]()
	anySliceType    = reflect.TypeFor[[]any]()
	posType         = reflect.TypeFor[syntax.Pos]()
	exportedPosType = reflect.TypeFor[*exportedPos]()

	typeField = reflect.StructField{
		Name: "Type",
		Type: reflect.TypeFor[string](),
		Tag:  `json:",omitempty"`,
	}
	posField = reflect.StructField{
		Name: "Pos",
		Type: exportedPosType,
		Tag:  `json:",omitempty"`,
	}
	endField = reflect.StructField{
		Name: "End",
		Type: exportedPosType,
		Tag:  `json:",omitempty"`,
	}
)

type exportedPos struct {
	Offset, Line, Col uint
}

func encodePos(encPtr reflect.Value, val syntax.Pos) {
	if !val.IsValid() {
		return
	}
	enc := reflect.New(exportedPosType.Elem())
	encPtr.Set(enc)
	enc = enc.Elem()

	enc.Field(0).SetUint(uint64(val.Offset()))
	enc.Field(1).SetUint(uint64(val.Line()))
	enc.Field(2).SetUint(uint64(val.Col()))
}
