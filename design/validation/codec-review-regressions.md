# Codec review regressions

## Edited-tree printing

`TestEditedTreeRoundTripMatchesNativePrintingAndMeaning` closes a validation gap:
the earlier private printer check covered unchanged trees only. This new test
passes the existing codec; it is not evidence of a production defect or a
failed-before fix.

The fixture starts as a Unicode comment followed by
`echo old && echo 你好`. After decoding, the test changes `old` to the longer
`new🎉` literal and `AndStmt` to `OrStmt`, encodes the edited tree again, and
reconstructs it before private upstream printing. An independently parsed native
Go tree receives the same intended edits without passing through the codec.
Both outputs must equal the hand-specified `echo new🎉 || echo 你好` source with
the original emoji/combining-character comment intact. Reparse assertions check
the OR operator, both commands and arguments, and retained comment. The unchanged
original must print differently, and editing the reconstructed tree must leave
that original intact. No public printer API is introduced.

## Typed-nil interface rejection

The exact review fixture is a short ParamExp whose Param.ValueEnd is NewPos(3,1,4)
and whose Index interface holds `(*syntax.Word)(nil)`. The interface is non-nil,
and upstream End panics; replacing it with an ordinary nil interface makes End
return position 1:4. Silently encoding both as null therefore changes behavior.

Tests were added before changing production code. All five typed-nil fixtures
failed by producing null without an error: arithmetic, command, loop and test
interface fields, plus a WordPart interface slice element. Separate ordinary-nil
roundtrips passed before the fix.

The encoder now rejects a nil dynamic pointer encountered inside an interface,
with an explicit `typed-nil interface` error and no partial encoded result.
Ordinary nil interfaces, nil concrete pointers and slice elements remain valid.
The codec's scope is parser-returned and publicly representable tree records;
Go-only dynamic typed-nil interface fields/elements are unsupported, rather than
silently coerced into a different public value. No private Go representation,
unsafe operation, or upstream fork is used.

## Verification

- Native `go test ./... -count=1` passes for the shim's packages.
- Actual js/wasm test binaries for both `internal/syntaxwire` and
  `internal/syntaxbridge` pass using the pinned Go 1.26.5 `go_js_wasm_exec` runner.
- The edited-tree, typed-nil rejection and ordinary-nil preservation tests all run
  in the native and WASM targets. This is private codec/bridge evidence; it does
  not claim a public print API or a rebuilt release artifact.
