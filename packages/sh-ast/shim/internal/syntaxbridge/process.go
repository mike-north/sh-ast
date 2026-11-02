// Package syntaxbridge owns synchronous syntax operations at the WASM boundary.
// It preserves upstream parser options, partial results, errors, and computed
// positions while keeping malformed transport distinct from shell syntax errors.
// Printing is intentionally absent; syntaxwire's reverse path supports private
// fidelity tests and current-tree bounds without publishing a printer operation.
package syntaxbridge

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

// Process accepts raw source bytes in payload for parse, and complete JSON
// records for other operations. Go strings are byte sequences, so the WASM ABI
// does not decode or repair source UTF-8 before upstream sees it. Every response
// is JSON; unexpected panics are internal errors, not fabricated ParseErrors.
func Process(operation, payload, options string) (result []byte) {
	defer func() {
		if failure := recover(); failure != nil {
			result = marshal(errorResponse("InternalError", fmt.Sprint(failure)))
		}
	}()
	switch operation {
	case "parse":
		return marshal(parse(payload, options))
	case "parse-with-positions":
		return marshal(parseWithPositions(payload, options))
	case "bounds":
		return marshal(bounds(payload))
	case "pos":
		return marshal(nodePosition(payload, syntax.Node.Pos))
	case "end":
		return marshal(nodePosition(payload, syntax.Node.End))
	case "newpos":
		return marshal(newPosition(payload))
	default:
		return marshal(errorResponse("InputError", fmt.Sprintf("unknown syntax operation %q", operation)))
	}
}

// marshal is the envelope's single encoding boundary. Operation data is already
// converted to JSON-safe values; an encoding failure denotes a bridge defect.
func marshal(value map[string]any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		data, _ = json.Marshal(errorResponse("InternalError", err.Error()))
	}
	return data
}

// errorResponse keeps adapter validation and internal failures separate from the
// two structured upstream parser errors. Messages preserve arbitrary Go bytes.
func errorResponse(kind, message string) map[string]any {
	return map[string]any{"Error": map[string]any{"Kind": kind, "Message": syntaxwire.String(message)}}
}

// object reads one exact JSON object, preserving full integer precision before
// any Go conversion. Unknown fields are checked by the operation that owns them.
func object(text string) (map[string]any, error) {
	value, err := syntaxwire.ReadJSON([]byte(text))
	if err != nil {
		return nil, err
	}
	obj, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected a JSON object")
	}
	return obj, nil
}

// integerText accepts safe JSON integers or explicit decimal Int records. The
// latter are the transport for JS bigint, retaining the full target int64/uint64
// domain without relying on JSON floating-point decoding or lossy coercion.
func integerText(value any) (string, error) {
	if number, ok := value.(json.Number); ok {
		integer, err := number.Int64()
		if err != nil || integer < -9007199254740991 || integer > 9007199254740991 {
			return "", fmt.Errorf("numeric input must be a safe integer; use an Int decimal record for larger values")
		}
		return strconv.FormatInt(integer, 10), nil
	}
	obj, ok := value.(map[string]any)
	if !ok || len(obj) != 1 {
		return "", fmt.Errorf("expected a safe integer or an Int decimal record")
	}
	text, ok := obj["Int"].(string)
	if !ok || text == "" {
		return "", fmt.Errorf("Int must be a decimal integer string")
	}
	for i, ch := range text {
		if ch == '-' && i == 0 && len(text) > 1 {
			continue
		}
		if ch < '0' || ch > '9' {
			return "", fmt.Errorf("Int must be a decimal integer string")
		}
	}
	return text, nil
}

// signedInput follows the actual Go js/wasm int width, proven by a target test.
func signedInput(value any) (int, error) {
	text, err := integerText(value)
	if err != nil {
		return 0, err
	}
	integer, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("input is outside the Go int64 domain")
	}
	return int(integer), nil
}

// unsignedInput preserves the uint64 constructor domain before NewPos applies
// its own narrower storage saturation and overflow rules.
func unsignedInput(value any) (uint, error) {
	text, err := integerText(value)
	if err != nil {
		return 0, err
	}
	integer, err := strconv.ParseUint(text, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("input is outside the Go uint64 domain")
	}
	return uint(integer), nil
}

// option captures only upstream option-construction panics, whose contract is
// invalid caller input. Other panics are handled as internal failures by Process.
func option(makeOption func() syntax.ParserOption) (result syntax.ParserOption, err error) {
	defer func() {
		if failure := recover(); failure != nil {
			err = fmt.Errorf("%v", failure)
		}
	}()
	return makeOption(), nil
}

// parseOptions applies upstream defaults by constructing only explicitly supplied
// options. It preserves false, zero, negative recovery limits, and legacy Variant0.
func parseOptions(text string) (string, []syntax.ParserOption, error) {
	obj, err := object(text)
	if err != nil {
		return "", nil, err
	}
	filename := ""
	opts := make([]syntax.ParserOption, 0, 4)
	for name, value := range obj {
		switch name {
		case "Filename":
			filename, err = syntaxwire.ReadString(value)
		case "KeepComments":
			boolean, ok := value.(bool)
			if !ok {
				err = fmt.Errorf("KeepComments must be boolean")
			} else {
				opts = append(opts, syntax.KeepComments(boolean))
			}
		case "Variant":
			var integer int
			integer, err = signedInput(value)
			if err == nil {
				var opt syntax.ParserOption
				opt, err = option(func() syntax.ParserOption { return syntax.Variant(syntax.LangVariant(integer)) })
				if err == nil {
					opts = append(opts, opt)
				}
			}
		case "StopAt":
			var word string
			word, err = syntaxwire.ReadString(value)
			if err == nil {
				var opt syntax.ParserOption
				opt, err = option(func() syntax.ParserOption { return syntax.StopAt(word) })
				if err == nil {
					opts = append(opts, opt)
				}
			}
		case "RecoverErrors":
			var integer int
			integer, err = signedInput(value)
			if err == nil {
				opts = append(opts, syntax.RecoverErrors(integer))
			}
		default:
			err = fmt.Errorf("unknown parser option %q", name)
		}
		if err != nil {
			return "", nil, fmt.Errorf("%s: %w", name, err)
		}
	}
	return filename, opts, nil
}

// parse preserves the File returned alongside an error. Its error fields come
// directly from upstream values, never from parsing formatted diagnostic text.
func parse(source, options string) map[string]any {
	_, result := parseResult(source, options)
	return result
}

// parseResult keeps parser invocation, encoding and structured error adaptation
// in one place. Supplemental observations can use the original Go File without
// another parse or reconstructing the serialized tree.
func parseResult(source, options string) (*syntax.File, map[string]any) {
	filename, opts, err := parseOptions(options)
	if err != nil {
		return nil, errorResponse("InputError", err.Error())
	}
	file, parseError := syntax.NewParser(opts...).Parse(strings.NewReader(source), filename)
	encoded, err := syntaxwire.Value(file)
	if err != nil {
		return file, errorResponse("InternalError", err.Error())
	}
	result := map[string]any{"File": encoded}
	if parseError == nil {
		return file, result
	}
	failure := map[string]any{"Message": syntaxwire.String(parseError.Error())}
	switch err := parseError.(type) {
	case syntax.ParseError:
		failure["Kind"] = "ParseError"
		failure["Filename"] = syntaxwire.String(err.Filename)
		failure["Pos"] = syntaxwire.ObservePosition(err.Pos)
		failure["Text"] = syntaxwire.String(err.Text)
		failure["Incomplete"] = err.Incomplete
	case syntax.LangError:
		failure["Kind"] = "LangError"
		failure["Filename"] = syntaxwire.String(err.Filename)
		failure["Pos"] = syntaxwire.ObservePosition(err.Pos)
		failure["Feature"] = syntaxwire.String(err.Feature)
		failure["Langs"] = err.Langs
		failure["LangUsed"] = err.LangUsed
	default:
		failure["Kind"] = "InternalError"
	}
	result["Error"] = failure
	return file, result
}

// bounds delegates to upstream methods on the reconstructed current tree. Go
// permits incomplete structs whose methods panic; those caller-provided shapes
// produce InputError rather than escaping through the long-lived WASM instance.
func bounds(payload string) (result map[string]any) {
	defer func() {
		if failure := recover(); failure != nil {
			result = errorResponse("InputError", fmt.Sprintf("upstream node bounds: %v", failure))
		}
	}()
	node, err := syntaxwire.DecodeNode([]byte(payload))
	if err != nil {
		return errorResponse("InputError", err.Error())
	}
	return map[string]any{"Pos": syntaxwire.ObservePosition(node.Pos()), "End": syntaxwire.ObservePosition(node.End())}
}

// nodePosition invokes exactly the requested upstream method. A partial tree can
// have a usable start without a usable end, or vice versa; computing both would
// add a constraint that the caller's chosen upstream operation does not have.
func nodePosition(payload string, read func(syntax.Node) syntax.Pos) (result map[string]any) {
	node, err := syntaxwire.DecodeNode([]byte(payload))
	if err != nil {
		return errorResponse("InputError", err.Error())
	}
	defer func() {
		if failure := recover(); failure != nil {
			result = errorResponse("InputError", fmt.Sprintf("upstream node position: %v", failure))
		}
	}()
	return map[string]any{"Position": syntaxwire.ObservePosition(read(node))}
}

// newPosition preserves NewPos's saturation/overflow behavior; validation checks
// only the caller's uint64 domain, not the constructor's narrower stored limits.
func newPosition(payload string) map[string]any {
	obj, err := object(payload)
	if err != nil {
		return errorResponse("InputError", err.Error())
	}
	if len(obj) != 3 {
		return errorResponse("InputError", "newpos requires Offset, Line, Col")
	}
	values := [3]uint{}
	for index, name := range []string{"Offset", "Line", "Col"} {
		value, ok := obj[name]
		if !ok {
			return errorResponse("InputError", "newpos requires Offset, Line, Col")
		}
		values[index], err = unsignedInput(value)
		if err != nil {
			return errorResponse("InputError", name+": "+err.Error())
		}
	}
	return map[string]any{"Position": syntaxwire.ObservePosition(syntax.NewPos(values[0], values[1], values[2]))}
}
