// Interface tables for every syntax conversion the bridge performs at run time
// are built once, during package initialization, instead of on first use.
//
// The Go js/wasm runtime (verified on 1.26.5) builds an itab for a dynamic
// interface conversion in runtime.itabInit, which stores the entry "PC" of each
// method after the first through an ordinary pointer write, with a GC write
// barrier. On js/wasm a PC is the number funcIndex<<16|block, not an address,
// and this module's PCs are at least 0x10000000. When a conversion first
// happens while a GC cycle is marking and the heap has grown past that value
// (about 256 MiB, reached by large parse responses), the barrier hands the GC a
// number inside a heap arena; if it lands in a free part of a span the runtime
// aborts with "found bad pointer in Go heap" and the instance is lost.
//
// At initialization the heap is a few megabytes, far below every PC, so a
// recorded PC is never inside a heap arena. The runtime caches each itab for
// the life of the process, so later conversions of these pairs reuse it and
// never reach itabInit again. Only interfaces with two or more methods are
// affected; the runtime stores the first method without a barrier.
package syntaxwire

import (
	"reflect"

	"mvdan.cc/sh/v3/syntax"
)

func init() {
	warmInterfaceTables()
}

// syntaxInterfaces lists syntax.Node and every interface type held by a field
// (or slice element) of a registered syntax struct: exactly the interfaces the
// decoder assigns to and the encoder asserts to.
func syntaxInterfaces() []reflect.Type {
	seen := map[reflect.Type]bool{reflect.TypeFor[syntax.Node](): true}
	result := []reflect.Type{reflect.TypeFor[syntax.Node]()}
	for _, typ := range nodeTypes {
		for i := 0; i < typ.NumField(); i++ {
			field := typ.Field(i).Type
			if field.Kind() == reflect.Slice {
				field = field.Elem()
			}
			if field.Kind() == reflect.Interface && !seen[field] {
				seen[field] = true
				result = append(result, field)
			}
		}
	}
	return result
}

// warmInterfaceTables performs, once, every run-time conversion the bridge can
// later make: a syntax.Node assertion on each registered struct pointer
// (including the negative result for auxiliary structs) and an assignment of
// each pointer to every syntax interface it implements, through the same
// reflect path the decoder uses.
func warmInterfaceTables() {
	interfaces := syntaxInterfaces()
	for _, typ := range nodeTypes {
		pointer := reflect.New(typ)
		_, _ = pointer.Interface().(syntax.Node)
		for _, iface := range interfaces {
			if pointer.Type().Implements(iface) {
				reflect.New(iface).Elem().Set(pointer)
			}
		}
	}
}
