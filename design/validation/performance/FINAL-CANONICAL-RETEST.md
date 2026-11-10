# Final canonical-backed candidate: independent performance retest

## Verdict and scope

The repeated-subtree transport defect remains corrected in the exact final
canonical-backed tarball. All ten fixtures perform one `parse-with-positions`
operation and zero per-node `pos` / `end` operations. All 120 real ESLint lints
retain the same node counts and expected nested marker visits as the baseline.
The targeted snapshot correctness review found no remaining defect.

The final 500-line representative warm median is **81.4 ms**, versus **790.3 ms**
before correction and **22.2 ms** on 0.3.1. The 134-line / 64-level warm median is
**32.6 ms**, versus **763.3 ms** before correction and **4.7 ms** on 0.3.1. First
lint is **129.7 ms** and **72.2 ms**, respectively. These results support acceptance
of the specific architecture correction; they do not establish baseline latency
parity. Residual warm overhead is **3.7x** and **6.9x** for the headline fixtures.
No universal O(n) or invented millisecond threshold is claimed.

This report supersedes the preliminary snapshot measurements for final-candidate
performance evidence. Earlier raw data and measurements remain unchanged; reports carry
superseded-status links. Final linked/packed consumer receipt gates remain the
consumer workstream's responsibility; this review froze and compiled the same
consumer revision against the exact supplied parser tarball.

## Exact assets

- Producer clean source: `6e29227f20aa4d6fa26205bd95a134fd198b4948`.
- Tarball: `work/snapshot-release-a-candidate/sh-ast-0.3.1.tgz`.
- Tarball SHA-256:
  `2b5d30fcf4ea5790fd759eb879f923bf02007cf864e42246a4290614ff920009`.
- WASM SHA-256:
  `a9603b3c9d939e2bca2b093cd7bdbd7ee77fa55a5e882c56db275a7ecb943e4c`.
- Recorded canonical CI provenance: run `41387546090`, artifact `13116495391`, ZIP
  SHA-256 `b0def4acfbd561c63927c50582f6583c52d66ff965b1b2c22917688040b07b34`.
  These CI identifiers come from the producer's adjacent `provenance.json`; the
  final tarball and extracted WASM hashes were independently computed here.
- Frozen consumer source: `2a0f260ddfc632949d9f186678ada35ceca0d1cc`.

Compared all **21 runtime assets** (JS, WASM, package manifest) against the reviewed
preliminary snapshot candidate. There were no additions/removals, WASM is byte
identical, and only `dist/syntax-snapshot.js` changed: braces around a `forEach`
callback whose return value is unused. The precise diff and hashes are retained
in `runtime-asset.diff` and `runtime-identity-comparison.json`. Despite that narrow
change, this report remeasures the exact final bytes rather than inheriting timings.

`final-candidate-identity.json` contains hashes of compiled consumer files and all
parser runtime assets. The package manifest remains 0.3.1 because release versioning
has not been performed; hashes and source commits identify this candidate.

## Method and complete results

The unchanged benchmark harness and same fixture files were reused. For each
fixture: three fresh subprocesses, each first real `Linter.verify` followed by
three warm lints. Cold includes first WASM initialization and excludes imports.
Warm combines nine subsequent samples. Separate instrumentation observes actual
WASM operation counts and request payload lengths. Baseline and pre-correction
measurements are the retained earlier observations, not overwritten reruns.
Node24.14.0 / ESLint10.7.0 / Apple M5 Max remain unchanged.

| Fixture           | Baseline warm ms | Defective candidate warm ms | Final warm ms | Final cold ms | Improvement from defective candidate |
| ----------------- | ---------------: | --------------------------: | ------------: | ------------: | -----------------------------------: |
| representative-1  |             1.05 |                        17.4 |          2.36 |         33.32 |                                 7.4x |
| representative-5  |             3.00 |                        81.5 |          8.82 |         43.40 |                                 9.2x |
| representative-20 |             9.90 |                       312.3 |         34.12 |         75.96 |                                 9.2x |
| representative-50 |            22.24 |                       790.3 |         81.39 |        129.67 |                                 9.7x |
| nested-2          |             0.91 |                        16.6 |          2.18 |         33.65 |                                 7.6x |
| nested-4          |             1.00 |                        23.0 |          2.64 |         33.77 |                                 8.7x |
| nested-8          |             1.45 |                        40.6 |          3.92 |         38.29 |                                10.4x |
| nested-16         |             1.79 |                        87.0 |          6.24 |         40.24 |                                13.9x |
| nested-32         |             2.64 |                       236.1 |         12.08 |         47.36 |                                19.6x |
| nested-64         |             4.70 |                       763.3 |         32.59 |         72.20 |                                23.4x |

Final request bytes equal the original source bytes for every fixture, including
13,120 bytes for representative-50 and 2,146 bytes for nested-64. Previously those
views sent 15,021,836 and 16,401,974 bytes of position-request subtree JSON.
Snapshot response metadata, occurrence-path construction and upstream bound
computation still contribute to the measured latency.

Raw data committed alongside this report: `final-timings.jsonl`,
`final-transport.jsonl`, `final-summary.json`. Reproduction harness and frozen
packages remain in the executor worktree under `work/performance-review/`:
`rerun-final.py`, unchanged `benchmark.mjs`, and `fixtures/`.
No production source was modified by this independent retest.
