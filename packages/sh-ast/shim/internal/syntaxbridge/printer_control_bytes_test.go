// Literal VT and FF belong to shell data, not the printer's tabwriter protocol.
// These native assertions isolate that boundary from the WASM transport.
package syntaxbridge

import "testing"

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
