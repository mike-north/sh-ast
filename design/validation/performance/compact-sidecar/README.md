# Compact position sidecar: canonical matched comparison

The compact sidecar reduces M2 public parse-with-positions from **52.08 ms to
29.75 ms**, no-rule ESLint verification from **59.36 ms to 40.14 ms**, and the
snapshot response from **2,899,541 to 1,298,435 bytes (55.22% smaller)**. These
latencies are medians of six process medians; each process excludes five warmups
and measures thirty calls. Paired ratios below preserve each alternating round.

The separate historical target compares actual published 0.3.1 public parsing
with candidate public parsing plus snapshots: **31.56 ms versus 25.47 ms**,
median paired ratio **79.65%** (range **77.45–87.04%**). This meets the bounded
latency target in this run, but the APIs produce different outputs: a normalized
tree versus a faithful tree plus an original-position snapshot. It is not an
equal-work speedup claim. The candidate's 25.47 ms historical-target result and
29.75 ms main-comparison result came from different fresh-process groups; their
variation is real and they must not be substituted for one another or selectively
combined with another baseline.

## Identities and scope

- Baseline: `1e96b49434e05b03c9f9fd8a001151186af1668d`, accepted post-streaming main.
- Candidate: `84025343c147dc8c9efe8ad93789e74fdb609218`, exact reviewed source with
  the canonical Linux CI binary. Both packages were archived, compiled, API-extracted,
  packed and verified independently; no local WASM was built for this campaign.
- Harness: `f8f61c5`, with complete file hashes in the report. The default #35
  identical-JavaScript check is preserved. This experiment explicitly approves
  only three changed JavaScript files: `dist/syntax-snapshot.js`, `dist/syntax.js`
  and the documentation comment in `generated/syntax-schema.js`. Both content
  hashes for each file are pinned in [reviewed-javascript-changes.json](reviewed-javascript-changes.json).
  Full package inventories and extracted bytes are separately verified.
- Consumer: accepted eslint-sh `2102a2469fefacac71f564779c4a3afac09a81c1`, plugin
  0.5.0, built once and copied identically to both arms. This differs from #35's
  consumer `6747c0c`; values across those campaigns are **not producer-only
  comparisons**. The current experiment makes its causal comparisons within
  the matched pair, using unchanged no-rule and probe-rule configurations.
- Runtime: Node **22.22.1**, Darwin arm64, OS 27.2.0, Apple M5 Max. TypeScript 6.0.3
  built both packages and the consumer. ESLint 10.7.0, @eslint/core 1.2.1 and
  @eslint/plugin-kit 0.7.2 satisfy the consumer's dependency constraints. All 70
  runtime dependency packages and resolution edges were copied and frozen.

The archived consumer source lock is
`dc8dd1defb075320bfdd9556bce72cd3dc3cff07952fede6e58d8c949f437a06`;
the existing installation lock is
`a3cba62a5e742534616bfbeb332a48d10a69832b8e370e02c1fd0a234b9006fd`.
They **differ**. This is a comparison using the recorded actual frozen dependency
closure, not a claim that dependencies were installed from the archived source
lock. Both arms share that exact closure. No consumer checkout was modified.

All producer requests use Bash, retained comments and filename `benchmark.sh`.
No-rule lint uses `rules: {}` and still makes one actual parse-with-positions call.
Probe lint adds one explicit visitor counting every node, function and marker.
No recommended-rule suite or arbitrary project ruleset is measured.

Raw bridge time includes ABI allocation, input copies, Go execution, UTF-8 result
conversion and free; it excludes JSON decoding. **No pure exported-WASM or
internal Go parser timer was collected.** Public phases include their normal
transport decoding and snapshot construction. Live bounds and printing are
untimed verification work, never part of the measured call budget.

## Paired process distributions

Times are milliseconds. Each range spans process medians, not a confidence
interval. The ratio is the median of the six paired candidate/baseline ratios;
its range preserves the minimum and maximum paired ratio.

| Fixture / phase                              | Baseline median [range] | Candidate median [range] |    Paired ratio [range] |
| -------------------------------------------- | ----------------------: | -----------------------: | ----------------------: |
| consumer-m2 / raw-parse                      |  15.252 [15.073–15.686] |   15.175 [15.098–15.602] |  99.18% [96.69–102.48%] |
| consumer-m2 / raw-parse-with-positions       |  31.464 [28.156–35.074] |   19.772 [18.011–23.376] |   62.35% [59.11–74.43%] |
| consumer-m2 / parse                          |  22.892 [21.241–23.980] |   23.687 [22.486–24.691] | 102.84% [97.14–116.24%] |
| consumer-m2 / parse-with-positions           |  52.084 [49.963–57.815] |   29.751 [28.454–32.678] |   56.60% [49.21–65.40%] |
| consumer-m2 / lint-no-rules                  |  59.358 [57.777–60.735] |   40.135 [37.812–40.728] |   66.72% [64.32–69.84%] |
| consumer-m2 / lint-probe-rule                |  62.819 [57.264–70.325] |   40.816 [36.204–44.129] |   65.05% [57.40–68.84%] |
| representative-50 / raw-parse                |     8.123 [7.856–8.522] |      8.192 [7.806–8.756] | 100.09% [93.88–106.31%] |
| representative-50 / raw-parse-with-positions |  17.112 [16.980–18.954] |     9.743 [9.606–10.974] |   57.27% [56.19–58.05%] |
| representative-50 / parse                    |  11.414 [10.920–11.977] |   11.285 [10.943–15.454] |  98.42% [94.19–129.74%] |
| representative-50 / parse-with-positions     |  27.985 [27.057–29.385] |   14.442 [13.894–14.971] |   51.68% [48.86–53.31%] |
| representative-50 / lint-no-rules            |  33.327 [32.931–34.969] |   19.946 [19.595–20.805] |   59.25% [58.82–61.40%] |
| representative-50 / lint-probe-rule          |  34.886 [33.873–37.530] |   21.956 [20.638–25.751] |   62.32% [59.50–71.69%] |
| nested-64 / raw-parse                        |     1.985 [1.736–2.091] |      1.922 [1.576–2.011] |  94.50% [83.15–101.55%] |
| nested-64 / raw-parse-with-positions         |     5.927 [5.375–6.402] |      2.060 [1.862–2.204] |   34.21% [32.75–36.72%] |
| nested-64 / parse                            |     2.503 [2.299–2.732] |      2.296 [2.234–2.763] |  97.30% [86.49–101.52%] |
| nested-64 / parse-with-positions             |   10.607 [9.476–11.646] |      3.534 [2.809–3.829] |   33.30% [29.64–35.80%] |
| nested-64 / lint-no-rules                    |  11.150 [10.140–13.285] |      3.796 [3.386–5.264] |   34.51% [32.35–39.63%] |
| nested-64 / lint-probe-rule                  |   10.575 [9.826–11.833] |      3.736 [3.513–3.928] |   34.64% [32.64–39.97%] |

Plain parse is a control: M2 public parse was 22.892 → 23.687 ms, with paired
ratios spanning 97.14–116.24%. The campaign does not establish a plain-parse
improvement. Six processes per arm do not justify a statistical significance or
guaranteed latency claim. Within-process samples are correlated. Team builds,
tests and other benchmarks were held during the quiet window; unrelated host
activity was not controlled.

## Packet sizes and semantic equivalence

| Fixture           | Plain response bytes, both arms | Snapshot baseline bytes | Snapshot candidate bytes | Reduction |
| ----------------- | ------------------------------: | ----------------------: | -----------------------: | --------: |
| consumer-m2       |                       1,142,011 |               2,899,541 |                1,298,435 |    55.22% |
| representative-50 |                         632,125 |               1,742,303 |                  723,592 |    58.47% |
| nested-64         |                         111,070 |                 518,537 |                  124,654 |    75.96% |

Snapshot wire bytes intentionally differ. Complete raw File values, complete
public Files, every stored Node's snapshot and independent live upstream bounds,
print/reparse smoke results and visitor counts agree. Plain parse raw responses
remain byte-identical. M2 contains 100 functions and 5,801 Nodes; representative-50
has 3,351 Nodes/50 markers/50 functions; nested-64 has 560 Nodes/one marker/one
function. M2 has no BENCHMARK_TOKEN marker literals. Probe traversal visits all
Nodes and both lint configurations produce zero diagnostics. Each verification
operation makes exactly one expected parse bridge call.

The main campaign retains **36 verification workers, 216 fresh timing workers
and 6,480 samples**, plus 18 summaries. The historical target adds **two
verification workers, 12 fresh timing workers and 360 samples**, with one
separate summary: 228 unique timing PIDs and 6,840 samples in total. Both target
arms preserve all 100 M2 functions and issue exactly one parse call. The published
normalized AST also contains 5,801 stored records in this run; it is not assigned
the faithful Node contract. No unsupported API was substituted.

## Evidence and provenance

- [report.json](report.json): complete main environment, fixtures, source/package
  inventories, frozen consumer/dependencies, harness hashes, verification, samples,
  process summaries and paired values.
- [samples.jsonl](samples.jsonl) and [verification.jsonl](verification.jsonl):
  incremental main worker records.
- [historical-target.json](historical-target.json) and
  [historical-samples.jsonl](historical-samples.jsonl): actual published 0.3.1
  identity/SRI/assets, separate output contract, verification and raw target data.
- [provenance.json](provenance.json): pinned producer/source/CI artifact identities
  and hashes of retained files. Baseline binary derives from Linux run 41534214435,
  artifact 13182089937; candidate from run 41566344176, artifact 13199281891.
- [package-preparation.mjs.txt](package-preparation.mjs.txt): exact executed local
  archive/build/pack script; it never builds WASM.

The source and harness were audited, recomputing all 19 summaries,
228 process identities and 6,840 raw samples, then reverified final package,
dependency and harness hashes. These are observations of this bounded campaign;
no publication or merge claim is implied. Absolute staging paths record historical
provenance and need not remain available for later reproduction.

## Reproduction

Follow [the harness instructions](../../../../tools/benchmark/STREAM-ENCODING.md).
Copy the exact preparation script to `work/compact-packages/prepare.mjs` and
run from the repository root using Node 22.22.1 and installed build tools. Use new
output directories. Archive the exact consumer commit above and build once; freeze
an explicitly recorded compatible runtime dependency closure. This run used the
existing `<consumer>` installation read-only, with the
lock mismatch documented above. An earlier attempted dependency path had been
removed; that failed staging directory was retained and was not measured.

Prepare with `--reviewed-javascript-changes` pointing to the exact reviewed map
and `--compact-sidecar`. Run `--verify-only` before measurement. Supply an actual
verified published 0.3.1 manifest through `--historical-prepared`; this run reused
an existing verified registry artifact, never a local version-labeled substitute.
The runner performs no downloads. In a coordinated quiet window, use
`--rounds 6 --warmup 5 --iterations 30`. The runner repeats verification and
revalidates all immutable files afterward. Do not reuse manifests after changing
any artifact or dependencies. No additional tuning or timing was performed after
this campaign.
