# Optimization delivery work record

User-approved sequence: correctness #38/#39, then #35 streaming wire encoding and
the in-place decoder portion of #37. #36 requires a separate evidence/design
approval; #40/#41 are follow-ons, #42 is held for semantic design, #43 is lower
priority. Root retains acceptance and merge authority. Implementers stop at PR-open.

## Ownership and baseline

- Lead checkout: `/Users/mnorth/.codex/worktrees/optimization-delivery/sh-ast`,
  branch `codex/in-place-wire-decode`, based on `origin/main` `3fecd43`.
- #38: `brace-correctness` managed worktree/branch; specialist owns changes.
- #39: `/Users/mnorth/.codex/worktrees/wrapper-assignments/sh-ast`, branch
  `codex/wrapper-assignment-operands`; specialist owns changes. PR #44 at
  `68d4ebfb91c818ca2797d9eb5ba2a1805a5a12bf` passed all exact-head gates and was
  accepted/merged by root as `11697ff10d20fe5936762b558ea14156fe9facf2`.
  Issue #39 is closed with acceptance evidence; no release publication implied.
- Main checkout's pre-existing `tools/gen-visitor-keys/go.sum` edit is untouched.
- GitHub CLI authentication returned HTTP 401. Connector equivalent ground-truth
  reads showed #38/#39/#37 open, unassigned, without prior claims/comments, and
  no open repository PRs. Remote branch inventory had no competing issue branches.
  Claims and intent comments were then written via the connector.

## Decoder slice (#37, partial)

- Two identity-retention tests failed against the copying decoder before editing.
- In-place decoder preserves ordinary JSON records/arrays, replaces only byte tags,
  uses own data-property definitions for record replacements, and retains strict
  canonical-base64 validation. No boundary validation or snapshot logic removed.
- Sixteen new outcomes cover record/array identities, nested bytes, own `__proto__`
  keys/prototype stability, invalid base64/JSON, independent Unicode fixtures,
  and real canonical-WASM parse/snapshot/error envelopes against the retired
  copying decoder. Combined wire suites: 23 initial tests; full suite: 682 tests.
- Initial full gates ran Node 24.14.0 / pnpm 11.12.0: build, check, tests, 27
  benchmark harness/integration tests pass. The nodenv pnpm shim overrode the
  attempted PATH-only Node 22 selection. Explicit NODENV_VERSION=22.22.1 rerun
  with NX_SKIP_NX_CACHE=true passed build/check/test (682 runtime tests, tsd,
  27 benchmark tests). API/docs regenerated without cache; no public changes.
- Node24 measurement: M2 parse 64.35 to 51.60 ms; parse plus snapshot 103.56 to
  94.49 ms (median of five process medians). Snapshot ranges overlap slightly;
  no exact guaranteed gain or combined-ticket 20 ms target claim. Evidence is in
  `in-place-wire-decode/`. Canonical WASM unchanged; all 5,801 M2 node observations
  and File values match published 0.5.0. Snapshot path-key optimization remains
  deferred, and this slice does not complete #37.
- Independent wrapper specialist review found no actionable runtime defect;
  separately reran all 16 decoder outcomes on Node22.22.1. Reviewer verified
  only `dist/syntax-wire.js` differs among executable assets, canonical WASM
  matches, all 80 raw timing records match the report, and verification operation
  counts match each pair. Requested reproduction recipe and M2 equivalence
  command were added to the retained README.
- Copilot's one low finding (duplicate Object.keys enumeration) is corrected by
  reusing the key list. Independent re-review found no semantic change; all
  local gates passed again. Final-source targeted M2 evidence lives under
  `in-place-wire-decode/final-cache/`: parse 67.74 to 61.99 ms; snapshot 127.21
  to 106.01 ms. Process ranges overlap and baseline drift is substantial; this
  does not establish a guaranteed gain or isolated key-cache benefit.

## Remaining delivery state

#38 remains draft PR #46 until corrected-source canonical Linux WASM adoption and
full artifact verification. Independent review caught adjacent-Lit and quote-boundary
escape uncertainty; the conservative unsupported guard is approved after 58
focused outcomes independently passed. No grammar repair was added. Initial
local benchmark timings predate this guard and are not final candidate evidence.

#35, #36, #40 and #41 have not started implementation. #35 remains approved after
the initial slices; #36 still needs a separate root gate, #40/#41 are follow-ons.
#42 remains held and #43 remains lower priority. Live exact-head operational state
is retained in the lead worktree's `scratch/DELIVERY-STATE.md`.

## Correctness decisions

- #38 must inspect actual upstream-produced `BraceExp`, not `SplitBraces`' bool:
  malformed literals can return true with no expansion. Pinned upstream's escaped
  brace handling diverges from executable Bash. Root approved conservative
  `unsupported` for escape-uncertain candidates, not an upstream grammar rewrite.
  Static results require existing quote semantics or a proven necessary-condition
  filter. Agent must record upstream/Bash evidence and AC deviation before coding.
- #39 explicit assignment-scanning grammar presets preserve legacy custom boolean
  semantics. GNU/BSD empty-name divergence yields a precise unresolved reason.
  Required evidence includes `--`, first-assignment boundaries, resumed sudo
  options, slash/equal prefixes, and Unicode operands.

## Optimization sequencing

#35 can retain the wire protocol while eliminating intermediate map trees and
snapshot path allocation. Its differential oracle must compare entire response
bytes, including snapshot entry order, not just decoded values. Existing snapshot
traversal follows Go field declaration order, while syntax encoding sorts keys;
fusing snapshot collection into sorted encoding belongs to #36 unless byte order
is independently preserved. #37's decoder is independent and can be reviewed in
parallel; benchmark it separately so gains are not attributed to a combined patch.

#36 trades path correlation for occurrence order, so it needs an explicit producer
and schema order contract, typed-nil/comment occurrence handling, strict malformed
sidecar rejection, and independent live upstream bound equivalence. It is not
approved for implementation yet.
