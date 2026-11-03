// Streaming encoding separates deterministic wire order from declaration-order
// failure precedence. It owns no syntax values and never calls caller methods.
package syntaxwire

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"sync"
	"unicode/utf8"

	"mvdan.cc/sh/v3/syntax"
)

// fieldPlan retains wire order independently of declaration-order validation.
// A negative index denotes a complete prequoted Type member, not a Go field.
type fieldPlan struct {
	index int
	name  string
	key   []byte
}

// plans contain immutable names and indices only, never values from caller graphs.
var plans sync.Map

// syntaxPlan amortizes JSON key quoting and sorting across records of one type.
func syntaxPlan(typ reflect.Type) []fieldPlan {
	if cached, ok := plans.Load(typ); ok {
		return cached.([]fieldPlan)
	}
	fields := make([]fieldPlan, 0, typ.NumField()+1)
	typeName, _ := json.Marshal(typ.Name())
	fields = append(fields, fieldPlan{-1, "Type", append([]byte(`"Type":`), typeName...)})
	for i := 0; i < typ.NumField(); i++ {
		name := typ.Field(i).Name
		key, _ := json.Marshal(name)
		fields = append(fields, fieldPlan{i, name, append(key, ':')})
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i].name < fields[j].name })
	actual, _ := plans.LoadOrStore(typ, fields)
	return actual.([]fieldPlan)
}

// reference identifies active recursion, not all previously visited objects.
// Slice length distinguishes an acyclic shorter view at the same backing start.
// Pointer and slice identities occupy different domains; pointer identity retains
// the legacy address rule, while slice types disambiguate typed backing views.
type reference struct {
	pointer uintptr
	length  int
	typ     reflect.Type
	slice   bool
}

// ancestry owns the current traversal path, permitting shared children/slices.
type ancestry map[reference]bool

// enter rejects only ancestors. Its caller removes the key when descent returns.
func (a ancestry) enter(v reflect.Value) (reference, error) {
	key := reference{pointer: v.Pointer()}
	if v.Kind() == reflect.Slice {
		key.slice = true
		key.length = v.Len()
		key.typ = v.Type()
	}
	if a[key] {
		return key, fmt.Errorf("cyclic syntax value")
	}
	a[key] = true
	return key, nil
}

// Append encodes one complete value after dst. Failure discards all partial bytes
// for that value and replays only structural validation in declaration order:
// sorted emission must not change which malformed field is reported first.
// Neither traversal invokes caller methods; unexpected panics propagate unchanged.
func Append(dst []byte, value any) ([]byte, error) {
	start := len(dst)
	root := reflect.ValueOf(value)
	out, err := appendValue(dst, root, true, make(ancestry), nil, false)
	if err == nil {
		return out, nil
	}
	if original := validateValue(root, true, make(ancestry)); original != nil {
		err = original
	}
	return dst[:start], err
}

// AppendWithOccurrences encodes a node while retaining each Node occurrence in
// actual wire-field preorder. It calls no methods: only after successful encoding
// may the bridge consume the flat queue to observe bounds. This avoids a second
// reflection walk without exposing cyclic or otherwise rejected graphs to Pos/End.
// Failure discards both partial bytes and references; repeated aliases stay repeated.
func AppendWithOccurrences(dst []byte, node syntax.Node) ([]byte, []syntax.Node, error) {
	start := len(dst)
	root := reflect.ValueOf(node)
	nodes := make([]syntax.Node, 0)
	out, err := appendValue(dst, root, true, make(ancestry), &nodes, false)
	if err == nil {
		return out, nodes, nil
	}
	if original := validateValue(root, true, make(ancestry)); original != nil {
		err = original
	}
	return dst[:start], nil, err
}

// collectNode retains the original receiver, including typed nils and addressable
// Comment values. Interface assertion observes type identity without calling methods.
func collectNode(value reflect.Value, nodes *[]syntax.Node) bool {
	node, ok := value.Interface().(syntax.Node)
	if ok {
		*nodes = append(*nodes, node)
	}
	return ok
}

// AppendString preserves Go bytes and encoding/json's HTML-safe escaping. It
// marshals only individual strings, never the reflected syntax payload.
func AppendString(dst []byte, value string) []byte {
	if !utf8.ValidString(value) {
		dst = append(dst, `{"Bytes":"`...)
		dst = base64.StdEncoding.AppendEncode(dst, []byte(value))
		return append(dst, `"}`...)
	}
	// Printable ASCII without JSON or HTML metacharacters needs no escaping.
	// Everything else uses encoding/json's complete string grammar.
	for i := 0; i < len(value); i++ {
		ch := value[i]
		if ch < ' ' || ch >= utf8.RuneSelf || ch == '"' || ch == '\\' || ch == '<' || ch == '>' || ch == '&' {
			encoded, _ := json.Marshal(value)
			return append(dst, encoded...)
		}
	}
	dst = append(dst, '"')
	dst = append(dst, value...)
	return append(dst, '"')
}

// AppendPosition follows the Position struct declaration order, which differs
// from alphabetically ordered syntax objects and is part of byte compatibility.
func AppendPosition(dst []byte, p Position) []byte {
	dst = append(dst, `{"Offset":`...)
	dst = strconv.AppendUint(dst, uint64(p.Offset), 10)
	dst = append(dst, `,"Line":`...)
	dst = strconv.AppendUint(dst, uint64(p.Line), 10)
	dst = append(dst, `,"Col":`...)
	dst = strconv.AppendUint(dst, uint64(p.Col), 10)
	dst = append(dst, `,"IsValid":`...)
	dst = strconv.AppendBool(dst, p.IsValid)
	dst = append(dst, `,"IsRecovered":`...)
	dst = strconv.AppendBool(dst, p.IsRecovered)
	dst = append(dst, `,"OffsetOverflow":`...)
	dst = strconv.AppendBool(dst, p.OffsetOverflow)
	return append(dst, '}')
}

// appendValue emits data only: interface identity controls typed nils, while
// concrete nil pointers remain null. Struct registration precedes field access.
func appendValue(dst []byte, v reflect.Value, interfaceSlot bool, active ancestry, nodes *[]syntax.Node, observedPointer bool) ([]byte, error) {
	if !v.IsValid() {
		return append(dst, "null"...), nil
	}
	if v.Type() == positionType {
		return AppendPosition(dst, ObservePosition(v.Interface().(syntax.Pos))), nil
	}
	if v.Kind() == reflect.Interface {
		if v.IsNil() {
			return append(dst, "null"...), nil
		}
		return appendValue(dst, v.Elem(), true, active, nodes, false)
	}
	if v.Kind() == reflect.Pointer && v.IsNil() {
		if !interfaceSlot {
			return append(dst, "null"...), nil
		}
		typ := v.Type().Elem()
		if nodeTypes[typ.Name()] != typ {
			return nil, fmt.Errorf("unsupported typed-nil syntax pointer %s", v.Type())
		}
		if nodes != nil {
			collectNode(v, nodes)
		}
		dst = append(dst, `{"Kind":`...)
		dst = AppendString(dst, typ.Name())
		return append(dst, `,"Type":"TypedNil"}`...), nil
	}
	switch v.Kind() {
	case reflect.Pointer:
		key, err := active.enter(v)
		if err != nil {
			return nil, err
		}
		defer delete(active, key)
		observed := false
		if nodes != nil {
			observed = collectNode(v, nodes)
		}
		return appendValue(dst, v.Elem(), false, active, nodes, observed)
	case reflect.Struct:
		typ := v.Type()
		if nodeTypes[typ.Name()] != typ {
			return nil, fmt.Errorf("unsupported syntax struct %s", typ)
		}
		if nodes != nil && !observedPointer && v.CanAddr() {
			collectNode(v.Addr(), nodes)
		}
		dst = append(dst, '{')
		for i, field := range syntaxPlan(typ) {
			if i > 0 {
				dst = append(dst, ',')
			}
			dst = append(dst, field.key...)
			if field.index < 0 {
				continue
			}
			if !typ.Field(field.index).IsExported() {
				return nil, fmt.Errorf("unsupported private field %s.%s", typ, field.name)
			}
			var err error
			dst, err = appendValue(dst, v.Field(field.index), false, active, nodes, false)
			if err != nil {
				return nil, fmt.Errorf("%s.%s: %w", typ.Name(), field.name, err)
			}
		}
		return append(dst, '}'), nil
	case reflect.Slice:
		if v.IsNil() {
			return append(dst, "null"...), nil
		}
		if v.Len() > 0 {
			key, err := active.enter(v)
			if err != nil {
				return nil, err
			}
			defer delete(active, key)
		}
		dst = append(dst, '[')
		for i := 0; i < v.Len(); i++ {
			if i > 0 {
				dst = append(dst, ',')
			}
			var err error
			dst, err = appendValue(dst, v.Index(i), false, active, nodes, false)
			if err != nil {
				return nil, err
			}
		}
		return append(dst, ']'), nil
	case reflect.String:
		return AppendString(dst, v.String()), nil
	case reflect.Bool:
		return strconv.AppendBool(dst, v.Bool()), nil
	case reflect.Uint32:
		return strconv.AppendUint(dst, v.Uint(), 10), nil
	default:
		return nil, fmt.Errorf("unsupported syntax value %s", v.Type())
	}
}

// validateValue reproduces the old declaration-order error walk without building
// JSON values or calling methods (including position getters). Known positions
// and scalar leaves cannot fail structural encoding. This pass runs only after
// an ordinary writer error and uses separate, path-local reference state.
func validateValue(v reflect.Value, interfaceSlot bool, active ancestry) error {
	if !v.IsValid() || v.Type() == positionType {
		return nil
	}
	if v.Kind() == reflect.Interface {
		if v.IsNil() {
			return nil
		}
		return validateValue(v.Elem(), true, active)
	}
	if v.Kind() == reflect.Pointer && v.IsNil() {
		if interfaceSlot {
			typ := v.Type().Elem()
			if nodeTypes[typ.Name()] != typ {
				return fmt.Errorf("unsupported typed-nil syntax pointer %s", v.Type())
			}
		}
		return nil
	}
	switch v.Kind() {
	case reflect.Pointer:
		key, err := active.enter(v)
		if err != nil {
			return err
		}
		defer delete(active, key)
		return validateValue(v.Elem(), false, active)
	case reflect.Struct:
		typ := v.Type()
		if nodeTypes[typ.Name()] != typ {
			return fmt.Errorf("unsupported syntax struct %s", typ)
		}
		for i := 0; i < typ.NumField(); i++ {
			field := typ.Field(i)
			if !field.IsExported() {
				return fmt.Errorf("unsupported private field %s.%s", typ, field.Name)
			}
			if err := validateValue(v.Field(i), false, active); err != nil {
				return fmt.Errorf("%s.%s: %w", typ.Name(), field.Name, err)
			}
		}
		return nil
	case reflect.Slice:
		if v.Len() > 0 {
			key, err := active.enter(v)
			if err != nil {
				return err
			}
			defer delete(active, key)
		}
		for i := 0; i < v.Len(); i++ {
			if err := validateValue(v.Index(i), false, active); err != nil {
				return err
			}
		}
		return nil
	case reflect.String, reflect.Bool, reflect.Uint32:
		return nil
	default:
		return fmt.Errorf("unsupported syntax value %s", v.Type())
	}
}
