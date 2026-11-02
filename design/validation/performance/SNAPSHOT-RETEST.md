# Independent position-snapshot correction retest

**Preliminary measurements, superseded for final acceptance.** See
[the exact canonical-backed candidate retest](FINAL-CANONICAL-RETEST.md).
Original observations below are preserved.

## Outcome

The measured repeated-subtree transport defect is removed. Every fixture now
performs exactly **one `parse-with-positions` operation and zero `pos`/`end`
operations**, including the same 3,351-node representative source and 64-level
nested source. All expected nested markers and original node counts are retained.

The 500-line representative warm median falls from **790.3 ms to 77.2 ms**
(10.2x faster); first lint falls from **862.8 ms to 129.0 ms**. The 64-level warm
median falls from **763.3 ms to 32.2 ms** (23.7x faster); first lint falls from
**830.1 ms to 70.8 ms**. The correction does not restore 0.3.1 latency: the same
baseline remains 22.2 ms and 4.7 ms warm respectively (3.5x/6.9x differences).
These residual differences are explicit observations, not a newly invented
acceptance threshold or a claim of latency parity.

Recommend accepting the **specific performance correction** after canonical
candidate verification. No further blocker was found in its targeted correctness
review. Retain the residual overhead and methodology in release evidence; avoid
claiming universal linear time or baseline performance. The final candidate still
requires its canonical WASM and exact linked/packed consumer receipt checks.

## Identity and unchanged methodology

- Corrected consumer: `2a0f260ddfc632949d9f186678ada35ceca0d1cc`.
- Preliminary parser tarball: `scratch/snapshot-preliminary/sh-ast-0.3.1.tgz`,
  SHA-256 `76c907faa9439ed30cbd478d727bbe699ac6052758f88ac94ec34db54e879f9d`.
- Preliminary Linux WASM SHA-256:
  `a9603b3c9d939e2bca2b093cd7bdbd7ee77fa55a5e882c56db275a7ecb943e4c`.
  Go implementation `a5f7875` plus root TypeScript snapshot integration. This was
  a locally built Linux candidate; it is not independently canonical CI evidence.
- Consumer source and parser bytes were frozen in `snapshot-candidate/` before
  measurements. `snapshot-candidate/identity.json` records compiled consumer and
  parser code hashes. Active production sources were not changed by the review.
- Same `benchmark.mjs`, ten fixture JSON/source files, Node24.14.0, ESLint10.7.0,
  Apple M5 Max. Three new fresh subprocesses per fixture, each first real lint
  followed by three warm lints. Baseline measurements were retained unchanged,
  not rerun or replaced. Times exclude imports; raw records retain import time.
- Separate instrumentation again counts actual WASM exports and payload lengths.
  Requests now transfer only each original source (13,120 bytes and 2,146 bytes
  for the two headline cases), not 15–16 MB of subtree JSON. Response metadata
  still has a cost; these counts concern request payloads and operation count.

## Comparison

| Fixture           | Baseline warm ms | Before correction warm ms | Snapshot warm ms | Snapshot first lint ms | Speedup over defective candidate |
| ----------------- | ---------------: | ------------------------: | ---------------: | ---------------------: | -------------------------------: |
| representative-1  |             1.05 |                      17.4 |             2.24 |                  31.92 |                             7.8x |
| representative-5  |             3.00 |                      81.5 |             8.59 |                  41.03 |                             9.5x |
| representative-20 |             9.90 |                     312.3 |            32.97 |                  74.45 |                             9.5x |
| representative-50 |            22.24 |                     790.3 |            77.18 |                 129.04 |                            10.2x |
| nested-2          |             0.91 |                      16.6 |             2.14 |                  32.27 |                             7.8x |
| nested-4          |             1.00 |                      23.0 |             2.82 |                  32.94 |                             8.2x |
| nested-8          |             1.45 |                      40.6 |             3.65 |                  36.10 |                            11.1x |
| nested-16         |             1.79 |                      87.0 |             7.51 |                  39.32 |                            11.6x |
| nested-32         |             2.64 |                     236.1 |            12.84 |                  45.50 |                            18.4x |
| nested-64         |             4.70 |                     763.3 |            32.23 |                  70.80 |                            23.7x |

## Targeted correctness review

Reviewed Go snapshot capture and TypeScript path correlation, public types,
lookup behavior, and consumer integration. Go uses original upstream Nodes and
independently captures each Pos/End result or failure. It traverses auxiliary
records to reach real children and handles value comments and typed-nil interface
occurrences. TypeScript checks exact occurrence paths and complete coverage once;
its lookup uses an identity WeakMap with frozen position copies. File remains
mutable, snapshot observations remain original, live nodePos/nodeEnd retain their
independent current-tree semantics, and missing consumer observations fail instead
of silently falling back to expensive live calls.

Independent native snapshot tests and Go vet passed. Seventeen TypeScript
snapshot/runtime-boundary tests and snapshot type tests passed against the fresh
Linux build. Full consumer behavior is additionally exercised here by real ESLint
with identical visited-node counts and leaf marker assertions in all 120 lints
(three processes × four lints × ten fixtures).

There is no universal O(n) claim: path copying/serialization and upstream bound
methods' own recursive work still contribute. The demonstrated correction removes
repeated whole-subtree serialization/reconstruction at each projected node.

Raw observations: `snapshot-timings.jsonl`, `snapshot-transport.jsonl`,
`snapshot-summary.json`. Reproduction: `rerun-snapshot.py` freezes the specified
consumer commit and tarball before invoking the unchanged harness.
