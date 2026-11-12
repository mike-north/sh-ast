package syntaxwire

// Reference implementations used only by tests. These are the original recursive
// encoder, validator and decoder, kept verbatim (apart from their names) so that
// differential tests can prove the explicit-stack versions produce identical bytes,
// occurrence queues, errors and decoded values. They are never called by production.

import (
	"fmt"
	"reflect"
	"strconv"
)

// appendValue emits data only: interface identity controls typed nils, while
// concrete nil pointers remain null. Struct registration precedes field access.
func (w *writer) referenceAppendValue(dst []byte, v reflect.Value, interfaceSlot bool, observedPointer bool) ([]byte, error) {
	if !v.IsValid() {
		return append(dst, "null"...), nil
	}
	// Checking the kind first avoids an interface comparison for every
	// non-struct value; only structs can be positions.
	if v.Kind() == reflect.Struct && v.Type() == positionType {
		position := ObservePosition(positionValue(v))
		if w.compactPositions {
			dst = append(dst, '[')
			return append(AppendPositionTuple(dst, position), ']'), nil
		}
		return AppendPosition(dst, position), nil
	}
	if v.Kind() == reflect.Interface {
		if v.IsNil() {
			return append(dst, "null"...), nil
		}
		return w.referenceAppendValue(dst, v.Elem(), true, false)
	}
	if v.Kind() == reflect.Pointer && v.IsNil() {
		if !interfaceSlot {
			return append(dst, "null"...), nil
		}
		typ := v.Type().Elem()
		if _, registered := planFor(typ); !registered {
			return nil, fmt.Errorf("unsupported typed-nil syntax pointer %s", v.Type())
		}
		if w.nodes != nil {
			collectNode(v, w.nodes)
		}
		dst = append(dst, `{"Kind":`...)
		dst = AppendString(dst, typ.Name())
		return append(dst, `,"Type":"TypedNil"}`...), nil
	}
	switch v.Kind() {
	case reflect.Pointer:
		key, err := w.active.enter(v)
		if err != nil {
			return nil, err
		}
		observed := false
		if w.nodes != nil {
			observed = collectNode(v, w.nodes)
		}
		// An error abandons the whole pass, so only successful descent must leave.
		dst, err = w.referenceAppendValue(dst, v.Elem(), false, observed)
		if err != nil {
			return nil, err
		}
		w.active.leave(key)
		return dst, nil
	case reflect.Struct:
		typ := v.Type()
		plan, registered := planFor(typ)
		if !registered {
			return nil, fmt.Errorf("unsupported syntax struct %s", typ)
		}
		if w.nodes != nil && !observedPointer && v.CanAddr() {
			collectNode(v.Addr(), w.nodes)
		}
		dst = append(dst, '{')
		for i, field := range plan {
			if i > 0 {
				dst = append(dst, ',')
			}
			dst = append(dst, field.key...)
			if field.index < 0 {
				continue
			}
			if !field.exported {
				return nil, fmt.Errorf("unsupported private field %s.%s", typ, field.name)
			}
			var err error
			dst, err = w.referenceAppendValue(dst, v.Field(field.index), false, false)
			if err != nil {
				return nil, fmt.Errorf("%s.%s: %w", typ.Name(), field.name, err)
			}
		}
		return append(dst, '}'), nil
	case reflect.Slice:
		if v.IsNil() {
			return append(dst, "null"...), nil
		}
		length := v.Len()
		if length == 0 {
			return append(dst, "[]"...), nil
		}
		key, err := w.active.enter(v)
		if err != nil {
			return nil, err
		}
		dst = append(dst, '[')
		for i := 0; i < length; i++ {
			if i > 0 {
				dst = append(dst, ',')
			}
			dst, err = w.referenceAppendValue(dst, v.Index(i), false, false)
			if err != nil {
				return nil, err
			}
		}
		w.active.leave(key)
		return append(dst, ']'), nil
	case reflect.String:
		return AppendString(dst, v.String()), nil
	case reflect.Bool:
		return strconv.AppendBool(dst, v.Bool()), nil
	case reflect.Uint8, reflect.Uint32:
		return strconv.AppendUint(dst, v.Uint(), 10), nil
	default:
		return nil, fmt.Errorf("unsupported syntax value %s", v.Type())
	}
}

// validateValue reproduces the old declaration-order error walk without building
// JSON values or calling methods (including position getters). Known positions
// and scalar leaves cannot fail structural encoding. This pass runs only after
// an ordinary writer error and uses separate, path-local reference state.
func referenceValidateValue(v reflect.Value, interfaceSlot bool, active *ancestry) error {
	if !v.IsValid() || v.Type() == positionType {
		return nil
	}
	if v.Kind() == reflect.Interface {
		if v.IsNil() {
			return nil
		}
		return referenceValidateValue(v.Elem(), true, active)
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
		defer active.leave(key)
		return referenceValidateValue(v.Elem(), false, active)
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
			if err := referenceValidateValue(v.Field(i), false, active); err != nil {
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
			defer active.leave(key)
		}
		for i := 0; i < v.Len(); i++ {
			if err := referenceValidateValue(v.Index(i), false, active); err != nil {
				return err
			}
		}
		return nil
	case reflect.String, reflect.Bool, reflect.Uint8, reflect.Uint32:
		return nil
	default:
		return fmt.Errorf("unsupported syntax value %s", v.Type())
	}
}

// decodeValue checks the actual destination Go type, including interface
// membership, rather than trusting a caller-supplied discriminator.
func referenceDecodeValue(target reflect.Value, value any) error {
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
		return referenceDecodeValue(target.Elem(), value)
	case reflect.Interface:
		obj, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("expected syntax object")
		}
		if obj["Type"] == "TypedNil" {
			pointer, err := readTypedNil(obj)
			if err != nil {
				return err
			}
			if !pointer.Type().Implements(target.Type()) {
				return fmt.Errorf("typed-nil %s does not implement %s", pointer.Type(), target.Type())
			}
			target.Set(pointer)
			return nil
		}
		name, _ := obj["Type"].(string)
		typ := nodeTypes[name]
		if typ == nil || !reflect.PointerTo(typ).Implements(target.Type()) {
			return fmt.Errorf("%q does not implement %s", name, target.Type())
		}
		node := reflect.New(typ)
		if err := referenceDecodeValue(node.Elem(), value); err != nil {
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
			if err := referenceDecodeValue(target.Field(i), entry); err != nil {
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
			if err := referenceDecodeValue(target.Index(i), entry); err != nil {
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
	case reflect.Uint8, reflect.Uint32:
		number, err := readUint32(value)
		if err != nil {
			return err
		}
		// Named uint8 option states and uint32 operators retain their full
		// storage domain; reject overflow before reflection can truncate it.
		if target.OverflowUint(number) {
			return fmt.Errorf("integer overflows %s", target.Type())
		}
		target.SetUint(number)
		return nil
	default:
		return fmt.Errorf("unsupported destination %s", target.Type())
	}
}
