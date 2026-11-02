package syntaxbridge

// Prototype: a streaming encoder for parse / parse-with-positions that
// writes the existing wire format byte-for-byte (sorted record keys, struct-order
// Position and snapshot entries) without building a map[string]any tree or
// a []positionSnapshot with boxed []any paths.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

var posType = reflect.TypeFor[syntax.Pos]()

type fieldPlan struct {
	key   []byte // `"Name":`
	index int    // -1 for the synthetic Type key
}

type recordPlan struct {
	fields   []fieldPlan
	typeJSON []byte
}

var plans = map[reflect.Type]*recordPlan{}

func planFor(typ reflect.Type) *recordPlan {
	if p, ok := plans[typ]; ok {
		return p
	}
	type named struct {
		name  string
		index int
	}
	names := []named{{"Type", -1}}
	for i := 0; i < typ.NumField(); i++ {
		names = append(names, named{typ.Field(i).Name, i})
	}
	sort.Slice(names, func(a, b int) bool { return names[a].name < names[b].name })
	p := &recordPlan{typeJSON: jsonString(typ.Name())}
	for _, n := range names {
		p.fields = append(p.fields, fieldPlan{key: append(jsonString(n.name), ':'), index: n.index})
	}
	plans[typ] = p
	return p
}

func jsonString(s string) []byte {
	b, _ := json.Marshal(s)
	return b
}

func writeString(buf *bytes.Buffer, s string) {
	if !utf8.ValidString(s) {
		buf.WriteString(`{"Bytes":`)
		buf.Write(jsonString(base64.StdEncoding.EncodeToString([]byte(s))))
		buf.WriteByte('}')
		return
	}
	simple := true
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < 0x20 || c == '"' || c == '\\' || c == '<' || c == '>' || c == '&' || c >= 0x80 {
			simple = false
			break
		}
	}
	if simple {
		buf.WriteByte('"')
		buf.WriteString(s)
		buf.WriteByte('"')
		return
	}
	buf.Write(jsonString(s))
}

func writeBool(buf *bytes.Buffer, b bool) {
	if b {
		buf.WriteString("true")
	} else {
		buf.WriteString("false")
	}
}

func writePosition(buf *bytes.Buffer, p syntaxwire.Position) {
	var tmp [20]byte
	buf.WriteString(`{"Offset":`)
	buf.Write(strconv.AppendUint(tmp[:0], uint64(p.Offset), 10))
	buf.WriteString(`,"Line":`)
	buf.Write(strconv.AppendUint(tmp[:0], uint64(p.Line), 10))
	buf.WriteString(`,"Col":`)
	buf.Write(strconv.AppendUint(tmp[:0], uint64(p.Col), 10))
	buf.WriteString(`,"IsValid":`)
	writeBool(buf, p.IsValid)
	buf.WriteString(`,"IsRecovered":`)
	writeBool(buf, p.IsRecovered)
	buf.WriteString(`,"OffsetOverflow":`)
	writeBool(buf, p.OffsetOverflow)
	buf.WriteByte('}')
}

type streamer struct {
	buf      bytes.Buffer
	ancestry map[uintptr]bool
	// compact sidecar: when non-nil, every Node occurrence is observed in encode (pre-)order
	flat   *[]uint64
	errors *[]any
	// viaPointer suppresses re-observing a struct reached by dereferencing an observed pointer.
	viaPointer bool
}

var nodeIface = reflect.TypeFor[syntax.Node]()

func flags(p syntaxwire.Position) uint64 {
	var f uint64
	if p.IsValid {
		f |= 1
	}
	if p.IsRecovered {
		f |= 2
	}
	if p.OffsetOverflow {
		f |= 4
	}
	return f
}

func (s *streamer) observe(node syntax.Node) {
	if s.flat == nil {
		return
	}
	index := len(*s.flat) / 8
	start, startErr := snapshotPosition(node, syntax.Node.Pos)
	end, endErr := snapshotPosition(node, syntax.Node.End)
	for _, p := range []*syntaxwire.Position{start, end} {
		if p == nil {
			*s.flat = append(*s.flat, 0, 0, 0, 0)
		} else {
			*s.flat = append(*s.flat, uint64(p.Offset), uint64(p.Line), uint64(p.Col), flags(*p))
		}
	}
	if startErr != nil || endErr != nil {
		*s.errors = append(*s.errors, []any{index, startErr, endErr})
	}
}

func (s *streamer) value(v reflect.Value) error {
	buf := &s.buf
	if !v.IsValid() {
		buf.WriteString("null")
		return nil
	}
	if v.Type() == posType {
		writePosition(buf, syntaxwire.ObservePosition(v.Interface().(syntax.Pos)))
		return nil
	}
	switch v.Kind() {
	case reflect.Interface:
		if v.IsNil() {
			buf.WriteString("null")
			return nil
		}
		d := v.Elem()
		if d.Kind() == reflect.Pointer && d.IsNil() {
			if node, ok := d.Interface().(syntax.Node); ok {
				s.observe(node)
			}
			buf.WriteString(`{"Kind":`)
			buf.Write(jsonString(d.Type().Elem().Name()))
			buf.WriteString(`,"Type":"TypedNil"}`)
			return nil
		}
		return s.value(d)
	case reflect.Pointer:
		if v.IsNil() {
			buf.WriteString("null")
			return nil
		}
		if node, ok := v.Interface().(syntax.Node); ok {
			s.observe(node)
		}
		ptr := v.Pointer()
		if s.ancestry[ptr] {
			return fmt.Errorf("cyclic syntax value")
		}
		s.ancestry[ptr] = true
		defer delete(s.ancestry, ptr)
		s.viaPointer = true
		return s.value(v.Elem())
	case reflect.Struct:
		via := s.viaPointer
		s.viaPointer = false
		if !via && v.CanAddr() && s.flat != nil {
			if node, ok := v.Addr().Interface().(syntax.Node); ok {
				s.observe(node)
			}
		}
		p := planFor(v.Type())
		buf.WriteByte('{')
		for i, f := range p.fields {
			if i > 0 {
				buf.WriteByte(',')
			}
			buf.Write(f.key)
			if f.index < 0 {
				buf.Write(p.typeJSON)
				continue
			}
			if err := s.value(v.Field(f.index)); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
		return nil
	case reflect.Slice:
		if v.IsNil() {
			buf.WriteString("null")
			return nil
		}
		buf.WriteByte('[')
		for i := 0; i < v.Len(); i++ {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := s.value(v.Index(i)); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
		return nil
	case reflect.String:
		writeString(buf, v.String())
		return nil
	case reflect.Bool:
		writeBool(buf, v.Bool())
		return nil
	case reflect.Uint32:
		var tmp [20]byte
		buf.Write(strconv.AppendUint(tmp[:0], v.Uint(), 10))
		return nil
	}
	return fmt.Errorf("unsupported syntax value %s", v.Type())
}

// snapshots streams the same entries positionSnapshots would build, in the same order.
func (s *streamer) snapshots(root syntax.Node) {
	buf := &s.buf
	path := make([]any, 0, 64)
	first := true
	observe := func(node syntax.Node) {
		start, startErr := snapshotPosition(node, syntax.Node.Pos)
		end, endErr := snapshotPosition(node, syntax.Node.End)
		if !first {
			buf.WriteByte(',')
		}
		first = false
		buf.WriteString(`{"Path":[`)
		for i, seg := range path {
			if i > 0 {
				buf.WriteByte(',')
			}
			switch x := seg.(type) {
			case string:
				buf.WriteByte('"')
				buf.WriteString(x)
				buf.WriteByte('"')
			case int:
				var tmp [20]byte
				buf.Write(strconv.AppendInt(tmp[:0], int64(x), 10))
			}
		}
		buf.WriteString(`],"Pos":`)
		if start == nil {
			buf.WriteString("null")
		} else {
			writePosition(buf, *start)
		}
		buf.WriteString(`,"End":`)
		if end == nil {
			buf.WriteString("null")
		} else {
			writePosition(buf, *end)
		}
		buf.WriteString(`,"PosError":`)
		writeAny(buf, startErr)
		buf.WriteString(`,"EndError":`)
		writeAny(buf, endErr)
		buf.WriteByte('}')
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
			typ := value.Type()
			if typ == posType {
				return
			}
			for i := 0; i < value.NumField(); i++ {
				f := typ.Field(i)
				if f.IsExported() {
					path = append(path, f.Name)
					visit(value.Field(i), false)
					path = path[:len(path)-1]
				}
			}
		case reflect.Slice:
			for i := 0; i < value.Len(); i++ {
				path = append(path, i)
				visit(value.Index(i), false)
				path = path[:len(path)-1]
			}
		}
	}
	visit(reflect.ValueOf(root), true)
}

func writeAny(buf *bytes.Buffer, v any) {
	if v == nil {
		buf.WriteString("null")
		return
	}
	b, _ := json.Marshal(v)
	buf.Write(b)
}

// streamParse returns nil when the prototype does not cover the case (errors), so
// the caller falls back to the existing map-based path.
func streamParse(source, options string, withPositions bool) []byte {
	filename, opts, err := parseOptions(options)
	if err != nil {
		return nil
	}
	file, parseError := syntax.NewParser(opts...).Parse(strings.NewReader(source), filename)
	if parseError != nil {
		return nil
	}
	s := &streamer{ancestry: map[uintptr]bool{}}
	s.buf.Grow(len(source) * 300)
	s.buf.WriteString(`{"File":`)
	if err := s.value(reflect.ValueOf(file)); err != nil {
		return nil
	}
	if withPositions {
		s.buf.WriteString(`,"Positions":[`)
		s.snapshots(file)
		s.buf.WriteByte(']')
	}
	s.buf.WriteByte('}')
	return s.buf.Bytes()
}

// streamParseCompact: File as before; Positions as a flat [8]uint per Node in
// schema (sorted-field) pre-order; PositionErrors as sparse [index, posErr, endErr].
func streamParseCompact(source, options string) []byte {
	filename, opts, err := parseOptions(options)
	if err != nil {
		return nil
	}
	file, parseError := syntax.NewParser(opts...).Parse(strings.NewReader(source), filename)
	if parseError != nil {
		return nil
	}
	flat := make([]uint64, 0, len(source)*4)
	errs := []any{}
	s := &streamer{ancestry: map[uintptr]bool{}, flat: &flat, errors: &errs}
	s.buf.Grow(len(source) * 160)
	s.buf.WriteString(`{"File":`)
	if err := s.value(reflect.ValueOf(file)); err != nil {
		return nil
	}
	s.buf.WriteString(`,"PositionErrors":`)
	writeAny(&s.buf, errs)
	s.buf.WriteString(`,"Positions":[`)
	var tmp [20]byte
	for i, n := range flat {
		if i > 0 {
			s.buf.WriteByte(',')
		}
		s.buf.Write(strconv.AppendUint(tmp[:0], n, 10))
	}
	s.buf.WriteString(`]}`)
	return s.buf.Bytes()
}
