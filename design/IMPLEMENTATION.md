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

## Release A candidate outcome

The implementation and exact local consumer acceptance are complete. This is a
reviewable pre-release candidate, not authorization or evidence of publication.
The package manifest remains 0.3.1; the minor changeset targets 0.4.0.

Producer runtime/API code is frozen at `d1531f1a59c5f6a9bb6dbcab995c9ae7c72367d0`.
That commit is clean, with empty source diff SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
and no untracked source files. The packed candidate SHA-256 is
`740110701a41a54608a948d7649d4c8ebffeb571df70e6d996facdfb9c40c16c`.
Subsequent changes add tests and work records only; a final repack verifies the
same tarball bytes. Producer build, check, full tsd, 499 runtime tests, native Go
checks and independent generator checks pass. The final seven runtime checks
close evidence gaps for StopAt prefix/quoted behavior and transport allocation
cleanup; they passed existing production code and are not represented as fixes.

At the frozen commit, GitHub CI run `41384741277`, WASM reproducibility run
`41384741261`, and schema reproducibility run `41384741504` passed. The source-only
bootstrap's stale-binary failures were expected and superseded by the canonical
artifact commit; no bootstrap failure is represented as acceptance. Fresh CI is
also required for the final test/work-record follow-up before handoff.

Independent review covered the codec, public boundary, generated unions, analysis,
and consumer adaptation. Exact regressions established nil argv-slot preservation,
typed-nil dynamic type and separate Pos/End success/failure behavior, and overflow
error-display handling. The final targeted reviewer ran 31 runtime tests, native
tests/vet, generator/type checks and ten consumer diagnostics with no remaining
reported defect in that scope. Copilot submitted a review, but its summary reports
a documentation-only view and stale bootstrap context; it is not evidence of
runtime review. Generated docs are isolated in commit `66c35c0`.

Consumer code and evidence are in
[draft eslint-sh PR 104](https://github.com/mike-north/eslint-sh/pull/104), head
`52f1b79b222fb4ef85994bd9c00f924542d378ac`. Its configured candidate gate passed
176 plugin tests and 3 umbrella tests, plus uncached build/check and documentation
drift checks. The actual linked and npm-installed cold processes both validated
all 70 runtime assets, the exact candidate hash, synchronous first lint, and a
nested `candidate:hello` report. Their complete receipt and observations are
committed under the consumer's `work-records/release-a-candidate-*.json`.
The installed temporary directory is deleted only after verification.

### Acceptance mapping

| Gate  | Concrete evidence                                                                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1    | `test/cold-start.test.ts` observes one module/instance and first return before a queued microtask; consumer linked/installed receipts observe real first lint.                                                                           |
| A2    | `test/faithful-parse.test.ts`, `test/normalize.test.ts`, and `TestEncodeKeepsAllFieldsAndDistinguishesNilAndEmpty` cover explicit defaults, empty/comment-only programs, and nil versus empty.                                           |
| A3    | `test/multibyte.test.ts`, `test/position-fields.test.ts`, native Unicode round trips, and consumer `faithful-language.test.ts` preserve bytes and independently project UTF-16.                                                          |
| A4    | Generator reflection inventory covers all 46 records, six interfaces and 11 operator families; `test-d/node-types-scalar-fields.test-d.ts` preserves 44 scalar assertions; kitchen-sink/auxiliary and TypedNil tests cover alternatives. |
| A5    | `TestPositionRoundTripPreservesAllPublicMethods`, parser recovery and public constructor tests compare recovery, saturation, overflow and ordering observations.                                                                         |
| A6    | Full `test/dialect-matrix.test.ts`, `TestParseDefaultsAndOptionsMatchUpstream`, integer-boundary checks and public StopAt prefix/quoted-word assertions preserve input semantics.                                                        |
| A7    | Native ParseError/LangError/byte tests and `test/syntax.test.ts` preserve partial File, complete structured fields and exact bytes.                                                                                                      |
| A8    | Cold/warm/ABI/malformed-envelope tests plus six `test/wasm-memory-ownership.test.ts` cases prove allocation/exception cleanup, detached-view handling, and healthy reuse. The ownership ledger is independent of production bookkeeping. |
| A9    | `TestRoundTripMatchesNativeStructsAndPrivatePrinting` and `TestEditedTreeRoundTripMatchesNativePrintingAndMeaning` compare independent upstream printing and reparsed edited meaning. No public printer is exposed.                      |
| C1/C4 | Committed consumer linked/installed observations prove exact importer-relative asset identity and cold real lint for the same canonical tarball.                                                                                         |
| C2    | Consumer integration, loops, comments/directives, source access and fatal error suites pass within the full configured 176-test gate.                                                                                                    |
| C3    | Real `Linter.verify` asserts fix range `[17, 23]`; `verifyAndFix` preserves emoji, CJK, decomposed combining text, quotes and CRLF around the replacement.                                                                               |

### Release and coverage boundaries

- [Draft sh-ast PR 30](https://github.com/mike-north/sh-ast/pull/30) and the consumer
  PR remain unmerged; nothing was published or tagged. Release B public Walk,
  Print and tree-edit-to-ESLint-fix integration remain intentionally unimplemented.
- Consumer manifest requires `^0.4.0`, which is unpublished. Its old lockfile is
  deliberately not fabricated. Ordinary frozen registry installation/CI fails
  with `ERR_PNPM_OUTDATED_LOCKFILE` until producer publication and a real lockfile
  refresh. That is a release-order prerequisite, separate from the passing exact
  candidate gate. The consumer PR is not ready to merge before it is resolved.
- No blanket full-syntax-package, arbitrary Reader/incremental-parser, browser,
  shell execution, or byte-identical public printing claim is made.
- The original sh-ast checkout remains at `96d2a32` with its existing go.sum delta;
  the original eslint-sh checkout remains at `7412616a` with its existing untracked
  folders. Neither original checkout was modified by this work.
