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
	bounds := observeBounds(nodes)
	var failures []boundFailures
	for index, observed := range bounds {
		if index > 0 {
			dst = append(dst, ',')
		}
		dst = syntaxwire.AppendPositionTuple(dst, observed.pos)
		dst = append(dst, ',')
		dst = syntaxwire.AppendPositionTuple(dst, observed.end)
		if observed.posError != nil || observed.endError != nil {
			failures = append(failures, boundFailures{index, observed.posError, observed.endError})
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

// nodeBounds is one occurrence's pair of independent observations. A failed
// bound keeps its zero Position and records the recovered panic text.
type nodeBounds struct {
	pos, end           syntaxwire.Position
	posError, endError *string
}

// observeBounds calls Pos then End for each occurrence, in queue order, exactly
// once each. Ordinary trees never panic, so calls run under one recovery scope
// instead of one deferred recover per call; after a panic, observation resumes
// with the next call, giving the same results and call sequence as recovering
// each call separately.
func observeBounds(nodes []syntax.Node) []nodeBounds {
	bounds := make([]nodeBounds, len(nodes))
	for call := 0; call < 2*len(nodes); {
		call = observeBoundsFrom(nodes, bounds, call)
	}
	return bounds
}

// observeBoundsFrom performs calls starting at call (2*index for Pos, 2*index+1
// for End) until all are done or one panics. A panic is recorded against the
// failing call, and the returned index is the call after it.
func observeBoundsFrom(nodes []syntax.Node, bounds []nodeBounds, call int) (next int) {
	next = call
	defer func() {
		if caught := recover(); caught != nil {
			message := fmt.Sprintf("upstream node position: %v", caught)
			if next%2 == 0 {
				bounds[next/2].posError = &message
			} else {
				bounds[next/2].endError = &message
			}
			next++
		}
	}()
	for ; next < 2*len(nodes); next++ {
		observed := &bounds[next/2]
		if next%2 == 0 {
			observed.pos = syntaxwire.ObservePosition(nodes[next/2].Pos())
		} else {
			observed.end = syntaxwire.ObservePosition(nodes[next/2].End())
		}
	}
	return next
}

// appendSnapshotError keeps arbitrary failure bytes separate from coordinates.
func appendSnapshotError(dst []byte, failure *string) []byte {
	if failure == nil {
		return append(dst, "null"...)
	}
	return syntaxwire.AppendString(dst, *failure)
}
