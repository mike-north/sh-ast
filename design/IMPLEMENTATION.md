# Release A implementation record

This is a work record, not a declaration of release acceptance. Implementation is
authorized; publication, release tags, merging to main, and public Release B
traversal/printing are outside this assignment.

## Baseline reconciliation

Implementation starts from remote main `7bdc6b14899898518e1dbecc01830b2f5f05a893`.
On 2026-11-01, `npm view sh-ast version versions dist-tags --json` reported latest
`0.3.1` and versions through `0.3.1`. Release A therefore targets the next minor,
`0.4.0`; Release B remains the following minor. The design commit was rebased as
`1ec9ac8`. No original checkout changed: sh-ast's original `main` remains
`96d2a32` with its 13 added go.sum checksum entries, and eslint-sh's existing
untracked work remains intact.

## Concrete contract decisions

- Public records retain upstream field spelling, a Type discriminator, explicit
  defaults/nulls, and mutable syntax fields. Auxiliary structs remain outside Node.
- GoString is string for valid UTF-8 or Uint8Array for other bytes. JS string
  inputs containing lone surrogates are rejected before encoding; exact byte input
  reaches upstream unchanged, including upstream invalid-UTF-8 errors.
- Operator fields admit named numeric constants, zero, and a family-branded raw
  uint32 path. Invalid/fractional uint32 inputs are rejected, but unnamed Go values
  are not silently narrowed to the named enum subset.
- Go int/uint are actually 64-bit on the js/wasm target, verified by target tests.
  Only relevant operation arguments use safe-integer number or bigint: Variant,
  RecoverErrors, and NewPos inputs. Stored position components/operators remain
  exact number domains. NewPos retains upstream saturation/overflow behavior.
- SyntaxPos has Offset, Line, Col, IsValid, IsRecovered, and OffsetOverflow.
  The sixth field is necessary: public position arithmetic can produce the same
  first five observations as ordinary invalid zero while changing After behavior.
  OffsetOverflow is derived with public After/validity observations. Recovery and
  overflow reconstruction use supported parsing/node operations, no private-layout
  access or maintained upstream fork. This preserves observable position behavior,
  not private Go representation identity.
- Node bounds are operations on the current tree. Pos and End run independently:
  an incomplete edited BinaryCmd can support one while the other panics upstream.
  A helper must not fail because it unnecessarily invoked the unrelated method.
- The existing parse-depth guard remains an explicit binding resource constraint.
  Analysis helpers are being migrated separately, retaining useful behavior without
  controlling the faithful syntax model. ESLint owns its projected view.

## Integrated slices and evidence

| Slice                                                | Commit(s) in integration branch | Evidence                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lossless Go codec and synchronous operation protocol | `4fcea2b`                       | Tests first failed missing codec/operation implementations. Native Go, actual js/wasm tests, Go vet, and a Node ABI probe passed. Covers complete field/null/default records, arbitrary strings, partial errors, recovery, integer boundaries, private printing oracle and all 46 node/auxiliary types. |
| Complete schema/types/constants                      | `c4e494d`, `2dee4a0`            | Independent reflection inventory and tsd failures preceded implementation. See [schema evidence](validation/faithful-schema.md). Legacy generated outputs initially remained unchanged to isolate migration.                                                                                            |
| Independent node-bound operations                    | `78a6727`                       | Review found combined bounds incorrectly failed Pos when only End was unsupported. X-only/Y-only BinaryCmd tests failed before separate operations; native and js/wasm tests then passed.                                                                                                               |
| Position overflow distinction                        | `8a5b65c`                       | Native and actual js/wasm experiment exposed the five-field collision. Twelve-case round-trip matrix compares getters, String, After in both directions and subsequent node arithmetic.                                                                                                                 |
| Public TypeScript interface                          | `1abba97`                       | Four public tests first reproduced empty/comment-only failures and dropped/default-renamed fields. Fourteen focused end-to-end tests then passed against the Linux-built candidate. Full old-suite migration remains separate.                                                                          |

Further integration checks observed: 25 focused tests passed, including a fresh
process proving first-call synchronous return before a queued microtask and exactly
one WASM module/instance across success/error/success. Public-entry tsd checks pass.
A malformed recovered+valid response regression failed before the six-field
consistency validator and passed afterward.

## Consumer and build status

Consumer work is isolated at
`/Users/mnorth/.codex/worktrees/consumer-candidate-gate/eslint-sh`. Its gate scaffold
commit `3d1a3aa` reproduced a packaged-install registry bypass via a hash mismatch,
then passed linked and installed checks after injecting an exact baseline tarball.
The baseline gate ran 157 plugin and 3 umbrella tests. This is scaffold evidence
using the old API, not acceptance of the faithful candidate. Consumer adapter
`7974a51` and diagnostic fix `c3a592d` are committed in its isolated worktree.
The preliminary faithful artifact passes 170 plugin tests, 3 umbrella tests,
build/checks, and an exact linked cold-lint probe. Final installed-candidate
acceptance and canonical-binary receipt remain pending.

Linux/amd64 Go 1.26.5 runs under Docker. The Binaryen version_131 Linux archive
matched the repository's pinned SHA-256. The canonical Linux CI asset has now been retrieved from run `41384504946`,
artifact `13115245005`, built from source head
`66c35c07f1cf222ca6c8eacb40f48fb2f16cc92f`. The downloaded ZIP matches GitHub's
SHA-256 `2f0c969cfe45b5861981bbd7286b11e78581a2be007727e7c399b824fe9604d2`.
The extracted WASM SHA-256 is
`dc3ab066216b87d4131672d54b1cb1f801948a8dbac6f167f485172de0eb3466`;
it is byte-identical to the disposable Linux candidate. The committed binary
is taken from the downloaded CI archive. The GitHub CLI release download failed with bad
credentials, so the fixed public asset URL plus checksum verification was used.

## Integration and independent review

- Analysis migration `4f4c415` retains caller-owned record identity and unsupported
  byte/nil fragments; 244 author-owned runtime checks and cross-entrypoint types
  passed before integration.
- Runtime/type regression migration `7fa42d8` preserves the dialect/depth matrices
  and 44 independently derived scalar-field assertions. The integrated runtime
  suite reached 488 passing tests and the full tsd suite passed before typed-nil
  extension. This is a dated intermediate result, not the final candidate count.
- Independent review reproduced dropped nil argv slots. `6b2548c` preserves the
  slot as unsupported; the exact `sudo rm -- /safe` plus inserted nil regression
  failed first and then passed. That commit also fixes generated TSDoc escaping
  after a failing punctuation-output test.
- `2de6fdb` removes the unused normalized projection and transport, leaving the
  faithful generated model. A real generator invocation first failed its intended
  five-file output inventory, then passed after cleanup. Build outputs were cleaned
  before rebuilding to prevent deleted modules from remaining in the package.
- Independent review found Go typed-nil interface loss. Capability probes showed
  rejection would narrow successful upstream Pos/End behavior, so the final
  implementation uses `{ Type: 'TypedNil', Kind: 'Word' }` tags with actual
  interface assignability. `da9eb24` supersedes the interim rejection in `60a61dc`.
  See [codec review evidence](validation/codec-review-regressions.md) for independent
  operation fixtures, parser-output investigation limits, and real edited-tree
  private printing/reparse proof. Native and actual WASM tests pass; independent
  rereview reproduced preserved dynamic type and expected success/panic behavior.
- Independent consumer review found an overflow-column `?` diagnostic-prefix bug;
  consumer `c3a592d` fixes the exact long-line regression. Thirty independent
  consumer-focused tests and ten diagnostic checks passed against preliminary
  linked artifacts. Exact final artifact acceptance remains separate.

## Remaining acceptance

Typed-nil generated/public types are integrated as `1cd8e74`; final local build,
check, and test pass, with 492 runtime tests plus complete tsd checks. Native Go
tests/vet, generator tests, and byte-identical schema regeneration pass. API
reports and docs have been regenerated without TSDoc diagnostics. These checks
use the disposable Linux-built candidate, not yet the canonical CI asset.

Remaining: verify the canonical artifact correction in a fresh CI run and complete
both exact candidate receipt paths. To obtain that
artifact without committing a local build, the draft source branch initially
retains the previous committed binary. The first CI comparison and runtime tests
are expected to expose that stale binary; the upload step preserves CI's rebuilt
asset for the subsequent correction. No stale-binary run is release acceptance. The minor changeset is
drafted; no version command has run. The consumer requires ^0.4.0 and a real
registry lockfile refresh after producer publication, which is outside this task. No final Release A acceptance or release publication is claimed here.

Independent final targeted review covered the tagged codec, generated interface
unions, and built public runtime. The original native reproducer retained its
concrete dynamic type, successful Pos and expected End failure; public WASM
Pos/failure/Pos reuse also passed. The reviewer ran 31 targeted runtime tests,
native tests/vet, generator/type checks, and the ten corrected consumer diagnostic
tests. No remaining defect was reported in the reviewed scope. Final CI and
consumer artifact receipts are separate gates.
