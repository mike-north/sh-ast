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
failed as expected against the pre-change binary. The canonical adoption head
`e6b57a42a9ead1a37ba87af725b3156da88908c7` then passed CI, schema reproducibility,
and Linux rebuild-match. Copilot submitted a review with no actionable inline
findings, but explicitly reported that model policy or plan restrictions prevented
completion at the selected tier; independent specialist review remains the
substantive source review evidence.

The reviewed benchmark harness and retained evidence were then integrated without
changing runtime source or the canonical artifact. Final Node 22.22.1 uncached
checks and tests passed: 793 runtime tests, tsd, and 33 harness tests. A failing
Knip check identified missing standalone command entrypoints; explicit root-workspace
entries for the preparer, runner and worker corrected that integration issue.

The [canonical matched experiment](performance/stream-encoding/README.md) retains
216 timing workers, 6,480 measured calls and 36 verification workers. On Node
22.22.1 / Apple M5 Max, M2 raw-bridge snapshot medians fell from 82.58 to 26.78 ms,
public snapshot medians from 100.10 to 43.08 ms, and no-rule ESLint medians from
108.28 to 50.37 ms. Raw timing includes ABI allocation/copy/result conversion/free;
no pure internal WASM/parser timer was collected. The median paired raw snapshot
ratio was 32.37%, so the <=30% investigation target was not met. Root explicitly
accepted this bounded outcome; no additional optimization or #36 work was added.
Final PR merge remains the root's decision; no publication is implied.
