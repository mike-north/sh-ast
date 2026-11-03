// Package wireformtest is a test-only oracle for the parse-response wire form.
// It converts frozen encoding/json output, produced by the retired map-based
// implementation, into the current spelling so tests can still compare complete
// responses byte for byte: text is ASCII-only, and File positions are compact
// tuples. It deliberately shares no code with the production writer or the
// JavaScript decoder; only test files import it.
package wireformtest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"unicode/utf16"
	"unicode/utf8"
)

// Escape replaces every non-ASCII character of valid UTF-8 JSON text with a
// lowercase \u escape, using a UTF-16 surrogate pair outside the BMP. ASCII
// bytes, including existing escapes, are copied unchanged.
func Escape(data []byte) []byte {
	out := make([]byte, 0, len(data))
	for len(data) > 0 {
		r, size := utf8.DecodeRune(data)
		switch {
		case r < utf8.RuneSelf:
			out = append(out, data[0])
		case r > 0xffff:
			high, low := utf16.EncodeRune(r)
			out = fmt.Appendf(out, `\u%04x\u%04x`, high, low)
		default:
			out = fmt.Appendf(out, `\u%04x`, r)
		}
		data = data[size:]
	}
	return out
}

// positionObject matches one frozen position record. Quotes inside JSON
// strings are escaped, so the pattern cannot match string content.
var positionObject = regexp.MustCompile(`\{"Offset":(\d+),"Line":(\d+),"Col":(\d+),"IsValid":(true|false),"IsRecovered":(true|false),"OffsetOverflow":(true|false)\}`)

// CompactPositions rewrites every position record in data to its
// [Offset,Line,Col,Flags] tuple, with flags bit 0 IsValid, bit 1 IsRecovered
// and bit 2 OffsetOverflow.
func CompactPositions(data []byte) []byte {
	return positionObject.ReplaceAllFunc(data, func(match []byte) []byte {
		parts := positionObject.FindSubmatch(match)
		flags := 0
		for bit, part := range parts[4:] {
			if string(part) == "true" {
				flags |= 1 << bit
			}
		}
		return fmt.Appendf(nil, "[%s,%s,%s,%d]", parts[1], parts[2], parts[3], flags)
	})
}

// Response converts a complete frozen parse or parse-with-positions response.
// Only the File member is compacted: error envelopes keep their position record
// (Error precedes File, and no Error member is named File).
func Response(frozen []byte) []byte {
	escaped := Escape(frozen)
	index := bytes.Index(escaped, []byte(`"File":`))
	if index < 0 {
		return escaped
	}
	return append(append([]byte(nil), escaped[:index]...), CompactPositions(escaped[index:])...)
}

// ExpandPositions converts compact position tuples in a decoded File graph back
// to the record form that syntax decoding accepts. Syntax records contain no
// numeric slices, so an array of exactly four numbers is always a position.
// It accepts values decoded with json.Number, as syntaxwire.ReadJSON produces.
func ExpandPositions(value any) any {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			v[key] = ExpandPositions(child)
		}
		return v
	case []any:
		if len(v) == 4 {
			numbers := make([]json.Number, 0, 4)
			for _, item := range v {
				if number, ok := item.(json.Number); ok {
					numbers = append(numbers, number)
				}
			}
			if len(numbers) == 4 {
				flags, _ := numbers[3].Int64()
				return map[string]any{
					"Offset": numbers[0], "Line": numbers[1], "Col": numbers[2],
					"IsValid": flags&1 != 0, "IsRecovered": flags&2 != 0, "OffsetOverflow": flags&4 != 0,
				}
			}
		}
		for i, child := range v {
			v[i] = ExpandPositions(child)
		}
		return v
	default:
		return value
	}
}
