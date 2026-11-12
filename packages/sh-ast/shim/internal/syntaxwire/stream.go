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
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"mvdan.cc/sh/v3/syntax"
)

// fieldPlan retains wire order independently of declaration-order validation.
// A negative index denotes a complete prequoted Type member, not a Go field.
// exported is resolved once so emission never rebuilds reflect.StructField.
type fieldPlan struct {
	index    int
	name     string
	key      []byte
	exported bool
}

// plans maps each registered concrete syntax struct to its immutable wire plan.
// Membership doubles as the registry check: an unregistered struct has no plan.
// It is built once from nodeTypes and only read afterwards, so lookups need no
// synchronization and never observe values from caller graphs.
var plans = func() map[reflect.Type][]fieldPlan {
	result := make(map[reflect.Type][]fieldPlan, len(nodeTypes))
	for _, typ := range nodeTypes {
		result[typ] = buildPlan(typ)
	}
	return result
}()

// planFor returns the wire plan for a registered struct type. Production never
// changes nodeTypes after initialization, so a prebuilt plan implies
// registration. Types registered later (only synthetic test records) are still
// honoured through the registry itself, with an uncached plan.
func planFor(typ reflect.Type) ([]fieldPlan, bool) {
	if plan, ok := plans[typ]; ok {
		return plan, true
	}
	if nodeTypes[typ.Name()] == typ {
		return buildPlan(typ), true
	}
	return nil, false
}

// buildPlan quotes JSON keys and sorts them once per type, retaining the
// alphabetical member order (Type included) that is part of wire compatibility.
func buildPlan(typ reflect.Type) []fieldPlan {
	fields := make([]fieldPlan, 0, typ.NumField()+1)
	typeName, _ := json.Marshal(typ.Name())
	fields = append(fields, fieldPlan{-1, "Type", append([]byte(`"Type":`), typeName...), true})
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		key, _ := json.Marshal(field.Name)
		fields = append(fields, fieldPlan{i, field.Name, append(key, ':'), field.IsExported()})
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i].name < fields[j].name })
	return fields
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
// Syntax trees are shallow relative to their size, so the first shallowAncestry
// path entries are checked by a linear scan; only deeper entries also live in a
// map. This keeps cycle detection exact while avoiding a hash insert and delete
// for every pointer and slice on ordinary trees.
type ancestry struct {
	path []reference
	deep map[reference]bool
}

// shallowAncestry is the path depth checked by linear scan before hashing.
const shallowAncestry = 32

// newAncestry returns an empty traversal path for one encoding or validation pass.
func newAncestry() *ancestry {
	return &ancestry{path: make([]reference, 0, shallowAncestry)}
}

// enter rejects only ancestors. Its caller calls leave when descent returns;
// a failed enter leaves the path unchanged.
func (a *ancestry) enter(v reflect.Value) (reference, error) {
	key := reference{pointer: v.Pointer()}
	if v.Kind() == reflect.Slice {
		key.slice = true
		key.length = v.Len()
		key.typ = v.Type()
	}
	shallow := a.path
	if len(shallow) > shallowAncestry {
		shallow = shallow[:shallowAncestry]
	}
	for i := range shallow {
		// Comparing addresses first avoids a full struct and interface comparison
		// for the unrelated ancestors that make up almost every scan.
		if shallow[i].pointer == key.pointer && shallow[i] == key {
			return key, fmt.Errorf("cyclic syntax value")
		}
	}
	if len(a.path) >= shallowAncestry {
		if a.deep[key] {
			return key, fmt.Errorf("cyclic syntax value")
		}
		if a.deep == nil {
			a.deep = make(map[reference]bool)
		}
		a.deep[key] = true
	}
	a.path = append(a.path, key)
	return key, nil
}

// leave removes the innermost entry, which must be key from the matching enter.
func (a *ancestry) leave(key reference) {
	a.path = a.path[:len(a.path)-1]
	if len(a.path) >= shallowAncestry {
		delete(a.deep, key)
	}
}

// writer holds one encoding pass's traversal state and output options.
// nodes is nil unless the caller collects Node occurrences; compactPositions
// selects the parse-response position spelling described at AppendParsedFile.
type writer struct {
	active           *ancestry
	nodes            *[]syntax.Node
	compactPositions bool
}

// Append encodes one complete value after dst. Failure discards all partial bytes
// for that value and replays only structural validation in declaration order:
// sorted emission must not change which malformed field is reported first.
// Neither traversal invokes caller methods; unexpected panics propagate unchanged.
func Append(dst []byte, value any) ([]byte, error) {
	out, _, err := appendRoot(dst, reflect.ValueOf(value), &writer{active: newAncestry()})
	return out, err
}

// AppendWithOccurrences encodes a node while retaining each Node occurrence in
// actual wire-field preorder. It calls no methods: only after successful encoding
// may the bridge consume the flat queue to observe bounds. This avoids a second
// reflection walk without exposing cyclic or otherwise rejected graphs to Pos/End.
// Failure discards both partial bytes and references; repeated aliases stay repeated.
func AppendWithOccurrences(dst []byte, node syntax.Node) ([]byte, []syntax.Node, error) {
	nodes := make([]syntax.Node, 0)
	return appendRoot(dst, reflect.ValueOf(node), &writer{active: newAncestry(), nodes: &nodes})
}

// AppendParsedFile encodes a parse response's File, optionally collecting Node
// occurrences exactly as AppendWithOccurrences does. Every syntax.Pos is spelled
// as a compact [Offset,Line,Col,Flags] array (flags as in AppendPositionTuple)
// instead of a six-member object: positions are most of a parse response, and
// the JavaScript decoder rebuilds identical position records from the tuples.
// Records, field order, strings and errors are otherwise those of Append.
func AppendParsedFile(dst []byte, file *syntax.File, collect bool) ([]byte, []syntax.Node, error) {
	w := &writer{active: newAncestry(), compactPositions: true}
	if collect {
		nodes := make([]syntax.Node, 0)
		w.nodes = &nodes
	}
	return appendRoot(dst, reflect.ValueOf(syntax.Node(file)), w)
}

// appendRoot runs one pass and applies the shared failure contract: partial
// bytes and collected occurrences are discarded, and declaration-order
// validation decides which error is reported.
func appendRoot(dst []byte, root reflect.Value, w *writer) ([]byte, []syntax.Node, error) {
	start := len(dst)
	out, err := w.appendValue(dst, root, true, false)
	if err == nil {
		if w.nodes == nil {
			return out, nil, nil
		}
		return out, *w.nodes, nil
	}
	if original := validateValue(root, true, newAncestry()); original != nil {
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

// AppendString preserves Go bytes and encoding/json's HTML-safe escaping for
// ASCII. Every non-ASCII character of valid UTF-8 is written as a \u escape
// (a surrogate pair beyond the BMP), so streamed syntax responses are pure ASCII
// and JSON.parse yields exactly the same JavaScript string as the raw UTF-8 would.
// An ASCII-only response lets the JavaScript side decode it without building a
// two-byte string, which dominated transfer cost for source containing Unicode.
// Invalid UTF-8 keeps its explicit Bytes record.
func AppendString(dst []byte, value string) []byte {
	if !utf8.ValidString(value) {
		dst = append(dst, `{"Bytes":"`...)
		dst = base64.StdEncoding.AppendEncode(dst, []byte(value))
		return append(dst, `"}`...)
	}
	dst = append(dst, '"')
	start := 0
	for i := 0; i < len(value); {
		ch := value[i]
		if ch < utf8.RuneSelf {
			if ch >= ' ' && ch != '"' && ch != '\\' && ch != '<' && ch != '>' && ch != '&' {
				i++
				continue
			}
			dst = append(dst, value[start:i]...)
			switch ch {
			case '"', '\\':
				dst = append(dst, '\\', ch)
			case '\b':
				dst = append(dst, `\b`...)
			case '\f':
				dst = append(dst, `\f`...)
			case '\n':
				dst = append(dst, `\n`...)
			case '\r':
				dst = append(dst, `\r`...)
			case '\t':
				dst = append(dst, `\t`...)
			default:
				dst = appendUnicodeEscape(dst, rune(ch))
			}
			i++
			start = i
			continue
		}
		r, size := utf8.DecodeRuneInString(value[i:])
		dst = append(dst, value[start:i]...)
		if r1, r2 := utf16.EncodeRune(r); r1 != utf8.RuneError {
			dst = appendUnicodeEscape(appendUnicodeEscape(dst, r1), r2)
		} else {
			dst = appendUnicodeEscape(dst, r)
		}
		i += size
		start = i
	}
	dst = append(dst, value[start:]...)
	return append(dst, '"')
}

// AppendASCIIJSON copies complete encoding/json output, replacing each
// non-ASCII character with its \u escape. encoding/json emits non-ASCII only
// inside strings and always as valid UTF-8, so the result is equivalent JSON
// that decodes to the same values. Small envelopes produced by encoding/json use
// this to keep a streamed syntax response entirely ASCII.
func AppendASCIIJSON(dst []byte, data []byte) []byte {
	start := 0
	for i := 0; i < len(data); {
		if data[i] < utf8.RuneSelf {
			i++
			continue
		}
		r, size := utf8.DecodeRune(data[i:])
		dst = append(dst, data[start:i]...)
		if r1, r2 := utf16.EncodeRune(r); r1 != utf8.RuneError {
			dst = appendUnicodeEscape(appendUnicodeEscape(dst, r1), r2)
		} else {
			dst = appendUnicodeEscape(dst, r)
		}
		i += size
		start = i
	}
	return append(dst, data[start:]...)
}

// appendUnicodeEscape writes one UTF-16 code unit as a lowercase \u escape,
// matching encoding/json's spelling for the characters both escape.
func appendUnicodeEscape(dst []byte, unit rune) []byte {
	const hex = "0123456789abcdef"
	return append(dst, '\\', 'u', hex[unit>>12&0xf], hex[unit>>8&0xf], hex[unit>>4&0xf], hex[unit&0xf])
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

// AppendPositionTuple writes Offset,Line,Col,Flags as four bare JSON integers.
// Flags hold bit 0 IsValid, bit 1 IsRecovered and bit 2 OffsetOverflow. Both the
// parse-response File and the compact bounds sidecar use this one spelling.
func AppendPositionTuple(dst []byte, p Position) []byte {
	flags := uint64(0)
	if p.IsValid {
		flags |= 1
	}
	if p.IsRecovered {
		flags |= 2
	}
	if p.OffsetOverflow {
		flags |= 4
	}
	dst = strconv.AppendUint(dst, uint64(p.Offset), 10)
	dst = append(dst, ',')
	dst = strconv.AppendUint(dst, uint64(p.Line), 10)
	dst = append(dst, ',')
	dst = strconv.AppendUint(dst, uint64(p.Col), 10)
	dst = append(dst, ',')
	return strconv.AppendUint(dst, flags, 10)
}

// positionValue copies a Pos through its address when the field is addressable,
// avoiding an interface allocation per position on the hot path. Values reached
// without an address (for example a Pos root) use the ordinary interface copy.
func positionValue(v reflect.Value) syntax.Pos {
	if v.CanAddr() {
		return *v.Addr().Interface().(*syntax.Pos)
	}
	return v.Interface().(syntax.Pos)
}

// appendFrameKind says what an appendFrame is in the middle of writing.
type appendFrameKind uint8

const (
	// appendStruct writes the plan's members of a registered struct.
	appendStruct appendFrameKind = iota
	// appendSlice writes the elements of a non-empty slice.
	appendSlice
	// appendPointer holds an active ancestor while a non-struct pointee is written.
	// A pointer to a struct (every syntax node) shares its struct's frame instead.
	appendPointer
)

// appendFrame is one container whose contents appendValue is writing. A struct
// frame names the member in progress by index-1, so a failure can be wrapped with
// the same Type.Field prefix a recursive descent would add while unwinding.
type appendFrame struct {
	kind   appendFrameKind
	value  reflect.Value
	plan   []fieldPlan
	key    reference
	index  int
	length int
	// leaves is set on a struct frame whose key is the active ancestor entered for
	// the pointer that led to it, to be released when the struct completes.
	leaves bool
}

// unwindAppend prefixes err with the Type.Field of every enclosing struct member,
// outermost first, which is the text a recursive descent builds as it unwinds.
// Slice and pointer frames add nothing. The prefix is assembled once, so a failure
// at depth n costs time proportional to n rather than to the square of the message.
func unwindAppend(stack []appendFrame, err error) error {
	var prefix strings.Builder
	for _, frame := range stack {
		if frame.kind == appendStruct {
			prefix.WriteString(frame.value.Type().Name())
			prefix.WriteByte('.')
			prefix.WriteString(frame.plan[frame.index-1].name)
			prefix.WriteString(": ")
		}
	}
	return prefixed(prefix, err)
}

// prefixed returns err with prefix before its text, or err itself when prefix is empty.
func prefixed(prefix strings.Builder, err error) error {
	if prefix.Len() == 0 {
		return err
	}
	return fmt.Errorf("%s%w", prefix.String(), err)
}

// initialAppendFrames is the container depth that fits without growing the stack;
// ordinary syntax trees nest far less, and deeper ones simply grow it.
const initialAppendFrames = 128

// appendValue emits data only: interface identity controls typed nils, while
// concrete nil pointers remain null. Struct registration precedes field access.
//
// It writes on an explicit stack of appendFrames, not by recursion, so a deep
// left-nested tree is bounded by memory rather than by the call stack. Members
// are emitted in plan order, ancestors are entered and left in the same order a
// recursive descent would, and occurrences are collected at the same points.
func (w *writer) appendValue(dst []byte, v reflect.Value, interfaceSlot bool, observedPointer bool) ([]byte, error) {
	stack := make([]appendFrame, 0, initialAppendFrames)
	// pending carries the ancestor entered for a pointer to a struct until the
	// struct's frame is pushed.
	var pendingKey reference
	pending := false
	for {
		// Write v. Interfaces and pointers hand over to their pointee without
		// returning; a container pushes a frame; anything else completes here.
	value:
		for {
			if !v.IsValid() {
				dst = append(dst, "null"...)
				break value
			}
			// Checking the kind first avoids an interface comparison for every
			// non-struct value; only structs can be positions.
			if v.Kind() == reflect.Struct && v.Type() == positionType {
				position := ObservePosition(positionValue(v))
				if w.compactPositions {
					dst = append(dst, '[')
					dst = append(AppendPositionTuple(dst, position), ']')
				} else {
					dst = AppendPosition(dst, position)
				}
				break value
			}
			if v.Kind() == reflect.Interface {
				if v.IsNil() {
					dst = append(dst, "null"...)
					break value
				}
				v, interfaceSlot, observedPointer = v.Elem(), true, false
				continue
			}
			if v.Kind() == reflect.Pointer && v.IsNil() {
				if !interfaceSlot {
					dst = append(dst, "null"...)
					break value
				}
				typ := v.Type().Elem()
				if _, registered := planFor(typ); !registered {
					return nil, unwindAppend(stack, fmt.Errorf("unsupported typed-nil syntax pointer %s", v.Type()))
				}
				if w.nodes != nil {
					collectNode(v, w.nodes)
				}
				dst = append(dst, `{"Kind":`...)
				dst = AppendString(dst, typ.Name())
				dst = append(dst, `,"Type":"TypedNil"}`...)
				break value
			}
			switch v.Kind() {
			case reflect.Pointer:
				key, err := w.active.enter(v)
				if err != nil {
					return nil, unwindAppend(stack, err)
				}
				observed := false
				if w.nodes != nil {
					observed = collectNode(v, w.nodes)
				}
				// An error abandons the whole pass, so only successful descent must leave.
				if elem := v.Elem(); elem.Kind() == reflect.Struct && elem.Type() != positionType {
					// The pointee's frame releases the ancestor when it completes.
					pending, pendingKey = true, key
				} else {
					stack = append(stack, appendFrame{kind: appendPointer, key: key})
				}
				v, interfaceSlot, observedPointer = v.Elem(), false, observed
				continue
			case reflect.Struct:
				typ := v.Type()
				plan, registered := planFor(typ)
				if !registered {
					return nil, unwindAppend(stack, fmt.Errorf("unsupported syntax struct %s", typ))
				}
				if w.nodes != nil && !observedPointer && v.CanAddr() {
					collectNode(v.Addr(), w.nodes)
				}
				dst = append(dst, '{')
				stack = append(stack, appendFrame{kind: appendStruct, value: v, plan: plan, key: pendingKey, leaves: pending})
				pending = false
			case reflect.Slice:
				if v.IsNil() {
					dst = append(dst, "null"...)
					break value
				}
				length := v.Len()
				if length == 0 {
					dst = append(dst, "[]"...)
					break value
				}
				key, err := w.active.enter(v)
				if err != nil {
					return nil, unwindAppend(stack, err)
				}
				dst = append(dst, '[')
				stack = append(stack, appendFrame{kind: appendSlice, value: v, key: key, length: length})
			case reflect.String:
				dst = AppendString(dst, v.String())
			case reflect.Bool:
				dst = strconv.AppendBool(dst, v.Bool())
			case reflect.Uint8, reflect.Uint32:
				dst = strconv.AppendUint(dst, v.Uint(), 10)
			default:
				return nil, unwindAppend(stack, fmt.Errorf("unsupported syntax value %s", v.Type()))
			}
			break value
		}
		// Resume the innermost container that still has something to write.
	resume:
		for {
			if len(stack) == 0 {
				return dst, nil
			}
			top := &stack[len(stack)-1]
			switch top.kind {
			case appendPointer:
				w.active.leave(top.key)
				stack = stack[:len(stack)-1]
			case appendSlice:
				if top.index == top.length {
					w.active.leave(top.key)
					dst = append(dst, ']')
					stack = stack[:len(stack)-1]
					continue
				}
				if top.index > 0 {
					dst = append(dst, ',')
				}
				v, interfaceSlot, observedPointer = top.value.Index(top.index), false, false
				top.index++
				break resume
			case appendStruct:
				if top.index == len(top.plan) {
					dst = append(dst, '}')
					if top.leaves {
						w.active.leave(top.key)
					}
					stack = stack[:len(stack)-1]
					continue
				}
				field := top.plan[top.index]
				if top.index > 0 {
					dst = append(dst, ',')
				}
				dst = append(dst, field.key...)
				top.index++
				if field.index < 0 {
					continue
				}
				if !field.exported {
					typ := top.value.Type()
					stack = stack[:len(stack)-1]
					return nil, unwindAppend(stack, fmt.Errorf("unsupported private field %s.%s", typ, field.name))
				}
				v, interfaceSlot, observedPointer = top.value.Field(field.index), false, false
				break resume
			}
		}
	}
}

// validateFrame is one struct, slice or pointer whose contents validateValue is
// checking; a struct frame names the member in progress by index-1.
type validateFrame struct {
	kind   appendFrameKind
	value  reflect.Value
	key    reference
	index  int
	length int
}

// unwindValidate prefixes err with each enclosing struct member's Type.Field,
// outermost first, as unwindAppend does for the writer.
func unwindValidate(stack []validateFrame, err error) error {
	var prefix strings.Builder
	for _, frame := range stack {
		if frame.kind == appendStruct {
			typ := frame.value.Type()
			prefix.WriteString(typ.Name())
			prefix.WriteByte('.')
			prefix.WriteString(typ.Field(frame.index - 1).Name)
			prefix.WriteString(": ")
		}
	}
	return prefixed(prefix, err)
}

// validateValue reproduces the old declaration-order error walk without building
// JSON values or calling methods (including position getters). Known positions
// and scalar leaves cannot fail structural encoding. This pass runs only after
// an ordinary writer error and uses separate, path-local reference state.
//
// Like appendValue it keeps its containers on an explicit stack, so the walk that
// decides which error is reported cannot itself be the thing that overflows.
func validateValue(v reflect.Value, interfaceSlot bool, active *ancestry) error {
	stack := make([]validateFrame, 0, initialAppendFrames)
	for {
	value:
		for {
			if !v.IsValid() || v.Type() == positionType {
				break value
			}
			if v.Kind() == reflect.Interface {
				if v.IsNil() {
					break value
				}
				v, interfaceSlot = v.Elem(), true
				continue
			}
			if v.Kind() == reflect.Pointer && v.IsNil() {
				if interfaceSlot {
					typ := v.Type().Elem()
					if nodeTypes[typ.Name()] != typ {
						return unwindValidate(stack, fmt.Errorf("unsupported typed-nil syntax pointer %s", v.Type()))
					}
				}
				break value
			}
			switch v.Kind() {
			case reflect.Pointer:
				key, err := active.enter(v)
				if err != nil {
					return unwindValidate(stack, err)
				}
				stack = append(stack, validateFrame{kind: appendPointer, key: key})
				v, interfaceSlot = v.Elem(), false
				continue
			case reflect.Struct:
				typ := v.Type()
				if nodeTypes[typ.Name()] != typ {
					return unwindValidate(stack, fmt.Errorf("unsupported syntax struct %s", typ))
				}
				stack = append(stack, validateFrame{kind: appendStruct, value: v, length: typ.NumField()})
			case reflect.Slice:
				frame := validateFrame{kind: appendSlice, value: v, length: v.Len()}
				if frame.length > 0 {
					key, err := active.enter(v)
					if err != nil {
						return unwindValidate(stack, err)
					}
					frame.key = key
				}
				stack = append(stack, frame)
			case reflect.String, reflect.Bool, reflect.Uint8, reflect.Uint32:
			default:
				return unwindValidate(stack, fmt.Errorf("unsupported syntax value %s", v.Type()))
			}
			break value
		}
	resume:
		for {
			if len(stack) == 0 {
				return nil
			}
			top := &stack[len(stack)-1]
			switch top.kind {
			case appendPointer:
				active.leave(top.key)
				stack = stack[:len(stack)-1]
			case appendSlice:
				if top.index == top.length {
					if top.length > 0 {
						active.leave(top.key)
					}
					stack = stack[:len(stack)-1]
					continue
				}
				v, interfaceSlot = top.value.Index(top.index), false
				top.index++
				break resume
			case appendStruct:
				if top.index == top.length {
					stack = stack[:len(stack)-1]
					continue
				}
				typ := top.value.Type()
				field := typ.Field(top.index)
				if !field.IsExported() {
					stack = stack[:len(stack)-1]
					return unwindValidate(stack, fmt.Errorf("unsupported private field %s.%s", typ, field.Name))
				}
				v, interfaceSlot = top.value.Field(top.index), false
				top.index++
				break resume
			}
		}
	}
}
