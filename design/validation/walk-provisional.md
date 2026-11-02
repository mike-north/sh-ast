# Provisional live Walk candidate

This work implements the live TypeScript dispatcher for Release B's proposed
`walk(Node, (Node | null) => boolean): void` surface and a separate
`WalkPanicError` for upstream-equivalent traversal panics. It is a provisional
candidate, **not accepted full mutation or storage fidelity**. Public exports,
API reports, release docs, and consumer acceptance belong to the integration
checkout. No publishing, merge, tag, or release action is part of this change.

## Independent evidence

`packages/sh-ast/shim/cmd/walk-oracle` constructs actual pinned
`mvdan.cc/sh/v3 v3.13.1` nodes and calls `syntax.Walk`. It does not import the
production codec, TypeScript walker, or generated schema. Its hand-derived
protocol checks validate entry, pruning, exit, typed-nil leaf behavior, unsupported
nodes, and deferred-comment ordering. Recorded fixtures are reread and compared
against fresh native observations by `go test ./cmd/walk-oracle`.

The fixtures include broad Bash, Zsh, Bats, and Unicode sources; forced comment
boundaries across grammar examples; live scalar/child/list-field/slot edits;
reentrancy; comment value copies versus original objects; first trailing-comment
selection; deferred callback unwinding and error replacement; nil interfaces,
concrete nil pointers, typed-nil leaves, optional nil fields; auxiliary pointer
replacement/removal; and malformed live boundary failures. Runtime test builders
use schema defaults solely for irrelevant zero-value fields, never expected order
or expected results.

The implementation reads children at their upstream execution points. It neither
precomputes a trace nor performs per-node WASM subtree transfers. Private live
position dependencies cover Stmt.End and CaseItem/ArrayElem.Pos; public nodePos and
nodeEnd remain unchanged. Whole-tree validation is deliberately absent so a
pruned malformed or cyclic descendant is not traversed prematurely. Callbacks'
exceptions retain identity and deferred callbacks execute with try/finally.

## Unresolved representation decision

Ordinary serialized arrays do not capture Go slice headers, capacity, backing
storage, or addresses of Comment value slots. The implementation currently
captures JavaScript array reference and initial length and reads future slots
live. This mechanism is **not a decision that structural edits are prohibited or
that every Go storage behavior is represented**. No new rejection or fallback
policy is approved here.

Runnable native evidence is retained as `storageProbes` in
`test/fixtures/walk-oracle.json`; run the oracle to reproduce it. The companion
`shim/cmd/walk-oracle/js-array-storage.mjs` reproduces the JavaScript differences.

- With identical serialized Args `[a,b]`, appending then replacing Args[1] yields
  `[a,b]` from a Go slice with capacity 2 and `[a,replacement]` with capacity 4.
- Replacing Args[1] then reslicing to length one leaves the active Go range able
  to read `[a,replacement,c]`. Setting JavaScript length to one deletes the later
  slots; neither the current array nor an initial snapshot retains the complete
  required history.
- Replacing an active Go Comment value slot changes the value observed through
  the callback's retained `&slice[i]`: `[before,after]`. Replacing a JavaScript
  array slot preserves the prior callback object: `[before,before]`.

These probes are evidence for the pending human representation decision, not
claims of passing TypeScript parity. The broad policy remains unresolved.

## Verification at candidate creation

- 65 focused runtime tests pass against the independent native fixtures and
  hand-derived protocol expectations.
- Full package runtime suite: 581 tests pass across 27 files.
- Source build/typecheck and focused ESLint pass.
- Walk type tests verify nullable callbacks, synchronous boolean returns, Node
  roots, typed nils, rejection of null roots and async callbacks, and panic type.
- Native oracle tests pass, including freshness of recorded observations and
  storage probes.
- A new negative-index boundary regression first failed because the local panic
  text included a length suffix; after correction it matches native Go's exact
  `runtime error: index out of range [-1]` text.
