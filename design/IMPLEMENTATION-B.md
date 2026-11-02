# Release B implementation record

This follow-on implements [B1-B4](RELEASE-PLAN.md#implementation-sequence) and
[B1-B5/C5 acceptance](ACCEPTANCE.md#release-b-owned-by-sh-ast). Release A's
[accepted candidate evidence](IMPLEMENTATION.md) remains a separate record.
Publication, release tags, and merges are not authorized by this assignment.

## Exact separation and release order

- Producer integration starts at Release A head
  `290f15841e36a17e7e11a4a818992d5d203dd122`, branch
  `codex/faithful-syntax-release-b`, in a new managed worktree.
- Consumer integration starts at Release A head
  `84a85e6efdd236165879104a4e52fb68377f7381` in a separate worktree.
- Release A PRs 30 and 104 remain unchanged. Follow-on draft PRs target their
  corresponding Release A branches so reviewers see only the B changes.
- Registry history was refreshed on 2026-11-01: sh-ast latest remains 0.3.1.
  Release A targets 0.4.0; B targets the following minor, expected 0.5.0.
- B's release note is staged outside `.changeset` until A has been published and
  its changeset consumed. Two minor changesets in one version operation would
  collapse both features into one minor. See the staged release procedure in
  [RELEASE-PLAN.md](RELEASE-PLAN.md#staged-release-preparation).

## Delegated implementation choices

The supervisor authorized routine API choices within the accepted fidelity goal.
The initial contracts below are implementation targets, not completion claims.

- `walk(node, callback)` is synchronous. Callback entries and nil exits follow
  pinned upstream Walk, including pruning, actual callback-driven mutation,
  deferred comment callbacks, and reentrancy. A precomputed event trace cannot
  substitute for the live traversal protocol.
- Callback identity follows upstream semantics: the specialized Stmt, CaseItem,
  and ArrayElem comment loops visit value copies, while ordinary comment-slice
  traversal addresses original elements. Tests must expose that distinction.
- `printSync(node, options)` reconstructs the actual current tree and collects a
  fresh upstream printer's output. `GoString` preserves text or exact bytes.
  This is a collection convenience; arbitrary io.Writer behavior, writer errors,
  partial writes and reusable Printer state are outside its contract.
- All eight pinned options are represented. Indent follows the WASM target's
  uint64 domain through safe numbers or bigint. Upstream returned printer errors
  and recovered panics are distinct from binding input and transport errors.
- Consumer fixes edit a separate tree. The original lint tree, source snapshot,
  and cached traversal remain associated with the original source.

## Work and evidence

Independent workstreams own traversal, the printing bridge, and the isolated
consumer fix scenario. Each writes behavioral tests first. Integrated review,
canonical Linux WASM verification, all Release A gates, linked and installed exact
candidate receipts, and bounded traversal/print/fix measurements remain pending.

Release B remains provisional until the storage-identity decision and final
canonical/consumer gates are complete. Implemented evidence follows.

## Stacked candidate workflow preparation

The inherited validation workflows only triggered PRs targeting main, which would
skip the independent Linux builder for the required stacked B PR. The bounded
configuration test `design/validation/release-b/stacked-pr-workflows.rb` first
failed all four validation workflows for base `codex/faithful-syntax-release-plan`.
It now passes after removing their PR-base filters. Main-only push triggers and
the publication workflow remain unchanged. A real stacked PR run must still
confirm the event and canonical artifact; the configuration test is not that proof.

## Integrated implementation and review

- Print source `df8c055` is integrated as `e4cfd11` and publicly exported in
  `0e986dd`. All eight options, actual edited-tree reconstruction, 29 supported
  and 14 unsupported root families, exact emitted bytes and distinct ordinary
  errors/panics are covered. See [printing evidence](validation/release-b/printing.md).
- Independent review found no printer defect. Commits `0c3f4be` and `e7665b1`
  add paired comment/Word-part edit bounds/print tests and a fresh-process
  print-first test with one WASM module/instance and healthy error recovery.
- Provisional Walk source `6572ca5` is integrated as `b49c425`, with public
  contracts in `6d77fa9`. A native Go oracle supplies traces and storage
  counterexamples. Sixty-five protocol cases cover live reads, pruning, nils,
  comment copies, deferred exceptions, reentrancy and position boundaries. See
  [provisional Walk evidence](validation/walk-provisional.md).
- Independent review reproduced a callback-result constraint bug: 17 negative
  cases accepted nonboolean values through truthiness or ignored them on exit.
  `3350c18` now throws InputError for those values without awaiting/coercion or
  catching the callback's exceptions. All 19 new boundary/preservation tests and
  the 65 existing Walk cases pass. Boolean exit values remain ignored.
- The integrated local build passes 653 runtime tests, full tsd, uncached
  build/check, native Go tests/vet and generator tests. Regeneration has no schema
  drift. The manual storage probe and compiled BSD notice are intentional
  non-runtime entry files excluded narrowly from unused-file checks; the full
  upstream notice is retained in the built package.

## Outstanding decision and artifact gates

The [Walk mutation decision](WALK-MUTATION-DECISION.md) is still unresolved. It
includes capacity-dependent append, reslicing, and replacement of a Comment value
slot observed through a retained callback pointer. The parent chat owns the human
question. Neither the ordinary-array recommendation nor passing ordinary-field
edit tests is acceptance of complete Go storage fidelity.

The current Linux optimized WASM is disposable local evidence, SHA-256
`fd1ee7cd380abac985c4732a0a4e831a671b3907b6af83ba0e0e1c6ffe3ffad4`.
It is not yet a canonical CI artifact. The initial print-only package passed
both linked and installed actual-ESLint printing diagnostics (six cases in each),
with exact asset checks and original-view isolation. Final public-Walk C5,
matching linked/installed integrated receipts, bounded performance measurements,
and canonical CI verification remain pending. No final Release B acceptance is
claimed.
