package syntaxwire

import (
	"bytes"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// The actual writer's token order is compared to the committed JavaScript schema,
// not another generator projection. Native interface membership is independent
// ground truth for whether each record contributes a snapshot occurrence. The
// upstream-source inventory test separately proves that this registry is complete.
func TestEncodedFieldOrderMatchesShippedSchema(t *testing.T) {
	schemaPath, err := filepath.Abs("../../../generated/syntax-schema.js")
	if err != nil {
		t.Fatal(err)
	}
	script := `import {pathToFileURL} from 'node:url';
const {SYNTAX_SCHEMA}=await import(pathToFileURL(process.argv[1]).href);
console.log(JSON.stringify(Object.fromEntries(Object.entries(SYNTAX_SCHEMA).map(([name,record])=>[name,{fields:Object.keys(record.fields),node:record.node}]))));`
	output, err := exec.Command("node", "--input-type=module", "-e", script, schemaPath).CombinedOutput()
	if err != nil {
		t.Fatalf("read shipped schema with repository Node toolchain: %v\n%s", err, output)
	}
	var schema map[string]struct {
		Fields []string `json:"fields"`
		Node   bool     `json:"node"`
	}
	if err := json.Unmarshal(output, &schema); err != nil {
		t.Fatal(err)
	}
	if len(schema) != len(nodeTypes) {
		t.Fatalf("schema has%d records, actual writer has%d", len(schema), len(nodeTypes))
	}
	for name, typ := range nodeTypes {
		t.Run(name, func(t *testing.T) {
			record, exists := schema[name]
			if !exists {
				t.Fatal("writer record absent from shipped schema")
			}
			data, err := Encode(reflect.New(typ).Interface())
			if err != nil {
				t.Fatal(err)
			}
			decoder := json.NewDecoder(bytes.NewReader(data))
			opening, err := decoder.Token()
			if err != nil || opening != json.Delim('{') {
				t.Fatalf("object start: %v %v", opening, err)
			}
			fields := []string{}
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					t.Fatal(err)
				}
				name, ok := key.(string)
				if !ok {
					t.Fatal("nonstring object key")
				}
				var value json.RawMessage
				if err := decoder.Decode(&value); err != nil {
					t.Fatal(err)
				}
				if name != "Type" {
					fields = append(fields, name)
				}
			}
			if !reflect.DeepEqual(fields, record.Fields) {
				t.Fatalf("actual encoded field order%v != shipped schema%v", fields, record.Fields)
			}
			nativeNode := reflect.PointerTo(typ).Implements(reflect.TypeFor[syntax.Node]())
			if nativeNode != record.Node {
				t.Fatalf("native Node=%v, schema Node=%v", nativeNode, record.Node)
			}
		})
	}
}
