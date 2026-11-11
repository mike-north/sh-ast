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

## Typed-nil interface preservation

The exact review fixture is a short ParamExp whose Param.ValueEnd is NewPos(3,1,4)
and whose Index interface holds `(*syntax.Word)(nil)`. The interface is non-nil,
and upstream End panics; replacing it with an ordinary nil interface makes End
return position 1:4. Silently encoding both as null therefore changes behavior.

The first containment candidate rejected typed-nil interfaces. Further analysis
then established that this also removes meaningful upstream operations: the exact
fixture's Pos succeeds (returning an invalid zero position), and a version with a
valid Dollar returns that position even though End panics. Long ParamExp,
terminated Stmt, ForClause, and DblQuoted examples support both Pos and End despite
typed-nil children. The final representation preserves these values instead of
rejecting the entire tree because one operation might fail.

The tag is exactly `{ Type: 'TypedNil', Kind: 'Word' }` for an interface containing
a nil `*syntax.Word`. Kind must identify a registry-known concrete record whose
pointer implements the destination Go interface. The decoder rejects unknown or
incompatible kinds, extra/missing marker fields, and tags in concrete-pointer
slots. Ordinary nil interfaces, concrete pointers and slice elements remain null.
Root values enter through a Go interface too: a typed-nil Node root retains its
concrete pointer type. Auxiliary kinds cannot masquerade as Node roots. The tag
is a transport value, not a synthetic upstream struct or invented node fields.
All reconstruction uses public reflection and the existing concrete type registry.

Tests were written before each production change. The original codec failed five
rejection probes by silently producing null. The tagged-preservation tests then
failed the containment candidate on eight independent bound fixtures, a typed-nil
root, and the position bridge. After tagging, tests compare both successful values
and expected panics against hand-derived upstream outcomes. The exact review
fixture remains distinct from its ordinary-nil variant. Bridge Pos succeeds when
upstream Pos succeeds; End and typed-nil-root dereference panics become InputError,
and another Pos request confirms that the runtime remains usable.

## Parser output evidence and limits

No typed-nil interfaces were observed in 13 focused valid/incomplete/error source
fixtures with RecoverErrors 0, 1 and 3. Source inspection explains the main risky
path: `syntax/parser.go:2663` assigns the pointer returned by followWordTok into
UnaryTest.X. On a missing word, followWordTok (`867-876`) either allocates a real
recovered Word or sets a parser error. getStmt (`2056-2057`) drops the errored
statement before the statement list yields it. WordIter is allocated before it
is returned (`2435-2461`); parameter indices flow through ArithmExpr interfaces
rather than unchecked nil pointer conversions (`1762-1774`). The upstream
RecoverErrors tests (`parser_test.go:2579` onward) cover synthesized missing-token
nodes. This is focused evidence, not proof that every parser path can never
produce a typed-nil interface.

Parser reachability does not decide the supported operation domain. The public
Node Pos/End contract (`syntax/nodes.go:12-21`) describes separate operations;
current upstream methods can successfully inspect caller-constructed records with
typed-nil children. Preserving that capability is why the tag is supported.

## Verification

- Native `go test ./... -count=1` passes for the shim's packages.
- Actual js/wasm test binaries for both `internal/syntaxwire` and
  `internal/syntaxbridge` pass using the pinned Go 1.26.5 `go_js_wasm_exec` runner.
- Edited-tree, tagged dynamic-nil, ordinary-nil preservation, malformed-tag, and
  independent-position-operation tests run in the native and WASM targets. This
  is private codec/bridge evidence; it does not claim a public print API or a
  rebuilt release artifact.
