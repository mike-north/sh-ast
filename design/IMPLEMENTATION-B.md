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
consumer fix scenario. Each wrote behavioral tests first. Integrated implementation
and review are recorded below, together with canonical consumer receipts and
bounded measurements.

Release B remains provisional until the storage-identity decision and final
canonical/consumer gates are complete. Implemented evidence follows.

## Stacked candidate workflow preparation

The inherited validation workflows only triggered PRs targeting main, which would
skip the independent Linux builder for the required stacked B PR. The bounded
configuration test `design/validation/release-b/stacked-pr-workflows.rb` first
failed all four validation workflows for base `codex/faithful-syntax-release-plan`.
It now passes after removing their PR-base filters. Main-only push triggers and
the publication workflow remain unchanged. Stacked PR 31 triggered the real Linux
builder at run 41392692403, which uploaded artifact 13118106999 before failing the
expected comparison against the preceding Release A binary. Schema CI passed.
The downloaded artifact is now committed. The subsequent Linux comparison run
41392911617 passed on `345dc64`, as did CI 41392911252 and schema run 41392911400.

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

## Canonical candidate

Draft [PR 31](https://github.com/mike-north/sh-ast/pull/31) is based on the
unchanged Release A branch. Commit `345dc64afc31fc2d4a002bba3052a78623501ca5`
adopts the exact independent Linux CI artifact from
[run 41392692403](https://github.com/mike-north/sh-ast/actions/runs/41392692403).
Artifact 13118106999's ZIP SHA-256 is
`3670c5149531c727dfeec679dc2d2e05ef142388df268fd1ccffad658e53c629`.
The verified archive contains only `sh-ast.wasm`; its 4,436,577 bytes hash to
`fd1ee7cd380abac985c4732a0a4e831a671b3907b6af83ba0e0e1c6ffe3ffad4`.
Those bytes match the disposable local test binary exactly, but the committed
bytes came from CI. Uncached build/check and all 653 runtime tests plus tsd passed
after replacement.

The clean candidate package from `345dc64` has SHA-256
`ba0b721a37c5548b9645e9681d06d7adc749a8a5796424f58f73e5a5673a2888`.
Its source diff and untracked inventory are empty. It is byte-identical to the
integrated preliminary tarball; only source provenance changed from a local
binary patch to a committed independent artifact. Package version remains 0.3.1
until the separate staged version operations, so identity is established by hashes,
not the manifest version. The full upstream BSD notice is present in the tarball.

Canonical commit `345dc64` passes [CI](https://github.com/mike-north/sh-ast/actions/runs/41392911252),
[schema reproducibility](https://github.com/mike-north/sh-ast/actions/runs/41392911400),
and [Linux WASM reproducibility](https://github.com/mike-north/sh-ast/actions/runs/41392911617).
Copilot review was requested; its presence gate remains pending. No final Release B
acceptance is claimed while the storage representation decision remains unresolved.

## Consumer fix and bounded performance evidence

The separate consumer B branch validates the exact canonical tarball above. Both
linked and fresh npm-installed plugin importers verify all 98 code-asset hashes.
The final canonical receipt pair and eleven C5/API cases were rerun together
(16 focused cases). The complete configured suite passes 191 plugin tests,
three umbrella tests and two documentation-drift harness cases, with uncached
build and full checks.

The real ESLint whole-File fix edits a separately parsed tree through public Walk,
prints it, applies the replacement, reparses the intended printf argument and
unchanged format, and stabilizes on a second pass. The original lint tree, source
view, snapshot and traversal caches retain their original associations. Additional
Word replacement cases preserve surrounding comments, heredoc, operators and
Unicode/CRLF; an identical quoted argument in an unrelated command is unchanged.

Four retained fixtures were measured in 36 fresh subprocesses and 144 samples.
Walk/print first samples start after parsing; fix first samples start with a cold
parser. Imports are outside the timed interval. Three first and nine warm samples
per fixture/mode supply medians. Representative-50 warm walk/print/fix medians
were 0.309/35.532/232.878 ms; nested-64 were 0.067/6.482/76.120 ms. The test rule
includes its own isolation observation capture, so these are not minimum
production-rule latencies. There is no A printing baseline or latency threshold.

Every Walk sample made zero bridge calls; each print made one; each fix made
exactly five (two source-view parses, two editable parses and one print), with
no per-node bounds operations. All intended edits, fixture markers and stable
second passes were checked. Original raw timing observations retain provisional
source labels and are reused only after proving whole-tarball and all-asset byte
identity with the canonical candidate. An independent read-only reviewer recomputed
all sample counts, medians and operation sequences and checked C5 isolation and
canonical receipt coherence; no actionable finding remained. Receipt probes record
eight operations because they include verification beyond the five timed fix
operations. No timing test was rerun by that review.

The consumer retains a `^0.5.0` dependency floor. Its historical registry lockfile
cannot provide an unpublished candidate. Local exact-artifact override tests do
not establish a passing frozen registry installation; updating that lock remains
a publication-order prerequisite, separate from the storage-model decision.
