package syntaxbridge

import (
	"encoding/json"
	"strings"
	"testing"
)

// Resource failures must leave the encoding and snapshot stages no partial tree
// to expose, even when grammar recovery was requested by the caller.
func TestParseBudgetErrorOnlyEnvelope(t *testing.T) {
	source := "echo $(( " + strings.Repeat("a[", 200) + "1" + strings.Repeat("]", 200) + " ))"
	for _, operation := range []string{"parse", "parse-with-positions"} {
		for _, options := range []string{`{}`, `{"RecoverErrors":100000,"KeepComments":true}`} {
			for i := 0; i < 3; i++ {
				result := response(t, operation, source, options)
				failure, ok := result["Error"].(map[string]any)
				if len(result) != 1 || !ok {
					t.Fatalf("resource response must contain only Error; keys=%v", resultKeys(result))
				}
				if failure["Kind"] != "ParseDepthError" || failure["MaxDepth"] != json.Number("128") || failure["Depth"] != json.Number("129") {
					t.Fatalf("unexpected resource error: %#v", failure)
				}
				if _, ok := failure["Message"].(string); !ok {
					t.Fatal("resource error lacks its message")
				}
				if later := response(t, operation, "echo alive", options); later["Error"] != nil || later["File"] == nil {
					t.Fatal("resource refusal changed subsequent parser behavior")
				}
			}
		}
	}
}

// Only field names are needed when reporting a failed no-partial-result assertion.
func resultKeys(result map[string]any) []string {
	keys := make([]string, 0, len(result))
	for key := range result {
		keys = append(keys, key)
	}
	return keys
}
