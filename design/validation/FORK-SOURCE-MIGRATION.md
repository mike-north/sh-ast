# Fork-source migration work record

## Scope and authority

The accepted 2026-11-05 four-layer direction puts all changes to the underlying
Go syntax library in a maintained Go fork. This binding consumes one immutable
revision for both schema and WASM; it does not apply a semantic patch stack.
This work handles dependency/build routing and inventory for later analysis
extraction. Analysis extraction into `sh-analysis` and removal from this package proceed as
separate follow-on changes; this PR supplies the faithful syntax operation they need.

## Tests-first evidence

- New source-identity refusal tests were written before the verifier, initially
  failing with missing `verify-go-source.mjs`, then passing 12 cases on Node 22.22.1.
- Cache-integrity expectations then failed twice: no `go mod verify` invocations
  were observed, and altered-cache failure was incorrectly accepted. Adding Go's
  verification for both consumers made all 13 unit cases pass.
- Generator provenance tests failed to compile before `syntaxSourceIdentity`
  existed, then passed. Expected values are explicit module identities, including
  a fork replacement under the same original upstream release requirement.
- The real isolated-cache test initially caught a false acceptance even after
  `go mod verify`: Go verifies original build-list module paths rather than the
  remote replacement source path. The standard `golang.org/x/mod/sumdb/dirhash`
  helper now hashes the actual selected replacement archive and expanded source.
  All 14 source-identity tests pass, including real copied-cache tampering with
  unchanged origin/zip metadata. Shared module caches were not modified.
- Selected-Go Zsh expectations failed against the former patch stack (wildcard
  refusal, hidden substitutions, and recursive work on opaque text), then the
  native bridge tests passed against the published fork. Public TypeScript
  expectations also failed against the previous binary, then passed against the
  canonical Linux artifact recorded below.

## Selected source

Public fork: `github.com/mike-north/sh`, branch `shast/syntax-v3.14.1`, immutable
revision `bbc7c4ace575d5de375726fdaa2a5c001c46564c`. Go resolved this through its
normal proxy/checksum path as
`github.com/mike-north/sh/v3@v3.14.2-0.20261106043227-bbc7c4ace575`, checksum
`h1:dm2hfQDs8359vB9QziwgnoY/Nsp02ut9jUY0HibSPBc=`; the reported full Origin.Hash
matches the committed pin. Both effective consumer graphs and their current
module caches pass source verification. The original module path remains
`mvdan.cc/sh/v3`; the remote replacement selects the fork source.

The old in-repository source closure, semantic patch files, patch manifests, and
reverse-patch verifier are removed. Fork correctness evidence and delta upkeep
now live in the Go repository. Canonical Linux binary receipt and final head
checks will be recorded after they exist. No locally built Darwin WASM is
accepted as release evidence.

The historical baseline is upstream v3.14.1 at
`a3f0c75d21d918756fa38de8b5d3429efde7948b`, documented in the fork's
[maintenance record](https://github.com/mike-north/sh/blob/bbc7c4ace575d5de375726fdaa2a5c001c46564c/FORK-MAINTENANCE.md).
Machine identity retains only `upstream.version`, the required original module
label checked against both effective module graphs. That label does not prove
Git ancestry. The immutable fork revision, origin and content checks identify
consumed bytes; the historical baseline audit is separate evidence.

## Analysis extraction inventory

Current public syntax APIs already supply faithful records/constants,
`SYNTAX_SCHEMA`, `SYNTAX_INTERFACES`, and `nodePos`. Those replace analysis imports
of generated internals and `../syntax.js` without adding binding responsibilities.
`nodeArray`, literal/ANSI-C decoders, context traversal, wrapper/interpreter
models, deep-freezing analysis tables, and analysis failures belong with the
independent analysis package. Syntax-root analysis error exports and the existing
`sh-ast/analyze` entry point are removal work for that extraction, not forwarding
aliases to preserve here.

The actual private bridge dependency was
`src/analyze/brace-observation.ts` -> private `encodeWire`/`decodeWire` and
`callSyntax('word-braces', ...)`. That classification operation discarded Go's
rewritten Word and boolean. It is removed in favor of the selected public
synchronous `splitBraces(word: Word): boolean` syntax operation. Existing analysis
uses it on an isolated copy while extraction proceeds; the independent package
can consume it entirely through the root public API.

The selected mutation contract retains the Word root. False retains its Parts
array and all child identities. True follows Go's Parts replacement while a
narrow native input-occurrence observation restores original WordPart objects
that Go actually reused, including within new brace elements. This is not a
general Go pointer/storage emulation. New split Literals retain copied upstream
position values. Native tests compare exact booleans and transformed records,
including malformed/singleton true results with no BraceExp, plus independent
pointer-reuse observations, byte strings, nil parts, and operation failures.
TypeScript tests pin alias/snapshot meaning and synchronous cold first use.

The analysis package owns inspecting resulting BraceExp records, escape
uncertainty, dialect assumptions, and known/unknown/unsupported meaning. The
binding exposes no analysis-specific `hasBraces` service.

The selected Go fork is intended to retain v3.14.1's raw Zsh reverse-subscript
patterns, dropping the former compatibility patch. Text such as `$(printf foo)`
can therefore be inside an opaque literal rather than a CmdSubst/CallExpr node.
A syntax-node inventory cannot infer that no nested command executes. The future
analysis contract must report the resulting uncertainty or explicitly limit its
claim to represented syntax nodes; changing parser output to satisfy inventory
completeness is outside its ownership.

## Canonical Linux candidate

WASM source build: GitHub Actions WASM reproducibility run `42165152448`, source
head `43db64d48e97eeab654aa40f72785cc1e51f922d`, Ubuntu/Linux amd64, Go 1.26.10,
Binaryen version_131. Exact fork verification, native Go tests, rebuild, and
artifact upload passed. The initial final comparison failed as intended because
the previous committed binary was stale. The downloaded hosted artifact is
SHA-256 `57c46bac7d59913a585a6bd3b7d7e489fa310bd044f13cc2ca1ee012e270ba94`.
No Darwin-built binary was used.

The first public run of the canonical binary passed 23/24 focused cases. The one
remaining test incorrectly asked upstream Walk to traverse newly created
BraceExp, which the selected Go walker intentionally rejects. The test now
inspects faithful records directly; traversal is not changed to conceal that
upstream constraint. Public operation documentation names the same limitation.

All 24 focused public API/cold-start/selected-Zsh cases passed against that exact
hosted binary. Final-head hosted WASM and schema reproducibility passed at
`21195218aeea9343988ef6f365921bb49c25b682`. Hosted CI run `42165548739` exposed
an isolated test-fixture cleanup error after its modified-source refusal had
already succeeded: Linux's read-only expanded module directories caused ordinary
recursive deletion to fail. The fixture now invokes the selected Go toolchain's
`go clean -modcache` with `GOMODCACHE` set only to its temporary copied cache.
Production source checks are unchanged; all 14 provenance tests pass locally.
The following hosted revision must prove Linux cleanup succeeds as well.

Final local uncached validation on the canonical binary passed `pnpm check` and
`pnpm test` with Node 22.22.1, pnpm 11.12.0, Nx parallelism 2, and Vitest maximum
workers 2. The test gate includes 39 benchmark unit cases, four real-worker
integrations, all 66 runtime files / 1,549 tests, and all public type tests. The
only two old assertions changed during this cycle were analysis-owned printer
spellings from the removed compatibility hold; independent native printer tests
now state those selected-Go byte outcomes. No printer behavior was changed to
preserve the old expectations.

## SplitBraces stack-boundary correction

Root's isolated public probe found that a shallow raw Word containing 1,000 nested
brace spellings parsed successfully, while recursive JavaScript validation of the
valid Go result threw an untyped RangeError. Tests were written first for that
exact source, 2,000 levels, byte-bearing results, and a constructed deep input.
They failed with raw RangeErrors on normal Node 22.22.1 and 24.14.0 stacks.
Scoped JavaScript stage guards retain the original engine error as `cause` and
leave native error-family dispatch and unrelated RangeErrors unchanged.

The 2,000-level case also exposed a native transport stack trap. Catch-only
adaptation was rejected: an eight-iteration Node 22 probe succeeded, but separate
Node 24 runs spun or corrupted Go GC state after three apparently reusable
refusals. The owned hung child was terminated; no shared process was killed.
This evidence does not support claiming a caught VM trap leaves the runtime healthy.

The approved prevention is an operation-local, iterative Go-shim preflight after
exact `syntax.SplitBraces`, before retained-path construction and recursive
encoding. It limits nested Go struct records to 256, including position values;
arrays and pointer/interface wrappers add no units. This conservative empirical
transport policy is distinct from syntax validity and native parser work. The
input remains unchanged because the transformed result is still private. The
preflight uses container cursors and memory proportional to bounded depth, without
brace scanning, AST visitation rules, or a general codec rewrite.

Native tests first failed because the valid deep result was returned instead of
a bridge refusal, then passed with explicit 1,000/2,000-level refusals and ordinary
1/20/100-level controls. Child probes require eight repeated 2,000-level refusals
interleaved with parse, position snapshots, live bounds, printing, and a later
SplitBraces call on Node 22/24. The canonical binary recorded earlier predates
this shim correction; a fresh hosted Linux artifact is required before final
public regression and composition acceptance. The underlying Go fork pin and
schema source remain unchanged.

The replacement hosted Linux build is run `42171105574`, source
`16df152092d610435e779e47d08b0acdf400cc8c`. Its exact downloaded WASM SHA-256 is
`50f0e4434fba8255bf60f74cfe5f6f550defb75352e31523102c01aca54001c7`.
The native tests, provenance check, build and upload passed; comparison with the
previous committed binary failed as expected. The candidate now commits these
hosted bytes. Later input protection changes only TypeScript, leaving native
source and this artifact unchanged.

Independent warmed-input probing then found a second transport path: a caller-built
1,600-level Word/BraceExp chain can pass optimized JavaScript validation and trap
inside the recursive native decoder. A cold-only stack-exhaustion test had not
covered that path. Tests were added first for the exact record-budget fencepost,
cold and warmed deep inputs, aliases revisited through deeper paths, shared byte
values and cycles. An operation-local iterative input preflight now applies the
same 256-record budget before recursive validation, encoding, WASM initialization
or native entry. Generated Go field metadata defines traversal; position values
count, container wrappers do not. Only active ancestors detect cycles, so a shared
subgraph cannot evade the budget through an earlier shallower visit. Cycles retain
InputError, while excess represented depth is ShInternalError without a fabricated
engine cause.

The six new input tests failed before the preflight and passed afterwards.
Independent instrumentation on Node 22.22.1 and 24.14.0 proved that cold 1,600-level
refusal performs zero module compilations, instances or native calls; 40 warmed
refusals add no native calls. Exact 256-record inputs are accepted, 257-record
inputs and deeper alias paths are refused, and cyclic inputs retain InputError.
All slots and identities remain unchanged on refusal. Repeated successful parse,
position, print and split operations reuse the same one WASM module and instance;
no reset or reinitialization is used to simulate recovery.

Final local uncached build/check/test and regenerated API documentation pass on
Node 22.22.1 with pnpm 11.12.0, Nx parallelism 2 and Vitest maximum workers 2:
69 runtime files / 1,567 tests, public type tests, 39 benchmark unit cases and four
real-worker integrations. The independent reviewer also reran the exact 96-case
warm-up sequence followed by eight 1,600-level input refusals and 42 deep output
refusals on both Node 22.22.1 and 24.14.0. Hosted final-head reproducibility and
code review remain separate gates; these local results do not establish them.

## Substantive review follow-up

The exact-head Lite review at `a375be2d32b7b5cb8c3ab385ec3306aadb56e466`
identified an unchecked original module requirement and a historical link into
the deleted vendor tree. Tests written before the fix reproduced false acceptance
for original-version drift in each consumer and recorded-version drift while the
fork replacement remained identical. Real isolated Go module graphs reproduced
all three cases independently of the synthetic runner. Retained metadata now has
an explicit version-only shape; the unverified upstream ancestry revision was
removed from machine identity and preserved in the historical prose above.
The historical validation README now links the immutable fork maintenance record
and this migration record.

The tests-first run reported 10 failures / 13 passes, counting the enclosing real
integration test and its three failed subtests. After comparing each original
module version and validating the retained metadata, all 23 source tests pass.
The same real integration fixture still proves modified-cache refusal. These
changes affect build verification and documentation only; runtime TypeScript,
generated schema, native Go and canonical WASM bytes remain unchanged.

The follow-up passes the full uncached Node 22.22.1 build/check/test gates,
including the same 1,567 runtime tests, public type tests, 39 benchmark unit cases
and four integrations. Independently built and packed packages from `a375be2`
and the corrected source have the same 111 members. All 109 shipped runtime,
schema and WASM assets are byte-identical; the package manifest is identical and
only the shipped README changes. The WASM SHA-256 remains
`50f0e4434fba8255bf60f74cfe5f6f550defb75352e31523102c01aca54001c7`.

## Fixed checksum identity follow-up

The substantive Lite re-review of `8f5311169e1225dc26d6b0e9d0f8abbca1e47ae9`
identified that matching Go reports and actual source hashes still lacked a
separate expected checksum. A real tests-first fixture changed only an isolated
copied cache and temporary consumer files: append to parser source, regenerate
its module archive using Go's canonical ZIP writer, update `.ziphash` and both
consumer `go.sum` entries. The original gate accepted the resulting coherent
altered source even though the reported full Git revision remained unchanged.
Existing single-file tamper refusal was useful but did not establish that
independent expected identity.

The repository identity now pins source and module-metadata `h1` checksums.
These are review-owned values, not regenerated from the consumer reports being
checked. Two independent downloads used empty temporary module caches outside
repository module graphs, explicit `proxy.golang.org` and `sum.golang.org`, and
no checksum exclusions. Both reported the same exact fork revision and hashes:

- Source: `h1:dm2hfQDs8359vB9QziwgnoY/Nsp02ut9jUY0HibSPBc=`.
- `go.mod`: `h1:syYCoFET8w9tvevxiXUtY8/ICrU+l26jHmhJDra3Vwo=`.

Both consumer replacement reports and the download report must match those pins.
The standard Go `dirhash` checker hashes actual archive, expanded source and
cached `.mod` bytes against them. A test holds baseline metadata fixed while
changing only the copied `.mod` file, proving the file check independently of
Go's own preceding checksum checks. Synthetic tests also cover malformed or
noncanonical pins and coherent false source/metadata reports. All 41 focused
tests pass, preserving the original-version, origin and cache-tamper checks.

This is a source-identity consistency anchor against coupled cache/`go.sum`
drift, not protection against arbitrary repository compromise or proof of Git
ancestry. The fork, parser/runtime Go, generated schema and WASM are unchanged;
the Go checker and fixture changes belong only to build verification.

Full uncached Node 22.22.1 build/check/test and generator Go tests pass after
this correction: 1,567 runtime tests, public type tests, 39 benchmark unit cases
and four integrations. Real before/after package archives built from `8f53111`
and the correction contain the same 111 members. All 109 runtime/schema/WASM
assets and the manifest are byte-identical; only the shipped README differs.
The canonical Linux WASM SHA-256 remains
`50f0e4434fba8255bf60f74cfe5f6f550defb75352e31523102c01aca54001c7`.

The retired `sh-ast/analyze` implementation is removed by PR #94 before the
combined 0.11 release. The separate `sh-analysis` package explicitly documents
typed operational/resource failures as distinct from completed semantic
`unsupported` results. This follow-up does not add compatibility handling or
swallow failures in the retired core analysis implementation.
