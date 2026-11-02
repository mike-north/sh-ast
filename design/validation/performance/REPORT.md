# Independent Release A performance review

**Historical pre-correction evidence.** The repeated-subtree defect measured here
was corrected in a preliminary snapshot candidate. Original measurements and
artifacts remain unchanged. See [the independent correction retest](SNAPSHOT-RETEST.md)
for current results, residual overhead, exact candidate identity, and remaining
canonical-build verification.

## Finding

The consumer's per-node `nodePos` / `nodeEnd` calls cause a material performance
regression by serializing and reconstructing every projected node's entire subtree
twice. A 500-line representative script takes **790.3 ms warm** versus **22.2 ms**
on the 0.3.1 baseline (35.5x). A small but deliberately deeply nested 134-line
fixture takes **763.3 ms** versus **4.7 ms** (162.4x). These are observations, not
an invented latency threshold. Address this path before accepting the candidate.

## Exact identities and method

- Producer repository examined: `3715abd9d8d66cd913743ff0de431c73853d47a0`.
- Candidate parser tarball source: `d1531f1a59c5f6a9bb6dbcab995c9ae7c72367d0`;
  only tests/work records changed between that commit and `3715abd`. Package
  manifest remains 0.3.1 pending the minor changeset; this is the new candidate API.
- Candidate parser tarball SHA-256:
  `740110701a41a54608a948d7649d4c8ebffeb571df70e6d996facdfb9c40c16c`.
  WASM: `dc3ab066216b87d4131672d54b1cb1f801948a8dbac6f167f485172de0eb3466`.
- Candidate consumer: `52f1b79b222fb4ef85994bd9c00f924542d378ac`.
- Baseline consumer: `3d1a3aa16b66edcd4101ed3d33e9e5788f3b2639` (old API, gate scaffold).
  Baseline parser: built 0.3.1 tarball, SHA-256
  `e273f3173547a63ea0a74569956e4093ab44e808cb72832579038d89d6dd4325`;
  WASM `f9da2cb772a300e44bd87303f1181f864899d5e3da3c5ec32514808e915258b8`.
- Same Node v24.14.0 and ESLint 10.7.0 dependencies for both; Apple M5 Max,
  Darwin arm64. Both consumer source revisions were extracted and compiled into
  isolated scratch directories; active worktrees/original checkouts were not edited.
- Three fresh subprocesses per fixture/version, alternating version order between
  rounds. Each measures its first real `Linter.verify` and then three further
  lints of identical source. Cold numbers include first WASM initialization but
  exclude module import time, which is recorded separately. Warm median combines
  the nine subsequent lints. No parser call occurs before the first lint.
- A real wildcard ESLint listener counts visited nodes and asserts every nested
  `BENCHMARK_TOKEN` leaf is visited. Both versions report equal node counts and
  no errors for every measured lint. This is parsing, projection and traversal,
  not an empty configuration that silently skips the file.
- Instrumentation runs separately from timing. It wraps the WASM export in the
  isolated process to count operation calls and payload bytes, without changing
  the parser or consumer source. It confirms actual subtree transfer, rather than
  inferring it only from timings.
- `identity.json` in each version directory records complete compiled consumer
  hashes and parser code hashes. Raw observations are in `timings.jsonl`,
  `transport.jsonl`, and `parse-timings.jsonl`; `summary.json` contains medians.

## Workloads and measurements

Representative units are 10-line functions with a loop, conditional, command
substitution containing a pipeline, Unicode/combining characters, comments, and a
function invocation. The nested series is a scaling diagnostic: one function,
2–64 nested loops, a Unicode pipeline substitution and a literal leaf marker.
64 levels is deliberately pathological; the 1–50 representative-unit series and
2–8 nesting levels provide ordinary-size context. All remain below the existing
parser-depth guard and successfully lint in both versions.

| Fixture           | Lines | Bytes | Nodes | Cold baseline ms | Cold candidate ms | Warm baseline ms | Warm candidate ms | Warm ratio |
| ----------------- | ----: | ----: | ----: | ---------------: | ----------------: | ---------------: | ----------------: | ---------: |
| representative-1  |    10 |   260 |    68 |             29.5 |              54.2 |             1.05 |              17.4 |      16.6x |
| representative-5  |    50 |  1300 |   336 |             33.8 |             124.6 |             3.00 |              81.5 |      27.2x |
| representative-20 |   200 |  5230 |  1341 |             42.9 |             372.8 |             9.90 |             312.3 |      31.5x |
| representative-50 |   500 | 13120 |  3351 |             60.9 |             862.8 |            22.24 |             790.3 |      35.5x |
| nested-2          |    10 |   232 |    64 |             29.9 |              51.3 |             0.91 |              16.6 |      18.4x |
| nested-4          |    14 |   292 |    80 |             30.0 |              60.4 |             1.00 |              23.0 |      23.0x |
| nested-8          |    22 |   412 |   112 |             30.2 |              80.3 |             1.45 |              40.6 |      28.0x |
| nested-16         |    38 |   658 |   176 |             31.2 |             130.0 |             1.79 |              87.0 |      48.6x |
| nested-32         |    70 |  1154 |   304 |             33.3 |             282.3 |             2.64 |             236.1 |      89.5x |
| nested-64         |   134 |  2146 |   560 |             36.9 |             830.1 |             4.70 |             763.3 |     162.4x |

## Attribution and bounded recommendation

Consumer `src/language/syntax-view.ts:139` calls both position methods for each
real node before recursively projecting its children. Producer `src/syntax.ts:151`
validates the complete subtree and `:154` encodes it for each call.
`syntax-wire.ts:42-73` recursively visits all descendants; Go `DecodeNode` then
reconstructs that entire subtree before invoking the one requested method.
The aggregate work is proportional to the sum of subtree sizes, repeated twice:
linear for fixed-depth trees but quadratic for a growing chain.

Instrumentation confirms this path. The representative 500-line fixture has
3,351 projected nodes: **6,702 position calls**, transferring **15,021,836 bytes**
of position-request JSON for 13,120 bytes of shell source. The 64-level fixture
has 560 nodes: **1,120 position calls**, transferring **16,401,974 bytes** for
2,146 source bytes. From depth 16 to 32 to 64, one direction's JSON payload grows
871,757 → 2,483,733 → 8,200,987 bytes, while node counts grow 176 → 304 → 560.

Separate fresh-process parse-only measurements show the regression is principally
the view-construction path, not merely the complete-tree parser:

| Fixture           | Baseline warm parse ms | Candidate warm parse ms |
| ----------------- | ---------------------: | ----------------------: |
| representative-50 |                  19.09 |                   31.22 |
| nested-64         |                   3.51 |                    4.81 |

Recommend retaining live `nodePos`/`nodeEnd` semantics for arbitrary edited nodes,
while giving the consumer one explicit position snapshot for the parsed tree.
Compute bounds in the Go parse/encode pass, or in one bulk reconstruction, and
associate returned observations with the corresponding original node identities.
Keep this sidecar separate from mutable raw syntax fields and label its snapshot
lifetime explicitly; do not introduce a stale cache into the live position methods.
This is a bounded way to remove repeated transport without introducing public
Walk/Print behavior or porting every upstream position formula into ESLint.

Acceptance for that correction should prove that creating one view no longer
transfers each subtree per node (mechanical operation-count/payload evidence),
retain all existing coordinate/identity/mutation tests, and rerun these same
fixtures against the resulting exact candidate. No optimization was implemented
by this review, and no fixed numeric latency budget is asserted.
