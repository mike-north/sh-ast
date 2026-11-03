package syntaxbridge

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// These fixtures compare the internal operation with both its unchanged parse
// counterpart and an independently parsed native tree. Upstream Walk supplies
// the Node occurrence inventory; it does not supply snapshot traversal paths.
func TestParsePositionSnapshotMatchesUpstreamNodesAndBounds(t *testing.T) {
	fixtures := []struct {
		name, source, options string
		parserOptions         []syntax.ParserOption
	}{
		{"unicode-comments-auxiliary", "# keep 🎉 e\u0301\necho ${a:-你好} \"e\u0301\"\n", `{"KeepComments":true}`, []syntax.ParserOption{syntax.KeepComments(true)}},
		{"empty", "", `{}`, nil},
		{"whitespace", " \n\t", `{}`, nil},
		{"comment-only", "# only 🎉\n", `{"KeepComments":true}`, []syntax.ParserOption{syntax.KeepComments(true)}},
		{"comments-disabled", "# omitted\necho hi\n", `{}`, nil},
		{"recovery", "(foo |", `{"RecoverErrors":2}`, []syntax.ParserOption{syntax.RecoverErrors(2)}},
		{"replacement-slice", "echo ${a/foo/你好} ${a:1:2}", `{}`, nil},
		{"stop-at", "echo hi STOP echo ignored", `{"StopAt":"STOP"}`, []syntax.ParserOption{syntax.StopAt("STOP")}},
	}
	for _, fixture := range fixtures {
		t.Run(fixture.name, func(t *testing.T) {
			plain := response(t, "parse", fixture.source, fixture.options)
			observed := response(t, "parse-with-positions", fixture.source, fixture.options)
			if plain["Error"] != nil || observed["Error"] != nil {
				t.Fatalf("successful fixture unexpectedly failed: parse=%#v observed=%#v", plain["Error"], observed["Error"])
			}
			if !reflect.DeepEqual(plain["File"], observed["File"]) {
				t.Fatal("requesting position metadata changed the faithful File")
			}
			file, err := syntax.NewParser(fixture.parserOptions...).Parse(strings.NewReader(fixture.source), "")
			if err != nil {
				t.Fatal(err)
			}
			remaining := make(map[syntax.Node]int)
			syntax.Walk(file, func(node syntax.Node) bool {
				if node != nil {
					remaining[node]++
				}
				return true
			})
			nodes, paths := nativeOccurrences(file)
			data, err := json.Marshal(observed)
			if err != nil {
				t.Fatal(err)
			}
			entries := decodeCompactSnapshots(data, paths)
			seenPaths := make(map[string]bool)
			for i, entry := range entries {
				pathJSON, _ := json.Marshal(entry.Path)
				seenPaths[string(pathJSON)] = true
				node := nodes[i]
				// Walk copies comments, so native value equality is the oracle.
				matched := false
				for candidate, count := range remaining {
					if count > 0 && reflect.DeepEqual(candidate, node) {
						remaining[candidate]--
						matched = true
						break
					}
				}
				if !matched {
					t.Fatalf("%s has no upstream Walk occurrence", pathJSON)
				}
				if entry.PosError != nil || entry.EndError != nil {
					t.Fatalf("unexpected failure: %#v", entry)
				}
				checkSnapshotPosition(t, entry.Pos, node.Pos())
				checkSnapshotPosition(t, entry.End, node.End())
			}
			for node, count := range remaining {
				if count != 0 {
					t.Errorf("missing %d occurrences of %T", count, node)
				}
			}
			if !seenPaths["[]"] {
				t.Fatal("File root needs its own empty path")
			}
			if fixture.name == "unicode-comments-auxiliary" {
				for _, path := range []string{`["Stmts",0,"Comments",0]`, `["Stmts",0,"Cmd","Args",1,"Parts",0,"Exp","Word"]`} {
					if !seenPaths[path] {
						t.Errorf("missing independently specified path %s", path)
					}
				}
				for _, path := range []string{`["Stmts",0,"Position"]`, `["Stmts",0,"Cmd","Args",1,"Parts",0,"Exp"]`} {
					if seenPaths[path] {
						t.Errorf("token position or auxiliary record must not appear as Node: %s", path)
					}
				}
			}
		})
	}
}

// Parser failures keep their original partial File and structured error. No
// metadata operation may substitute its own failure for the parser's result.
func TestParsePositionSnapshotPreservesErrorsWithoutCollecting(t *testing.T) {
	for _, fixture := range []struct{ source, options string }{
		{"echo ok; (", `{}`},
		{"a=(1)", fmt.Sprintf(`{"Variant":%d}`, syntax.LangPOSIX)},
		{"echo hi", `{"StopAt":"TOO-LONG"}`},
		{"echo hi", `{"Unknown":true}`},
	} {
		plain := response(t, "parse", fixture.source, fixture.options)
		observed := response(t, "parse-with-positions", fixture.source, fixture.options)
		if plain["Error"] == nil {
			t.Fatal("fixture must fail before metadata collection")
		}
		if !reflect.DeepEqual(plain, observed) {
			t.Fatalf("parser failure changed: parse=%#v snapshot=%#v", plain, observed)
		}
		if _, present := observed["Positions"]; present {
			t.Fatal("failed parse must not collect snapshots")
		}
	}
}

// Expected coordinates come from direct public upstream getters. The overflow
// observation uses the public ordering relation, not the bridge's position codec.
func checkSnapshotPosition(t *testing.T, raw any, position syntax.Pos) {
	t.Helper()
	maximum := syntax.NewPos(^uint(0), 1, 1)
	wanted := map[string]any{
		"Offset":         json.Number(fmt.Sprint(position.Offset())),
		"Line":           json.Number(fmt.Sprint(position.Line())),
		"Col":            json.Number(fmt.Sprint(position.Col())),
		"IsValid":        position.IsValid(),
		"IsRecovered":    position.IsRecovered(),
		"OffsetOverflow": !position.IsValid() && position.Offset() == 0 && !maximum.After(position),
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	var actual any
	decoder := json.NewDecoder(strings.NewReader(string(encoded)))
	decoder.UseNumber()
	if err := decoder.Decode(&actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, wanted) {
		t.Fatalf("snapshot position=%#v; native=%#v", raw, wanted)
	}
}

// Observation failures belong to individual requested bounds. Even a typed-nil
// child cannot erase its parent's successful Pos or other nodes' observations.
func TestSnapshotCollectsIndependentBoundFailures(t *testing.T) {
	root := &syntax.ParamExp{
		Dollar: syntax.NewPos(7, 2, 3), Short: true,
		Param: &syntax.Lit{ValuePos: syntax.NewPos(8, 2, 4), ValueEnd: syntax.NewPos(10, 2, 6)},
		Index: (*syntax.Word)(nil),
	}
	entries := positionSnapshots(root)
	if len(entries) != 3 {
		t.Fatalf("want parent, Param, typed-nil Index; got %d", len(entries))
	}
	parent := entries[0]
	if parent.Pos == nil || parent.Pos.Offset != 7 || parent.PosError != nil || parent.End != nil || parent.EndError == nil {
		t.Fatalf("parent bounds must preserve success separately from failure: %#v", parent)
	}
	var indexFound bool
	for _, entry := range entries {
		if reflect.DeepEqual(entry.Path, []any{"Index"}) {
			indexFound = true
			if entry.Pos != nil || entry.End != nil || entry.PosError == nil || entry.EndError == nil {
				t.Fatalf("typed-nil methods must both retain their observed errors: %#v", entry)
			}
		}
	}
	if !indexFound {
		t.Fatal("typed-nil interface occurrence was silently omitted")
	}
	if root.Pos() != syntax.NewPos(7, 2, 3) || root.Index == nil {
		t.Fatal("snapshot collection mutated the source tree")
	}
	// The reverse direction matters too: a missing left child cannot hide the
	// independently available end of the right statement.
	endOnly := positionSnapshots(&syntax.BinaryCmd{Y: &syntax.Stmt{Position: syntax.NewPos(9, 1, 10)}})[0]
	if endOnly.Pos != nil || endOnly.PosError == nil || endOnly.End == nil || endOnly.End.Offset != 9 || endOnly.EndError != nil {
		t.Fatalf("failed Pos hid a successful End: %#v", endOnly)
	}
}

// Metadata owns its coordinate values and occurrence paths. It does not become a
// live view after tree edits, and shared children still have separate paths.
func TestSnapshotValuesAreDetachedAndPathsPreserveOccurrences(t *testing.T) {
	comment := &syntax.Comment{Hash: syntax.NewPos(0, 1, 1), Text: "a"}
	entries := positionSnapshots(comment)
	comment.Hash = syntax.NewPos(10, 2, 3)
	comment.Text = "🎉"
	if entries[0].Pos.Offset != 0 || entries[0].End.Offset != 2 || comment.End().Offset() != 15 {
		t.Fatal("parse-time coordinates became a live view of edited node state")
	}
	shared := &syntax.Stmt{Position: syntax.NewPos(0, 1, 1)}
	binary := &syntax.BinaryCmd{X: shared, Y: shared}
	occurrences := positionSnapshots(binary)
	if len(occurrences) != 3 || !reflect.DeepEqual(occurrences[1].Path, []any{"X"}) || !reflect.DeepEqual(occurrences[2].Path, []any{"Y"}) {
		t.Fatalf("shared node occurrences were merged or path storage was reused: %#v", occurrences)
	}
}
