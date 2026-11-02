# Fidelity assessment

Assessment date: 2026-11-01, America/Los_Angeles. Findings below are observations,
not newly accepted API requirements. The target is in
[Architecture](ARCHITECTURE.md#accepted-direction).

## Declared baseline and provenance

| Source                                                         | Verified state                                                                                                                    | Standing                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Original `/Users/mnorth/Development/sh-ast`                    | Branch `main`, HEAD `96d2a326cba9a3e826f76f1c76b6bf5cdcd070c5`, package `0.1.0`                                                   | Intended implementation baseline requested by the supervisor                                      |
| Original uncommitted state                                     | Only `tools/gen-visitor-keys/go.sum`: 13 additional dependency `/go.mod` checksum lines; no changed requirements in go.mod        | Inspected, not overwritten or copied into the planning change                                     |
| Planning worktree `/Users/mnorth/.codex/worktrees/e1eb/sh-ast` | Initially extraction `7472d5b` (`0.0.0`); safely switched, before writing documents, to `96d2a32`                                 | All relative source references below use the corrected baseline                                   |
| Local remote-tracking ref `origin/main`                        | `7a70a12`, package `0.3.0`                                                                                                        | Newer code comparison only; not the planning baseline                                             |
| Live remote `refs/heads/main` and peeled `sh-ast@0.3.1` tag    | `7bdc6b14899898518e1dbecc01830b2f5f05a893`; GitHub manifest read reports `0.3.1`                                                  | Read with `git ls-remote` and the GitHub connector; no registry publication claim                 |
| Consumer `/Users/mnorth/Development/eslint-sh`                 | HEAD `7412616a48428137e16bfe8c61c64be50a7c01fb`; plugin and umbrella `0.3.0`; sh-ast dependency/lock/installed resolution `0.3.0` | Read-only consumer assessment; pre-existing untracked `.agentmonitors/` and `.codex/` left intact |
| Upstream parser and generator                                  | Both Go manifests pin `mvdan.cc/sh/v3 v3.13.1`, Go `1.26.5`                                                                       | Syntax source inspected from the local Go module cache                                            |

Local tags also include `sh-ast@0.1.0`, `0.2.0`, and `0.3.0`; live remote refs
confirmed those tags and `0.3.1`. Tags and manifests do not prove npm publication.
No numeric target versions are selected. Reconcile the intended integration HEAD,
registry history, and pending changesets before assigning successive 0.x minors.

The original checkout was not changed. Planning on its HEAD avoids presenting an
old extraction snapshot as the product. Before implementation, inspect newer main
and reuse relevant fixes instead of independently recreating them.

## Existing design material

`ENG_TEAM_INSTRUCTIONS.md:3-7` points to eslint-sh's architecture as the historical
serialization/normalization reference. This repository contains generated API
documentation and reports, but no prior `design/` collection. The package README,
generator README, source comments, and type tests refer to missing design files.
The sibling's `design/ARCHITECTURE.md:25-90` documents byte-to-UTF-16 replacement,
synthetic normalization, synchronous Node initialization, and a limited parser API.
Those explain current behavior; the accepted refocus supersedes lossy normalization
as the future core contract.

## Evidence and remaining work

Upstream links below use the pinned
[v3.13.1 syntax source](https://github.com/mvdan/sh/tree/v3.13.1/syntax).
Local inspection used `/Users/mnorth/go/pkg/mod/mvdan.cc/sh/v3@v3.13.1/syntax`.

| Area                        | Evidence at baseline `96d2a32`                                                                                                                                          | Consequence                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Synchronous startup         | `packages/sh-ast/src/wasm-instance.ts:61-74` reads, compiles and instantiates synchronously, starts Go, and caches exports; `parse.ts:113-148` returns directly         | Preserve this foundation. Warm-reuse tests alone do not prove cold installed-package behavior or exactly-once initialization.                                      |
| Complete types              | `tools/gen-visitor-keys/main.go:644-673` emits child fields and an unknown index signature, skips positions; `src/types.ts:52-70` returns broad ShFile/ShNode           | Scalars/operators are not fully typed at this baseline; precise return unions and all fields are required for A.                                                   |
| Omitted values              | `shim/internal/nodeencode/encode.go:139-166` omits empty slices, false, empty strings and zero uint32; `src/normalize.ts:242-253` copies only present fields            | Required array declarations disagree with runtime omission. Zero/default reconstruction and nil/empty distinction require a deliberate codec contract.             |
| Named positions             | `src/normalize.ts:242-275` drops position fields and replaces node positions with UTF-16 ranges                                                                         | Token positions and original byte coordinates do not reach callers. Upstream printers later need position information.                                             |
| Invalid/recovered positions | `shim/internal/nodeencode/encode.go:198-208` emits only valid positions; upstream `nodes.go:68-173` exposes validity and recovery separately                            | Ordinary invalid and recovered values collapse before TS sees them. Current typedjson parity tests cannot catch this loss.                                         |
| Empty source                | `src/normalize.ts:311-314` requires Pos/End; `parse.ts:80-88` requires stmts array; upstream `nodes.go:34-65` returns invalid bounds for empty File                     | Valid empty/whitespace programs fail normalization; comment-only programs lack the required stmts field.                                                           |
| Errors and partial results  | `shim/main.go:91-111,221-227` flattens ParseError/LangError and drops File on error; `src/parse.ts:126-140` drops raw offset/column                                     | Preserve upstream partial results and structured error fields, not only message/UTF-16 location. See upstream `parser.go:244-256,964-993`.                         |
| Caller controls             | `src/types.ts:17-30`, `shim/main.go:215-222` expose only dialect/filename and force comments on                                                                         | Expose or explicitly scope parser controls. Upstream StopAt has a four-byte constraint; RecoverErrors exposes recovered positions.                                 |
| Numeric domains             | Upstream `tokens.go:8,178-380` defines uint32-derived operator families; `nodes.go:69-114` stores position components in uint32 with specific saturation/overflow rules | Do not replace these with unconstrained numbers, arbitrary enums, or byte-to-character reinterpretation. LangVariant is separately a Go int.                       |
| Auxiliary structs           | `src/normalize.ts:280-308` invents type/range/loc for Slice, Replace and Expansion                                                                                      | Their data must survive, but they must not masquerade as upstream Nodes. Upstream `walk.go:94-109` traverses contained nodes directly.                             |
| Existing walk               | `src/walk.ts:13-46` recursively visits object properties, pre-order, with parent argument                                                                               | Different from upstream Walk's order, pruning and nil exit callbacks (`walk.go:12-37`). Release B replaces or distinctly separates this behavior.                  |
| Printer                     | No public printer or reverse bridge exists                                                                                                                              | Add decoding and upstream Print in B; prove information-preserving reversibility in A. Upstream Print accepts only specified root families (`printer.go:114-174`). |
| Analyze boundary            | `src/analyze/index.ts:1-23` exposes resolveWord and enumerateCommands; resolve-word interprets quoting/expansion, enumerate-commands adds command contexts              | These are additional semantics, not a syntax binding. Disposition is unresolved; removal is not authorized.                                                        |

### Fixes already present or available

At the corrected baseline, the normalizer already uses generated per-type
`POSITION_FIELDS` (`src/normalize.ts:51-74`), preserving loop bodies and boolean
fields that the extraction's bare-name denylist dropped. Do not re-file those
fixed defects. Existing loop-body and position-field tests are useful regressions.

The later `7a70a12` comparison contains scalar typing (`b93cba8`), renamed errors
(`163f842`), analyze error/type re-exports, resolveArgv0, and a dialect matrix.
Scalar fields there are optional boolean/string/number, but operators still use
`op?: number`, positions are still dropped, and nil/default omissions remain.
These are partial fixes to reuse, not proof of the proposed complete contract.

Later main also adds a conservative depth-150 guard (`ef343d7`;
`src/parse-depth-guard.ts:58`, `src/parse.ts:125` at `7a70a12`) to avoid WASM stack
exhaustion. It is absent at the declared baseline. Reconcile this explicit adapter
limit before claiming identical upstream input acceptance. This planning pass did
not audit every newer-main change.

## Validation performed in this planning pass

- Read implementation, schema generation, checked-in declarations, tests, API
  reports, manifests, workflows, upstream source, and consumer integration code.
- Read-only committed-WASM ABI probes observed: empty input yields a File without
  Pos/End/Stmts; comment-only input has Last without Stmts; ordinary commands omit
  false flags/empty arrays; `echo ok; (` returns only parseError. The shared WASM
  Git blob is `e4333e0842c2c39235c095e1c4af0b942298111c` across the inspected code
  baselines. These probes establish wire behavior, not complete API parity.
- Existing shim `go test ./...` passed. This validates its current encoder tests,
  not the future lossless representation. No new software/tests were implemented.
- The consumer was inspected only. Its tests, build, dependency links, and packaged
  candidate gate were not executed. No release, publication, or full suite result
  is claimed.
- Two focused read-only Codex assessments reviewed upstream fidelity and consumer
  compatibility, then reviewed these documents. Their corrections cover baseline
  drift, invalid-UTF-8 behavior, derived bounds after edits, and candidate receipt.
  Markdown formatting, relative file links, and diff whitespace were checked.
