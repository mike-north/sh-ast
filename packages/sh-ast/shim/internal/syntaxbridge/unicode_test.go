// Unicode parser regressions specify complete commands and literal source data
// independently of the upstream lexer, including reads split inside UTF-8 runes.
package syntaxbridge

import (
	"bytes"
	"io"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// chunkReader forces lexical refill boundaries without changing source bytes.
// The parser may read ahead, so bytes delivered are not proof of consumption.
type chunkReader struct {
	source *strings.Reader
	size   int
}

func (r chunkReader) Read(p []byte) (int, error) {
	if len(p) > r.size {
		p = p[:r.size]
	}
	return r.source.Read(p)
}

func TestUnicodeRunesRemainSourceAcrossReaderBoundaries(t *testing.T) {
	for _, variant := range []syntax.LangVariant{syntax.LangBash, syntax.LangPOSIX, syntax.LangMirBSDKorn, syntax.LangBats, syntax.LangZsh} {
		for _, size := range []int{1, 2, 3, 7, 1024, 32768} {
			for _, word := range []string{"\u0080b", "a\u0080b", "\u0081b", "a\u0081b", "🎉\u0080é\u0081"} {
				source := "echo " + word + "\neval \"$x\"\n"
				file, err := syntax.NewParser(syntax.Variant(variant)).Parse(chunkReader{strings.NewReader(source), size}, "unicode.sh")
				if err != nil {
					t.Fatalf("variant=%s chunk=%d word=%q: %v", variant, size, word, err)
				}
				if len(file.Stmts) != 2 {
					t.Fatalf("variant=%s chunk=%d word=%q: got %d statements, want 2", variant, size, word, len(file.Stmts))
				}
				call, ok := file.Stmts[0].Cmd.(*syntax.CallExpr)
				if !ok {
					t.Fatal("first statement is not a command")
				}
				if len(call.Args) != 2 || call.Args[1].Lit() != word {
					t.Fatalf("variant=%s chunk=%d: command word lost source %q", variant, size, word)
				}
			}
		}
	}
}

func TestQuotedUnicodeHeredocAcrossReaderBoundaries(t *testing.T) {
	for _, body := range []string{"abc\u0080def\n", strings.Repeat("a", 1010) + "\u0080def\n", strings.Repeat("\u0080\u0081\n", 1000)} {
		source := "cat <<'EOF'\n" + body + "EOF\necho done\n"
		for _, size := range []int{1, 2, 3, 7, 1024, 32768} {
			file, err := syntax.NewParser().Parse(chunkReader{strings.NewReader(source), size}, "heredoc.sh")
			if err != nil {
				t.Fatalf("chunk=%d body bytes=%d: %v", size, len(body), err)
			}
			if len(file.Stmts) != 2 {
				t.Fatalf("chunk=%d body bytes=%d: got %d statements", size, len(body), len(file.Stmts))
			}
			if got := file.Stmts[0].Redirs[0].Hdoc.Lit(); got != body {
				t.Fatalf("chunk=%d: heredoc data changed", size)
			}
		}
	}
}

func TestInvalidUTF8AfterUnicodeReportsOriginalBytePosition(t *testing.T) {
	prefix := []byte("echo 🎉\u0080ok\r\necho ")
	source := append(append([]byte(nil), prefix...), 0xff, '\n')
	_, err := syntax.NewParser().Parse(bytes.NewReader(source), "bytes.sh")
	parseErr, ok := err.(syntax.ParseError)
	if !ok {
		t.Fatalf("expected structured UTF-8 parse error, got %T %v", err, err)
	}
	if parseErr.Filename != "bytes.sh" || parseErr.Pos.Offset() != uint(len(prefix)) || parseErr.Pos.Line() != 2 || parseErr.Pos.Col() != 6 {
		t.Fatalf("unexpected byte error: %#v", parseErr)
	}
}

// A reader that delivers its entire input with EOF demonstrates why read-ahead
// completion cannot certify that the parser represented every command.
type eofWithDataReader struct{ data []byte }

func (r *eofWithDataReader) Read(p []byte) (int, error) {
	n := copy(p, r.data)
	r.data = r.data[n:]
	if len(r.data) == 0 {
		return n, io.EOF
	}
	return n, nil
}
func TestUnicodeDoesNotStopAtReaderEOF(t *testing.T) {
	file, err := syntax.NewParser().Parse(&eofWithDataReader{[]byte("echo a\u0080b\necho done\n")}, "read-ahead.sh")
	if err != nil {
		t.Fatal(err)
	}
	if len(file.Stmts) != 2 {
		t.Fatalf("reader reached EOF, but parser returned only %d statements", len(file.Stmts))
	}
}
