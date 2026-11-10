# Release B implementation record

This follow-on implements [B1-B4](RELEASE-PLAN.md#implementation-sequence) and
[B1-B6/C5 acceptance](ACCEPTANCE.md#release-b-owned-by-sh-ast). Release A's
[accepted candidate evidence](IMPLEMENTATION.md) remains a separate record.
The implementation scope originally stopped before publication, release tags,
and merges. The subsequent authorized release execution is recorded in
[the release execution record](validation/release-execution.md); historical
candidate observations below retain their original boundaries and dates.

## Exact separation and release order

This section records the initial preparation of Release B on top of Release A. See the release execution
record for the current integration baseline and publication state.

- Producer integration starts at Release A head
  `290f15841e36a17e7e11a4a818992d5d203dd122`, on a dedicated
  Release B branch in a new worktree.
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

The maintainer authorized routine API choices within the accepted fidelity goal.
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

The maintainer accepted ordinary arrays with explicit traversal-mutation limits.
Finalized producer contract checks pass against that boundary. The original
implementation evidence is retained below, followed by the final package and
consumer receipt records.

## Candidate workflow preparation for a branch-based base

The inherited validation workflows only triggered PRs targeting main, which would
skip the independent Linux builder for the Release B PR, whose base was the
Release A branch. A bounded configuration check first failed all four validation
workflows for that base; it passed after the PR-base filters were removed. Main-only push triggers and
the publication workflow remain unchanged. PR 31 triggered the real Linux
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
  [Walk validation evidence](validation/walk-provisional.md).
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

## Accepted representation and finalization

The maintainer explicitly selected **"Keep ordinary arrays with explicit traversal-mutation
limits (Recommended)."** The [Walk mutation decision](WALK-MUTATION-DECISION.md)
is accepted. Shape-valid field/child edits, live future-slot replacement, pruning,
synchronous callbacks, captured-array traversal and actual edited-tree printing
remain supported. No Go capacity, shared backing-store, reslicing or value-slot
address model will be added. Destructive active-array mutations remain outside
the supported contract; the implementation adds no detector or rejection policy.

The finalization audit found no traversal runtime change necessary. Public
comments, generated docs, README and the staged minor note now state the accepted
boundary. Thirteen new tests cover live future slots, append/extent behavior,
owner-array replacement, reordering/revisits, list-entry timing, stored Comment
identity, copied comments and error message documentation/preservation.

Copilot reviewed both drafts: the consumer had no actionable issue; the producer
identified missing generated documentation for WalkPanicError.Message. Two
generated-documentation regressions failed before the repair. A dedicated
documented readonly field plus a lowercase constructor parameter now produces
the intended property/class descriptions and API report, while preserving exact
message reference/bytes, display text, code and name. The review thread was
answered and resolved after independent verification.

Independent review at `4c69b7d` found no remaining actionable issue in the
final source, contract tests, decision, README or regenerated API/docs. It also
confirmed that existing traversal executable code is unchanged. No Go or WASM
change was required. The [review history](validation/release-b/independent-review.md)
records this final inspection separately from earlier provisional reviews.

## Canonical Linux binary and preceding package

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
The package above is historical pre-finalization evidence. The finalized package
below supersedes it; its Go/WASM bytes and canonical provenance remain unchanged.

## Finalized package and producer checks

Clean source `4c69b7dfed64f9cfc1964ea04ede16f82ba6e6e5` produced tarball SHA-256
`9c7d46ad9bd5906616bd4a8bd6da6ce82d06362ae931a013c2d49ba6592a6116`.
Its source diff is empty (SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`),
and its untracked source inventory is empty. The tarball retains 98 code assets.
Nine code/declaration/map assets plus README changed from the preceding package:
Walk comments and the documented error field/constructor account for those
changes. They require new exact-package consumer receipts. Package version stays
0.3.1 until the staged version operations; hashes identify this candidate.

Uncached build/check, all 666 runtime tests across 34 files, tsd and regenerated
API/docs pass. [CI 41409668259](https://github.com/mike-north/sh-ast/actions/runs/41409668259),
[schema 41409668284](https://github.com/mike-north/sh-ast/actions/runs/41409668284),
[WASM 41409668265](https://github.com/mike-north/sh-ast/actions/runs/41409668265),
and [Copilot presence 41409668286](https://github.com/mike-north/sh-ast/actions/runs/41409668286)
pass on `4c69b7d`. The presence check confirms an existing completed review; a
refreshed Copilot review was also requested after the final source push. There is
no remaining open thread from the earlier review.

## Pre-finalization consumer and bounded performance evidence

The preceding consumer B validation exercised tarball `ba0b721a...`. Both
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
a publication-order prerequisite. The storage-model decision is now accepted.

## Final consumer receipts and candidate closeout

The finalized consumer is [PR 105](https://github.com/mike-north/eslint-sh/pull/105)
at `b2a9440d8bb8a13c9165428ae101a90ef04a27da`. Both linked and fresh npm-installed
plugin importers verify all 98 assets of producer source `4c69b7d`, tarball
`9c7d46ad9bd5906616bd4a8bd6da6ce82d06362ae931a013c2d49ba6592a6116`.
The producer's later closeout record commits change no packaged files.

Fresh consumer validation passes uncached build/check, 191 plugin tests, three
umbrella tests, two documentation harness cases, and a focused 16-case run of
C5, linked/installed receipts and tutorial cases. The first lint is synchronous
and performs one parse-with-positions operation. Whole-File editing/printing/fixing
reparses the intended argument meaning, preserves original view/cache/snapshot
associations, and reaches a stable second pass. The complete model-visible
[observations](https://github.com/mike-north/eslint-sh/blob/b2a9440d8bb8a13c9165428ae101a90ef04a27da/work-records/release-b/candidate-observations.json),
[receipt](https://github.com/mike-north/eslint-sh/blob/b2a9440d8bb8a13c9165428ae101a90ef04a27da/work-records/release-b/candidate-receipt.json),
and [provenance](https://github.com/mike-north/eslint-sh/blob/b2a9440d8bb8a13c9165428ae101a90ef04a27da/work-records/release-b/candidate-provenance.json)
identify the exact package.

The consumer reran all four performance fixtures in 36 fresh processes and 144
timed samples against the new bytes. Representative-50 warm walk/print/fix medians
were 0.395/36.360/238.178 ms; nested-64 were 0.067/6.625/84.408 ms. Each Walk sample
made zero bridge calls, print one, and timed fix five; receipt probes include
three additional verification operations. All intended edits, fixture markers and
stable-pass assertions held. Cold/warm boundaries and test-rule overhead remain
explicit in the [final performance report](https://github.com/mike-north/eslint-sh/blob/b2a9440d8bb8a13c9165428ae101a90ef04a27da/work-records/release-b/performance/REPORT.md).
Historical measurements remain unchanged and are not relabeled as the final run.
No complexity or latency guarantee follows from these bounded observations.

An independent read-only audit verified the full 98-asset inventory, both importer
receipts, exact ten packed-file differences, unchanged consumer runtime hashes,
and historical evidence. It recomputed all 36-process/144-sample medians and
operation sequences and checked the accepted mutation boundary in consumer docs.
No actionable finding remained. No runtime test or benchmark was rerun by that
auditor.

The candidate is finalized under the accepted ordinary-array contract. Remaining
external release prerequisites are separate: A 0.4 must publish and consume its
changesets before B's staged minor note is activated and B is retargeted to the
actual release baseline; expected B remains 0.5, never 1.0. Consumer frozen install
fails because its manifest requires ^0.5.0 while the historical lock specifies
^0.3.0. A refreshed registry query at 2026-11-02T07:59:54Z again returned E404 for
sh-ast@0.5.0. The main-only consumer PR filter is not the sole CI obstacle, so no
green remote consumer CI is claimed. After publication, regenerate the real lock
and rerun normal frozen-install CI. No release automation was expanded to bypass
these prerequisites.

Release A producer `290f158` and consumer `84a85e6` remain separate and unchanged.
Both B PRs remain drafts; no merge, tag or publication was performed. Fresh Copilot
reviews were requested after the final source pushes; the earlier producer issue
is fixed/resolved and the earlier consumer review had no actionable issue.
