package syntaxwire

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// The binding's precise integer transport is based on the actual Go target,
// including js/wasm; wasm32 linear-memory addresses do not imply 32-bit Go ints.
func TestTargetIntegerWidth(t *testing.T) {
	if strconv.IntSize != 64 || uint64(^uint(0)) != ^uint64(0) {
		t.Fatalf("binding requires 64-bit Go int/uint, got int=%d", strconv.IntSize)
	}
	t.Logf("Go int=%d, uint maximum=%d", strconv.IntSize, uint64(^uint(0)))
}

// These tests establish the upstream behaviors the wire representation must
// preserve. They intentionally use public syntax APIs, independently of a codec.
func TestRecoveredPositionCanBeCopiedThroughPublicAPI(t *testing.T) {
	file, err := syntax.NewParser(syntax.RecoverErrors(2)).Parse(strings.NewReader("(foo |"), "")
	if err != nil {
		t.Fatal(err)
	}
	subshell := file.Stmts[0].Cmd.(*syntax.Subshell)
	position := subshell.Rparen
	if !position.IsRecovered() || position.IsValid() || position.Offset() != 0 || position.Line() != 0 || position.Col() != 0 {
		t.Fatalf("unexpected recovered position: %#v", position)
	}
	copy := syntax.Subshell{Rparen: position}
	if copy.Rparen != position || !copy.End().IsRecovered() {
		t.Fatal("copying a recovered position must preserve both its identity and derived End behavior")
	}
	if syntax.NewPos(position.Offset(), position.Line(), position.Col()).IsRecovered() {
		t.Fatal("coordinate-only reconstruction must not be mistaken for a recovered position")
	}
}

func TestInvalidPositionCanRetainAnOffset(t *testing.T) {
	position := syntax.NewPos(7, 0, 0)
	if position.IsValid() || position.IsRecovered() || position.Offset() != 7 {
		t.Fatalf("invalid position lost its observable offset: %#v", position)
	}
}

func TestInvalidSourceBytesProduceAnUpstreamParseError(t *testing.T) {
	file, err := syntax.NewParser().Parse(bytes.NewReader([]byte{'e', 'c', 'h', 'o', ' ', 0xff}), "bytes.sh")
	parseError, ok := err.(syntax.ParseError)
	if !ok || parseError.Text != "invalid UTF-8 encoding" {
		t.Fatalf("expected upstream UTF-8 parse failure, got %T: %v", err, err)
	}
	if file == nil || file.Name != "bytes.sh" {
		t.Fatal("parse failure must retain the upstream partial File")
	}
}

func TestJSONStringsCannotTransportArbitraryGoStringBytes(t *testing.T) {
	value := string([]byte{'x', 0xff})
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded string
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded == value {
		t.Fatal("the fixture must demonstrate why arbitrary Go strings need explicit byte transport")
	}
}

// Derived positions clamp source offsets and drop columns that no longer fit.
// They retain their line and remain valid instead of wrapping into a sentinel.
func TestDerivedPositionClampsOffsetAndColumn(t *testing.T) {
	maximum := syntax.NewPos(^uint(0), 1, 1)
	clamped := (&syntax.Comment{Hash: syntax.NewPos(maximum.Offset(), 262143, 16382), Text: "x"}).End()
	if clamped.Offset() != maximum.Offset() || clamped.Line() != 262143 || clamped.Col() != 0 || !clamped.IsValid() || clamped.IsRecovered() {
		t.Fatalf("derived position did not clamp: %#v", clamped)
	}
}
