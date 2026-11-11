# Published-version performance baseline, 2026-11-02

The main measured parsing increase is from **0.3.1 to 0.4.0**, and it persists
in warm calls. The 0.4.0-to-0.5.0 measurements show a small consistent increase
in module-import cost, but do not establish a broad additional warm-parsing
regression. Parse-time position snapshots remain a substantial cost worth
profiling separately. These observations do not show that all overhead is
unavoidable fidelity work.

The [complete machine-readable report](report.json) contains every timing and
verification record, artifact and fixture hashes, environment, invocation,
per-process summaries and adjacent-release comparisons. [All result tables](RESULTS.md)
include every fixture, dialect and phase. The [maintainer guide](../../../../tools/benchmark/README.md)
documents the command and its contracts.

## Reproduce

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm benchmark --prepare-only --output work/benchmark-prepared
pnpm benchmark --prepared work/benchmark-prepared/artifacts.json \
  --output work/benchmark-baseline --dialects bash,posix \
  --rounds 4 --iterations 5 --warmup 2
```

Reprepare packages on another machine; the absolute temporary paths in this
retained report describe this run and are not portable installations. Preparation
builds and packs the local candidate and verifies exact registry versions and
integrity. Builds, installation, process startup, setup, correctness checks and
bridge instrumentation are excluded from operation timings. No agent-owned
builds, tests or other benchmarks ran concurrently with the measurements; the
host was not otherwise an exclusive benchmark machine.

Node v24.14.0, Darwin 27.2.0 arm64, Apple M5 Max, 18 logical CPUs. Five fixtures
(representative-1, representative-50, nested-8, nested-64, heredoc) use identical
source bytes across versions and explicit Bash/POSIX settings. The first four
reuse historical source fixtures unchanged; heredoc adds a focused Unicode,
combining-character and comment case. Sources use a common dialect subset, so
this does not measure dialect-specific syntax throughput.

Four fresh process rounds rotate the four artifacts through every order position.
Import/first-parse have one observation per process; warm phases exclude two
warmups and retain five observations. Summaries first take each process median,
then the median and range of those four medians. Warm observations in one process
are correlated. There are 1,600 timing records (1,240 supported, 360 unsupported),
400 separate verification records, 4,920 measured observations, and 2,000 distinct
worker PIDs. Unsupported phases have no fabricated duration.

## Public parsing: the 0.4 change is not cold-only

Values are milliseconds, median [minimum, maximum] of process medians.

| Fixture / dialect / phase              |                0.3.1 |                0.4.0 |                0.5.0 | 0.4 / 0.3.1 |
| -------------------------------------- | -------------------: | -------------------: | -------------------: | ----------: |
| representative-50 / bash / first-parse | 55.02 [50.50, 57.54] | 73.27 [72.58, 76.01] | 75.56 [74.54, 78.77] |       1.33x |
| representative-50 / bash / parse       | 18.97 [17.95, 20.81] | 32.30 [25.51, 34.36] | 35.06 [33.75, 37.00] |       1.70x |
| representative-50 / posix / parse      | 17.33 [17.24, 17.55] | 25.46 [24.84, 28.99] | 24.74 [24.14, 27.10] |       1.47x |
| nested-64 / bash / parse               |    3.95 [3.79, 4.39] |    5.66 [5.33, 7.17] |    6.43 [5.68, 6.98] |       1.43x |
| nested-64 / posix / parse              |    3.52 [3.42, 3.66] |    4.98 [4.63, 6.03] |    5.39 [4.86, 5.85] |       1.42x |

The warm 0.3.1/0.4.0 process-median ranges do not overlap for these large and
nested cases. Public parse performs a different return-model conversion in the
faithful releases: this comparison holds input, comments and dialect request
constant, but does **not** isolate the underlying Go parser or equivalent AST
construction. The data warrants profiling that boundary; it does not assign the
increase to one internal component.

## 0.5: distinguish import cost from steady-state variation

Across all ten fixture/dialect cases, 0.5.0/0.4.0 import ratios are 1.114–1.314x,
an absolute increase of about 0.38–1.25 ms. Eight of ten process-median ranges do
not overlap. First-parse ratios are much smaller, 0.988–1.043x. Import and first
parse are measured in separate processes; adding their medians is not a measured
joint cold-start distribution. Cold means fresh JS/WASM state, not a cold OS
filesystem cache.

Warm parse ratios span 0.893–1.136x, while the identical-runtime local/0.5.0
control spans 0.905–1.131x. For example, Bash representative-50 is 32.30 ms in
0.4.0, 35.06 ms in 0.5.0, and 32.34 ms in the identical-runtime local candidate.
The POSIX version instead measures 25.46, 24.74 and 27.99 ms. This bounded run
does not justify declaring a broad new steady-state regression at 0.5.0, nor does
it prove that every smaller regression is absent. More warmed iterations and
repeated sessions would be needed to resolve small effects.

The local candidate is built from source HEAD
`1301d55d0692170a407e96d3a58c6ee561c183b4`, with benchmark-only working-tree
changes recorded in the artifact metadata. Published 0.5.0 and local have identical
asset sets: 98 of 99 files, including all executable code, WASM and declarations,
match byte-for-byte. Only package metadata differs. Package manifest version
alone is not candidate identity.

## Position snapshots are a separate producer cost

| Bash fixture / phase                     |                   0.4.0 |                   0.5.0 | 0.5 / 0.4 |
| ---------------------------------------- | ----------------------: | ----------------------: | --------: |
| representative-50 / parse-with-positions |    75.46 [66.52, 83.31] |    73.25 [70.48, 76.55] |     0.97x |
| nested-64 / parse-with-positions         |    30.93 [28.22, 33.95] |    30.85 [29.05, 34.33] |     1.00x |
| representative-50 / bounds-root          |    78.30 [70.29, 79.62] |    78.68 [77.94, 80.27] |     1.00x |
| nested-64 / bounds-root                  |    11.39 [10.94, 12.06] |    11.23 [10.65, 11.99] |     0.99x |
| representative-50 / bounds-all           | 904.63 [763.70, 994.71] | 899.11 [783.57, 971.75] |     0.99x |
| nested-64 / bounds-all                   | 751.83 [728.38, 769.11] | 759.40 [733.53, 796.49] |     1.01x |

In 0.5.0, parse-plus-snapshot takes 73.25 ms versus 35.06 ms for parse-only on
representative-50, and 30.85 versus 6.43 ms on nested-64. Those are separate API
measurements, not an instrumented decomposition that can attribute the difference
to one function. Snapshot lookup after construction is cheap: 0.0656 and 0.0098 ms
for all stored nodes, respectively, with zero bridge operations.

The deliberately expensive live all-node diagnostic makes 6,702 bounds calls
for 3,351 nodes in representative-50, with 15,021,836 bytes of request payload;
nested-64 makes 1,120 calls for 560 nodes, with 16,401,974 bytes. This directly
observes repeated subtree transfer. **It is not the current ESLint parsing path:**
parse-with-positions uses one bridge call, and the consumer uses that snapshot
instead of per-node live bounds. A snapshot describes the original parse; live
bounds remain appropriate when current edited-tree semantics are required.

## Traversal and printing

Faithful 0.5.0 walk takes 0.163 ms for representative-50 and 0.032 ms for
nested-64 (Bash), with zero bridge calls. Normalized 0.3.1 walk has different
callback and tree semantics, so the report intentionally does not calculate a
cross-model traversal speedup. 0.4.0 has no public faithful walk.

Default printing takes 35.03 and 6.77 ms for these Bash fixtures. Printing the
prepared edited trees takes 29.18 and 6.68 ms. These separate distributions are
not evidence that editing makes printing faster. Each timed print performs one
bridge call; verification reparses the output and checks the intended marker
edits outside timing. There is no published 0.4 printing baseline. This phase
excludes edit/parse setup and is not a complete ESLint fix-cycle measurement.

## Relation to the consumer slowdown report

The historical [final parsing-release consumer retest](../FINAL-CANONICAL-RETEST.md)
recorded roughly 81 ms warm for 500 lines and 33 ms for 64 nested loops. Those
were built-candidate end-to-end lints, with different consumer/runtime context,
not these freshly downloaded producer measurements. The old 790/763 ms report
was a pre-correction defect and must not be labeled current performance.

The current producer snapshot API alone costs about 73/31 ms on the corresponding
Bash fixtures. This makes snapshot-producing parse a relevant next investigation,
but differences between those historical consumer numbers and these producer
numbers cannot quantify ESLint overhead. Consumer projection, traversal and real
fix-cycle benchmarking belong in `eslint-sh`; its retained traversal-and-printing fix probe
also includes observations and reparses beyond a minimal production rule.

## Bounded next investigations

1. Profile parse-only and parse-with-positions on representative-50 and nested-64,
   separating transport/encoding, Go parse and position collection, decoding,
   validation and snapshot construction. Preserve the same semantic checks and
   pinned package identities; do not assume all fidelity overhead is irreducible.
2. Profile the additional eager import graph in 0.5.0. Any proposal to defer work
   must keep the first real parsing call synchronous and report both import and
   first-use changes, so cost is not merely moved between columns.
3. Characterize live-bounds scaling by depth and subtree size with the retained
   ten-fixture series. The present bytes/call evidence is diagnostic, not a proof
   of universal complexity, and does not justify replacing live semantics with
   stale snapshot values.
4. Before acting on small warm changes, repeat focused cases across more process
   rounds and longer warmup/measurement sequences, keeping the identical-runtime
   control. Evaluate matched end-to-end ESLint scenarios separately in its repo.

This task changes benchmark tooling and documentation only. No hard timing
threshold, optimization, parser API change, or timing-based CI failure gate was
introduced. Correctness tests are deterministic and integrated into `pnpm test`.
