# Release B independent review checkpoint

Active assignment from supervisor: review Release B only. Release A producer
290f158 and consumer 84a85e6 remain intact. No publication, tag, merge, Claude,
or modifications to author implementation worktrees are authorized here.

Review integration: /Users/mnorth/.codex/worktrees/faithful-syntax-release-b/sh-ast.
Printer author: /Users/mnorth/.codex/worktrees/faithful-print-b/sh-ast.
At checkpoint start, integration HEAD is 1d52a4c; printer is uncommitted on A.
Frozen printer revision and integrated revision are still awaited.

Scope: all eight printer options, uint64 Indent, actual edited-tree printing,
29 supported and 14 unsupported roots, ordinary error/panic/input/bridge error
separation, GoString bytes/native tabwriter behavior, File newline behavior,
Minify/SingleLine precedence, resource-cost documentation and existing guards.
Later integrated Walk/C5 review is pending. Walk active-array structural mutation
semantics remain a consequential unresolved human decision; see
../../WALK-MUTATION-DECISION.md. Do not assert full Go mutation parity.

Current evidence: read Print API implementation and errors; no finding yet.
Need read Go bridge, native/TS tests and independent bounded probes, then frozen
integration review. Root exports/docs/API are supervisor-owned and omissions in
printer author worktree are not preintegration findings.

## Current printer slice review

Read-only source review of printer author commit df8c055 found no concrete
implementation defect. Independently reran its native Printer tests and 50 TS
printer tests before the author restored its disposable WASM asset; both passed.
Reviewed the pinned mvdan/sh v3.13.1 native Print and option setter implementations:
all eight options, root categories, option-conflict precedence, and recovered panic
boundary agree with the bridge. Existing runtime ownership/depth guards are not
changed by this slice. Documentation states output amplification and tree-size
cost without inventing an Indent bound or promising arbitrary writer behavior.

The acceptance addendum lacked a combined current-tree bounds/printing test for
edited Comment and replaced Word final part. Supervisor requested independent
native/TS acceptance tests, added in this review checkout. Direct native Go cases
pass: edited comment ends at byte 9; replacing the last Word part with a quote
whose Right is byte 60 makes Word.End byte 61, preserving Word.Pos byte 5 and
printing the edited emoji/CJK text. This was a coverage gap, not a behavior bug.

Review checkout currently contains the df8c055 printer source cherry-pick as
local a090016 atop integration 1d52a4c. Do not ask root to cherry-pick a090016:
root integrates printer separately. Only the later tests/report commit is for
integration. Final frozen integration and Walk/C5 review remain pending.

The two new TS tests pass against a disposable darwin-built WASM SHA-256
65f18169c2ce6636d21e215dcd2fd98bfd75c4603b6f07d0c90c1202ea03bbf0.
This binary is excluded from the tests/report commit and is not canonical Linux
reproducibility evidence. All 52 printer TS cases, native `go test ./...`, and
`go vet ./...` pass in this review checkout. Frozen integration source was supplied
as e4cfd11 (unchanged cherry-pick of df8c055); exports/API integration is pending.
