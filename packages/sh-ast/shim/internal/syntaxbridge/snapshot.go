// Snapshot transport consumes the syntax writer's ordered occurrence queue only
// after complete encoding succeeds. No tree discovery or bound calls occur in the
// writer; malformed graphs therefore cannot reach recursive upstream methods.
package syntaxbridge

import (
	"eslint-sh-shim/internal/syntaxwire"
	"fmt"
	"mvdan.cc/sh/v3/syntax"
	"strconv"
)

// boundFailures stores only exceptional observations. Its index refers to an
// occurrence, not pointer identity: shared nodes still occupy separate tuples.
type boundFailures struct {
	index    int
	pos, end *string
}

// appendCompactPositionSidecar emits eight numeric slots per occurrence and a
// mandatory sparse error array. Failed bounds use zero quartets; the error row
// distinguishes those placeholders from a successful invalid zero position.
// The caller must have successfully encoded the entire syntax graph first.
func appendCompactPositionSidecar(dst []byte, nodes []syntax.Node) []byte {
	dst = append(dst, `"Positions":[`...)
	var failures []boundFailures
	for index, node := range nodes {
		pos, posError := snapshotPosition(node, syntax.Node.Pos)
		end, endError := snapshotPosition(node, syntax.Node.End)
		if index > 0 {
			dst = append(dst, ',')
		}
		dst = appendCompactBound(dst, pos)
		dst = append(dst, ',')
		dst = appendCompactBound(dst, end)
		if posError != nil || endError != nil {
			failures = append(failures, boundFailures{index, posError, endError})
		}
	}
	dst = append(dst, `],"PositionErrors":[`...)
	for i, failure := range failures {
		if i > 0 {
			dst = append(dst, ',')
		}
		dst = append(dst, '[')
		dst = strconv.AppendInt(dst, int64(failure.index), 10)
		dst = append(dst, ',')
		dst = appendSnapshotError(dst, failure.pos)
		dst = append(dst, ',')
		dst = appendSnapshotError(dst, failure.end)
		dst = append(dst, ']')
	}
	return append(dst, ']')
}

// appendCompactBound preserves every public coordinate and observation flag.
func appendCompactBound(dst []byte, position syntaxwire.Position) []byte {
	flags := 0
	if position.IsValid {
		flags |= 1
	}
	if position.IsRecovered {
		flags |= 2
	}
	if position.OffsetOverflow {
		flags |= 4
	}
	dst = strconv.AppendUint(dst, uint64(position.Offset), 10)
	dst = append(dst, ',')
	dst = strconv.AppendUint(dst, uint64(position.Line), 10)
	dst = append(dst, ',')
	dst = strconv.AppendUint(dst, uint64(position.Col), 10)
	dst = append(dst, ',')
	return strconv.AppendInt(dst, int64(flags), 10)
}

// appendSnapshotError keeps arbitrary failure bytes separate from coordinates.
func appendSnapshotError(dst []byte, failure *string) []byte {
	if failure == nil {
		return append(dst, "null"...)
	}
	return syntaxwire.AppendString(dst, *failure)
}

// snapshotPosition observes each method independently. Panic data never prevents
// the other method from running, and a failed bound retains a zero placeholder.
func snapshotPosition(node syntax.Node, read func(syntax.Node) syntax.Pos) (position syntaxwire.Position, failure *string) {
	defer func() {
		if caught := recover(); caught != nil {
			message := fmt.Sprintf("upstream node position: %v", caught)
			failure = &message
		}
	}()
	return syntaxwire.ObservePosition(read(node)), nil
}
