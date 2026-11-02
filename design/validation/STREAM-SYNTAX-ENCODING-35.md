# Streaming syntax encoding

## Contract and boundaries

The baseline is `80bdcd9f99e2ad5e48dc8d15af13c8470f12794e`, after the decoder
and brace-classification corrections. This change replaces the parse response's
intermediate syntax maps and retained snapshot paths with streaming JSON. It does
not change the TypeScript decoder, schema, protocol, or snapshot occurrence order.

Syntax objects retain alphabetically ordered keys. Position objects retain their
Go declaration order. Snapshot traversal remains a separate declaration-order
pass, with each occurrence emitted before its children and Pos observed before
End. Syntax encoding must succeed before any bound methods run.

On ordinary writer failure, partial bytes are discarded and structural validation
runs in declaration order to preserve the original first error and field wrapping.
This exceptional pass builds no representation tree, invokes no caller methods,
and does not mutate the graph. Unexpected panics retain the existing outer Process
recovery boundary. Shared children remain valid; only active ancestors are cycles.

Active slice ancestry includes type, backing start, and length. A shorter slice
at the same backing start is not automatically a cycle. Self-referential slice
inputs previously recurse indefinitely; rejecting them is the explicitly approved
termination exception, not a claim of equivalence to a terminating legacy result.

## Independent tests

The `internal/legacywiretest` and `internal/legacybridgetest` packages freeze the
baseline map encoder, snapshot walk, and parse-envelope implementation. Only test
files import them. They share no production writer, plan, validator, string, or
position helpers. Known nonterminating fixtures never call the frozen encoder.

| Contract                                                                                                                                                                   | Tests                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Complete parse and sidecar response bytes, five dialects, Unicode, HTML/control escaping, arbitrary bytes, comments, heredocs, recovery, partial files and invalid options | `TestStreamingParseMatchesFrozenEnvelope`                                      |
| Syntax bytes, nil versus empty, typed nils, shared pointers, positions and legacy errors                                                                                   | `TestStreamingSyntaxMatchesFrozenEncoder` plus existing codec round-trip tests |
| Declaration-order errors despite sorted output and private fields                                                                                                          | `TestStreamingErrorsKeepDeclarationOrder`                                      |
| Nested error wrapping, warm caches, no user methods or graph mutation, partial prefix discard                                                                              | `TestStreamingNestedErrorsDoNotInvokeMethodsOrMutate`                          |
| Bounded self, mutual and mixed slice cycles, including declaration-order replay                                                                                            | `TestStreamingSliceCyclesTerminate`                                            |
| Shared/overlapping/shorter slices and exact escaping                                                                                                                       | `TestStreamingSliceAliasesAndEscaping`, `TestStreamingStringEscapingAllASCII`  |
| Declaration-order occurrence bytes, value comments, typed-nil failures and independently successful bounds                                                                 | `TestStreamingSnapshotsMatchFrozenOccurrences`                                 |
| Pos-before-End calls and byte-bearing panic text                                                                                                                           | `TestStreamingSnapshotMethodOrder`                                             |
| Encoding InternalError replaces partial envelope, suppresses bounds and preserves subsequent calls                                                                         | `TestStreamingParseCompositionFailureIsAtomic`                                 |

Tests were added before production changes. The initial red run reproduced a
bounded child-process stack overflow for the legacy slice cycle and the missing
snapshot writer. Native Go tests pass with the streaming implementation.

## Validation and performance

Local validation used Go 1.26.5 and verified Node 22.22.1 with
`NODENV_VERSION=22.22.1`. The full native Go suite, uncached `pnpm build`,
`pnpm check`, and `pnpm test` passed: 793 runtime tests, tsd, and 27 harness tests.
The JavaScript gates used a local source build optimized with binaryen 131;
its SHA-256 was `c2adf9c8f0df30a16ce26bdcdde2b4050d094e0ed6c347650d7bc0e18ea9b0c9`.
That artifact was then replaced with the unchanged canonical baseline
`eb13ed12954c6220cf5de70019a3a628b90bd8012d38d33321fb7c4a6e9197e7`.
Independent source/test review found no actionable runtime issues and separately
passed the focused streaming Go suites. Source inspection confirmed that the
production target does not import the frozen oracle packages.

Canonical adoption uses the independently downloaded Linux artifact from
[workflow run 41534214435](https://github.com/mike-north/sh-ast/actions/runs/41534214435),
artifact `13182089937`, built from source commit
`25630a596f848b3f2ab6478ca34de66c23e28091`. The archive digest was verified against
GitHub's metadata, and its sole nonsymlink `sh-ast.wasm` member was read directly
into the fixed destination after validating its WASM header. No general archive
extraction was used.

The adopted WASM is 4,537,470 bytes with SHA-256
`c2adf9c8f0df30a16ce26bdcdde2b4050d094e0ed6c347650d7bc0e18ea9b0c9`.
The archive is 1,334,026 bytes with SHA-256
`b22918c5c78efe73797e54206a24bed99324514c6fa4ee344298693d8c8efdd3`.
Its bytes happen to match the local optimized build, but the committed artifact's
provenance is the independent Linux CI output. The
[artifact provenance record](stream-syntax-encoding/artifact-provenance.json)
retains every tracked Go source/test and module-manifest hash (27 files), all
verified unchanged from that source commit at adoption.

After adoption, the full native Go suite and verified Node 22.22.1 uncached
build/check/test passed again: 793 runtime tests, tsd, and 27 harness tests.
The source run passed Go tests, build and artifact upload; its final comparison
failed as expected against the pre-change binary. A subsequent exact-head
rebuild-match run is still required. Copilot review is also pending.

Performance measurements will compare this candidate against the baseline above,
using the existing harness and canonical artifacts. Preserve raw samples and
runtime/artifact identities; no performance improvement is claimed by the source
implementation or byte-equivalence tests alone.
