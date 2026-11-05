// Literal VT and FF belong to shell data, not the printer's tabwriter protocol.
// These native assertions isolate that boundary from the WASM transport.
package syntaxbridge

import (
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// Expected programs are written directly from shell syntax, not printer output.
// Both ANSI-C spellings matter: literal bytes and written escapes must survive.
func TestPrinterControlBytes(t *testing.T) {
	for _, char := range []struct{ name, byte, escape string }{
		{"VT", "\v", "v"},
		{"FF", "\f", "f"},
	} {
		for _, fixture := range []struct{ position, source string }{
			{"single", "printf '%s' 'a" + char.byte + "b'\n"},
			{"double", "printf '%s' \"a" + char.byte + "b\"\n"},
			{"ansi", "printf '%s' $'a" + char.byte + "b'\n"},
			{"ansi-escape", "printf '%s' $'a\\" + char.escape + "b'\n"},
			{"unquoted", "printf '<%s>' a" + char.byte + "b\n"},
			{"heredoc", "cat <<EOF\na" + char.byte + "b\nEOF\n"},
			{"tab-heredoc", "cat <<-EOF\n\ta" + char.byte + "b\nEOF\n"},
			{"unquoted-delimiter", "cat <<E" + char.byte + "OF\nbody\nE" + char.byte + "OF\nprintf '%s' kept\n"},
			{"escaped-delimiter", "cat <<E\\" + char.byte + "OF\nbody\nE" + char.byte + "OF\nprintf '%s' kept\n"},
			{"comment", "# a" + char.byte + "b\nprintf '%s' kept\n"},
		} {
			t.Run(char.name+"/"+fixture.position, func(t *testing.T) {
				file := printFixture(t, fixture.source)
				output, kind, message := nativePrint(file)
				if kind != "" || output != fixture.source {
					t.Fatalf("print=%q (%s %s); want %q", output, kind, message, fixture.source)
				}
			})
		}
	}
}

// Physical newline alignment is preserved separately from KeepPadding's known
// escape-marker counting limit, tracked upstream at https://github.com/mvdan/sh/issues/658.
func TestPrinterControlByteLayout(t *testing.T) {
	for _, char := range []struct{ name, byte string }{{"VT", "\v"}, {"FF", "\f"}} {
		t.Run(char.name+"/padding", func(t *testing.T) {
			source := "x='a" + char.byte + "b'    # comment\ny='longword' # another\n"
			first, kind, message := nativePrint(printFixture(t, source), syntax.KeepPadding(true))
			second, _, _ := nativePrint(printFixture(t, first), syntax.KeepPadding(true))
			if first != "x='a"+char.byte+"b'  # comment\ny='longword' # another\n" || second != "x='a"+char.byte+"b' # comment\ny='longword' # another\n" || kind != "" {
				t.Fatalf("first=%q second=%q (%s %s); want upstream KeepPadding limit", first, second, kind, message)
			}
		})
		t.Run(char.name+"/multiline", func(t *testing.T) {
			ordinary := "printf '%s' 'longqfirst\nx' # first\nprintf x # second\n"
			source := strings.Replace(ordinary, "longqfirst", "long"+char.byte+"first", 1)
			reference, _, _ := nativePrint(printFixture(t, ordinary))
			first, kind, message := nativePrint(printFixture(t, source))
			second, _, _ := nativePrint(printFixture(t, first))
			if reference != "printf '%s' 'longqfirst\nx'       # first\nprintf x # second\n" || strings.Replace(first, char.byte, "q", 1) != reference || second != first || kind != "" {
				t.Fatalf("reference=%q first=%q second=%q (%s %s)", reference, first, second, kind, message)
			}
		})
	}
}

// Compatibility includes the base's imperfect HT padding and tab indentation.
func TestPrinterOrdinaryKeepPadding(t *testing.T) {
	for _, fixture := range []struct{ source, expected string }{
		{"if true; then\n  printf '%s' ok\nfi\n", "if true; then\n\tprintf '%s' ok\nfi\n"},
		{"x='a\tb'    # comment\ny='longword' # another\n", "x='a\tb'  # comment\ny='longword' # another\n"},
	} {
		output, kind, message := nativePrint(printFixture(t, fixture.source), syntax.KeepPadding(true))
		if output != fixture.expected || kind != "" {
			t.Errorf("print=%q (%s %s); want baseline %q", output, kind, message, fixture.expected)
		}
	}
}
