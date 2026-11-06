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
