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

## Handoff after acceptance-test integration

Tests/report commit 4ea41e9 was supplied to supervisor and integrated as 0c3f4be.
The printer implementation files compare byte-for-byte between author df8c055
and supervisor e4cfd11. New test lint and isolated inherited-config typecheck pass.
A direct broad `tsc -p test/tsconfig.json` failed because that existing config's
rootDir is test while tests import src, and this checkout had no rolled-up public
artifacts. This is not a new acceptance-test type failure or claimed green gate.

Await supervisor's frozen exports/canonical-WASM revision to rerun the targeted
acceptance tests against its exact asset. Walk implementation/C5 consumer are
separate pending reviews; structural active-array mutation remains unresolved.

## Frozen print surface and cold-first operation

Supervisor froze public print exports at 0e986dd520b736055c00bbd13a4e19fe2ee02415.
Review checkout adds its unchanged public-export commit as f529014. The new
`print-cold-start-review.test.ts` invokes built output in a fresh subprocess,
constructs an empty File without any parse/newPos prewarm, instruments actual
WebAssembly.Module/Instance construction, and observes `"\n"` before a queued
microtask. It then catches PrintError and successfully parses/prints with exactly
one Module and Instance. The queued microtask is observed running afterward, so
the synchronous observation cannot pass merely because the callback never runs.

The cold test and the two bounds tests pass against supplied optimized Linux
WASM SHA-256 fd1ee7cd380abac985c4732a0a4e831a671b3907b6af83ba0e0e1c6ffe3ffad4.
Focused lint and isolated inherited-config type checking pass. The WASM remains
disposable and excluded from review commits.

Independently extracted and exercised the actual preliminary package
`sh-ast-0.3.1.tgz`, SHA-256
62ec250b046543a3e352d7d2e6ef5c61a13916952bfcf5b6a23257c2b1cda9e1.
Its embedded WASM matches the hash above. A fresh subprocess importing its public
entry observes zero initialization at import, cold-first print before microtasks,
one Module/Instance, and healthy parse/print reuse after both ordinary PrintError
and recovered PrintPanicError. This is package behavior evidence for the supplied
preliminary asset, not final canonical CI provenance or release acceptance.

## Walk review in progress

Read current walk author source against pinned native Walk and node methods.
Normal dispatch, nil distinctions, optional-field rereads, copied item comments,
and deferred callbacks agree on inspection. No concrete implementation regression
has been established. Full frozen Walk and integrated C5 review remain pending.

An independent native probe confirms another representation boundary: within a
File.Last Comment callback, replacing the same whole Comment slot immediately
changes the value read through the retained Go callback pointer, whose address
still equals &file.Last[0]. Ordinary JS array-slot object replacement leaves the
retained callback object unchanged. This is value-slot identity loss at constant
array length, in addition to the already unresolved capacity/shrink cases. The
walk author also identified it and is retaining native/JS divergence probes.
It belongs to the explicit human representation decision, not a silently accepted
policy or a claim that arbitrary mutation parity has been achieved.

Read-only execution of the current walk author suites passes 65 TS tests across
two suites and native `go test ./cmd/walk-oracle`. Source remains unfrozen and
representation decision pending; this is provisional evidence only. Read-only C5
consumer inspection found separate editable parsing, exact target selection,
real ESLint printed replacements, syntax meaning/stability checks, and retained
original-view checks. Its use of public walk requires later integrated-package
validation; no C5 pass is inferred from the print-only package.

Current handoff: 4ea41e9 tests/report already integrated; ad4b6c4 cold-print test
and updated report supplied to supervisor. Await frozen Walk and C5 same-byte
linked/installed package evidence before final combined Release B review.

## Confirmed and corrected callback-result boundary

On frozen Walk 6572ca58f55ef5f24d8310b19b7b40c3dc2844bd (integrated as b49c425),
`visit` used callback truthiness for entry and ignored all exit return values.
Runtime JavaScript callbacks returning Promise, undefined, null, 0, 1, text, or
object therefore silently continued/pruned rather than rejecting a result outside
the upstream bool domain. Public TS negative tests did not cover this boundary.

Added `syntax-walk-callback-boundary.test.ts` before implementation changes.
The initial run had 17 failing negative cases and two passing preservation
controls; the local full red log is `scratch/walk-callback-boundary-red.log`.
Entry cases expect InputError before child dispatch. Exit cases cover both the
normal and typed-nil leaf paths. Boolean false exits remain ignored. Callback
exception identity and deferred comment visits during unwind remain intact.

The minimal correction invokes the callback without catching its exception,
checks `typeof result === 'boolean'`, and throws InputError otherwise. Entry and
both exit paths share that boundary. It neither awaits nor coerces a return
value. The public method comment states the synchronous boolean requirement.

After the correction, all 19 boundary cases and all 65 native-oracle/protocol
Walk cases pass (84 total). Focused lint, isolated inherited-config typecheck,
and package build pass. The green log is
`scratch/walk-callback-boundary-green.log`. No storage/array-policy choice is
made by this fix; that consequential fidelity decision remains unresolved.

The supervisor owns integrated public API/doc regeneration and the full package
acceptance run after cherry-picking this narrow correction.
