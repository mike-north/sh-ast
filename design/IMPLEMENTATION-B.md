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

No public Release B operation has been accepted as implemented by this record.

## Stacked candidate workflow preparation

The inherited validation workflows only triggered PRs targeting main, which would
skip the independent Linux builder for the required stacked B PR. The bounded
configuration test `design/validation/release-b/stacked-pr-workflows.rb` first
failed all four validation workflows for base `codex/faithful-syntax-release-plan`.
It now passes after removing their PR-base filters. Main-only push triggers and
the publication workflow remain unchanged. A real stacked PR run must still
confirm the event and canonical artifact; the configuration test is not that proof.
