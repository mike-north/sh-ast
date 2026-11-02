package syntaxbridge

import (
	"encoding/json"
	"eslint-sh-shim/internal/syntaxwire"
	"mvdan.cc/sh/v3/syntax"
)

// positionSnapshot is an observation of one Node occurrence in the original
// parsed tree. Paths use exported Go field names and slice indices from File.
// Bounds and errors are separate metadata, never stored back into syntax records;
// later caller edits do not change these observations or make them live bounds.
type positionSnapshot struct {
	// Path identifies an occurrence, so shared pointers can have distinct entries.
	Path []any
	// Pos and End contain copied public coordinates, or null when that method panics.
	Pos *syntaxwire.Position
	End *syntaxwire.Position
	// Each error retains its own method's failure without hiding the other bound.
	PosError any
	EndError any
}

// positionSnapshots decodes streamed bytes only for existing observation assertions.
// Production retains no boxed path or snapshot representation tree.
func positionSnapshots(root syntax.Node) []positionSnapshot {
	var result []positionSnapshot
	if err := json.Unmarshal(appendPositionSnapshots(nil, root), &result); err != nil {
		panic(err)
	}
	return result
}
