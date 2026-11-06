# Syntax package responsibility cleanup

Worktree: `/Users/mnorth/.codex/worktrees/remove-analysis/sh-ast`  
Branch: `refactor/remove-analysis`  
Starting revision: `43390d3fc048e6a1c524d34579182c0010df99dc`

This implements accepted architecture D9-D11 and realignment task 2. Analysis has
the independent selected home `mike-north/sh-analysis`; this record does not claim
that package is published. The syntax package removes its analysis entry point,
implementation, errors, reports and current usage documentation without aliases.

Outcome tests are written before implementation in `package-boundary.test.ts`
and `package-boundary.test-d.ts`. They exercise a packed installation, reject the
former subpath, reject analysis root exports, preserve synchronous first use and
syntax operations, and reject dependencies toward consumer layers.

The binding migration owner controls the shim, faithful public `splitBraces`,
selected fork pin and canonical Linux WASM. Cleanup must preserve those changes
and stack on their source commit. Existing interpretation-focused `analyze-*` tests are analysis-owned;
pure syntax tests using their fixture helper retain a renamed syntax helper.
Operator-domain runtime/type tests are preserved under syntax filenames and
import the root directly, including uint8 option-state and uint32 family checks.
Mixed structured-clone coverage retains syntax observations and retires only its
analysis-specific case. Zsh syntax regression coverage must survive and follow
the selected fork's tested syntax contract rather than compatibility expectations.

Validation and exact source/build provenance will be appended after execution.

## Before cleanup

On the starting revision, Node 22.22.1 / pnpm 11.12.0 package build and both API
reports passed. The installed-tarball boundary file produced exactly three
expected failures: importing `sh-ast/analyze` resolved, the root still exported
`ShAnalyzeMaxDepthError`, and the export map still contained `./analyze`. The
synchronous syntax-operation case passed. The focused tsd file failed twice,
showing both analysis error names were present in the root type namespace.

Commands: `pnpm --filter sh-ast build`, `pnpm --filter sh-ast check:api-report`,
`pnpm --filter sh-ast exec vitest run test/package-boundary.test.ts --maxWorkers=2`,
and `pnpm --filter sh-ast exec tsd --files test-d/package-boundary.test-d.ts`.

The artifact-exclusion test also failed before cleaning build outputs: a package
packed after source removal still carried stale `dist/analyze` from the preceding
build. `pnpm --filter sh-ast clean` is required before the fresh build so removed
source cannot survive into the installed artifact.

## Source candidate validation

Rebased cleanup onto binding source commit `43db64d` (`fork-build-migration`).
The conflict resolution preserved public `splitBraces`, its identity guarantees,
README documentation, and the selected-fork/opaque-Zsh syntax tests. Only the
analysis observer adapter was removed. The selected Go dependency and canonical
Linux WASM remain owned by the binding migration; its source-only commit still
contains the preceding canonical binary, so this is not final runtime evidence
for the new fork or split operation.

After `pnpm run clean`, the uncached build, API report regeneration and uncached
docs regeneration passed. `pnpm check` passed (two existing forgotten-export
warnings in `syntax-snapshot.ts`, no errors). Eight focused Vitest files passed
98 tests with two workers: package boundary, structured clone, operator exports,
option-state exports, syntax walk bounds/oracle/mutation, and upstream array
expansion. All tsd tests passed, including the new absent-analysis type checks.

The installed artifact has one root export and no analysis runtime/declaration
artifacts. A fresh consumer process exercised first-use parse before a queued
microtask, multibyte bounds, walk, printing, and retained error inheritance. The
former analysis import failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`; namespace
probes found neither analysis error nor interpretation operations. API report
and generated docs were inspected to confirm analysis declarations were absent.

Generated documentation changes are kept in their own commit because removal
of the retired analysis documentation exceeds the automated review file limit.
Final full-suite and exact canonical artifact validation are pending.

The packed-candidate contract additionally invokes public `splitBraces` with the
hand-derived `{a,b}` result (true and a two-element BraceExp). Before canonical
artifact inheritance, it fails with `InputError: unknown syntax operation
"split-braces"`, proving that source-only exports cannot satisfy the installed
runtime gate. The type boundary probe imports `sh-ast` itself so it verifies the
published declaration rollup rather than the source entry point.

## Canonical runtime and full local gates

Cleanup source head `76b2dac71080fe53db8c312cdafa84af50451b77` inherits canonical
artifact commit `21195218aeea9343988ef6f365921bb49c25b682`. WASM SHA-256 is
`57c46bac7d59913a585a6bd3b7d7e489fa310bd044f13cc2ca1ee012e270ba94`, matching
the Linux artifact from hosted run 42165152448, built from binding source
`43db64d` and selected Go fork `bbc7c4ace575d5de375726fdaa2a5c001c46564c`.
No Darwin-built WASM was committed or used for this candidate.

On Node 22.22.1 / pnpm 11.12.0, uncached `pnpm build`, `pnpm check`, and
`env -u NO_COLOR pnpm test` passed with `NX_PARALLEL=2` and
`VITEST_MAX_WORKERS=2`. This includes 39 benchmark unit tests, four benchmark
integration tests, all 56 Vitest files / 884 tests, and all tsd tests. All six
installed-tarball boundary cases passed, including the previously failing
SplitBraces runtime case.

The independent analysis owner received local prospective tarball
`/tmp/sh-ast-cleanup-76b2dac-x1rmk2ag/sh-ast-0.11.0.tgz` and sibling `receipt.json`.
Tarball SHA-256: `0fb24b570aa5fc6fa8d1d6c9957640485c0f04db3731c7359c05860b9b41637d`.
Only a temporary extracted manifest version changed from source 0.10.0 to
prospective 0.11.0; every non-manifest asset was compared byte-identical after
repacking. Repository version metadata and release PRs were untouched. A fresh
consumer installation of that prospective artifact passed synchronous multibyte
parse/print, public SplitBraces, absent analysis errors/operations, and rejection
of the former analysis subpath. This is a local candidate, not a publication.
