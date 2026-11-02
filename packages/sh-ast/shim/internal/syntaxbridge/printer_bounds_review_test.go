package syntaxbridge

import (
	"encoding/json"
	"strconv"
	"testing"

	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

// assertEditedBounds compares each current-tree bridge observation with the
// corresponding native method. The expected offsets also pin the intended edit
// independently of transport encoding and position response implementation.
func assertEditedBounds(t *testing.T, node syntax.Node, wantPos, wantEnd uint) {
	t.Helper()
	encoded, err := syntaxwire.Encode(node)
	if err != nil {
		t.Fatal(err)
	}
	for _, observation := range []struct {
		operation string
		native    syntax.Pos
		want      uint
	}{{"pos", node.Pos(), wantPos}, {"end", node.End(), wantEnd}} {
		if observation.native.Offset() != observation.want {
			t.Fatalf("native %s offset=%d; intended=%d", observation.operation, observation.native.Offset(), observation.want)
		}
		result := response(t, observation.operation, string(encoded), `{}`)
		position, ok := result["Position"].(map[string]any)
		if !ok {
			t.Fatalf("%s response: %#v", observation.operation, result)
		}
		for key, wanted := range map[string]uint{"Offset": observation.native.Offset(), "Line": observation.native.Line(), "Col": observation.native.Col()} {
			actual, ok := position[key].(json.Number)
			if !ok || actual.String() != strconv.FormatUint(uint64(wanted), 10) {
				t.Fatalf("%s %s=%v; native=%d", observation.operation, key, position[key], wanted)
			}
		}
	}
}

// TestPrinterEditedCommentAndReplacedFinalPartBounds covers the Release B
// addendum: text-derived ends and child-derived ends remain live after edits,
// while the printer uses the same current values without replaying source.
func TestPrinterEditedCommentAndReplacedFinalPartBounds(t *testing.T) {
	t.Run("edited-comment", func(t *testing.T) {
		file := printFixture(t, "#old\n")
		comment := &file.Last[0]
		assertEditedBounds(t, comment, 0, 4)
		comment.Text = "new 🎉"
		assertEditedBounds(t, comment, 0, 9)
		if got := comparePrint(t, file, `{}`); got != "#new 🎉\n" {
			t.Fatalf("edited comment print=%q", got)
		}
	})
	t.Run("replaced-word-final-part", func(t *testing.T) {
		file := printFixture(t, "echo pre'old 🎉'\n")
		word := file.Stmts[0].Cmd.(*syntax.CallExpr).Args[1]
		assertEditedBounds(t, word, 5, 18)
		word.Parts[len(word.Parts)-1] = &syntax.SglQuoted{
			Left: syntax.NewPos(40, 3, 7), Right: syntax.NewPos(60, 3, 27), Value: "new 你好",
		}
		assertEditedBounds(t, word, 5, 61)
		if got := comparePrint(t, file, `{}`); got != "echo pre'new 你好'\n" {
			t.Fatalf("replaced final part print=%q", got)
		}
	})
}
