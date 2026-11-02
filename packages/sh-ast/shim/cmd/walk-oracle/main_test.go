package main

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// Hand-derived protocol checks keep the observer honest about exits and defer order.
func TestNativeWalkProtocol(t *testing.T) {
	for _, test := range []struct {
		spec      specification
		want      []string
		panicText string
	}{
		{specification{Setup: "call", Mode: "prune-root"}, []string{"CallExpr"}, ""},
		{specification{Setup: "typed-nil-Lit"}, []string{"TypedNil:Lit", "nil"}, ""},
		{specification{Setup: "brace"}, []string{"BraceExp"}, "syntax.Walk: unexpected node type *syntax.BraceExp"},
		{specification{Setup: "stmt-comments"}, []string{"Stmt", "Comment:leading", "nil", "CallExpr", "Word", "Lit:cmd", "nil", "nil", "nil", "nil", "Comment:trailing", "nil"}, ""},
	} {
		got := observe(test.spec)
		var labels []string
		for _, event := range got.Events {
			labels = append(labels, eventLabel(event))
		}
		if !reflect.DeepEqual(labels, test.want) || got.Panic != test.panicText {
			t.Errorf("%s/%s: events=%v panic=%q", test.spec.Setup, test.spec.Mode, labels, got.Panic)
		}
	}
}

// Fixture freshness is checked against upstream itself, not any TypeScript code.
func TestRecordedObservationsMatchUpstream(t *testing.T) {
	data, err := os.ReadFile("../../../test/fixtures/walk-oracle.json")
	if err != nil {
		t.Fatal(err)
	}
	var report struct {
		Cases   []observation      `json:"cases"`
		Storage []sliceObservation `json:"storageProbes"`
	}
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatal(err)
	}
	for _, want := range report.Cases {
		got := observe(want.specification)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("recorded %s differs from pinned native Walk; regenerate the oracle fixture", want.ID)
		}
	}
	if !reflect.DeepEqual(storageProbes(), report.Storage) {
		t.Error("recorded slice storage probes differ from native Go")
	}
}
