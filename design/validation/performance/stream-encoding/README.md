# Streaming syntax encoding: canonical matched comparison

The canonical streaming candidate reduces M2 raw-bridge parse-with-positions from
82.58 ms to 26.78 ms, public parse-with-positions from 100.10 ms to 43.08 ms, and
no-rule ESLint verification from 108.28 ms to 50.37 ms. These are medians of six
process medians, with 30 measured calls after five excluded warmups per process.

The median paired M2 raw-bridge ratio is **32.37% of baseline**, so the <=30%
investigation target was **not achieved by this measured metric**. Individual
paired ratios span 29.68–33.28%; selecting the fastest pair would misrepresent
the result. Root accepted this outcome based on approximately 68% raw-bridge,
57% public snapshot and 53% no-rule consumer reductions, preserved correctness,
and bounded scope. No further optimization or #36 protocol/fusion work was added.

## Matched identities and work

- Baseline: accepted main `80bdcd9f99e2ad5e48dc8d15af13c8470f12794e`, including
  wrapper assignments, in-place decoder and brace classification.
- Candidate: `e6b57a42a9ead1a37ba87af725b3156da88908c7`, canonical streaming WASM.
  Every packaged JavaScript file is identical between arms; independent review
  confirmed the sole package-byte difference is `shim/sh-ast.wasm`.
- Consumer: accepted eslint-sh `6747c0cb6aaea416c35296ded2694cfb4fad913e`, plugin
  0.5.0, built once and copied identically to both arms. ESLint 10.7.0 and all 70
  resolved runtime packages were frozen, including peer dependencies. Source and
  installed dependency lock hashes agree. No consumer checkout was modified.
- Runtime: Node **22.22.1**, actual executable
  `<node>`, Darwin arm64, OS 27.2.0,
  Apple M5 Max. TypeScript 6.0.3 built both producer packages and the consumer.
- Harness: `e24067bff7c72414323e4a7a46a6a7997b2562b6`. All final harness file
  hashes are retained in the report. The earlier preparation smoke preceded a
  one-line whitespace-only Prettier wrap in the preparer; independent hash
  reconstruction verified that delta. The final campaign reran verification
  with the committed harness and revalidated all frozen artifacts afterward.

Raw bridge wall time includes input allocation/copy, Go execution, UTF-8 response
conversion to a JavaScript string, and free. It excludes JSON decode and public
snapshot construction. **No timer around only the exported WASM function or
internal Go parser was collected.** Public phases measure the full API. These
metrics must not be relabeled as pure parser time or compared as interchangeable
clocks against historical prototype timings.

All producer phases use Bash, retained comments and filename `benchmark.sh`.
The same consumer language/configuration runs in each arm. No-rule lint has
`rules: {}`; verification proved it still performs one real parse-with-positions
bridge call. Probe-rule lint adds one explicit accept-all visitor counting nodes,
functions and markers. It measures that specified rule, not an arbitrary project
ruleset or a general claim about total ESLint performance.

## Process distributions

Times are milliseconds. Brackets show the minimum and maximum **process median**,
not a confidence interval. Paired ratio is the median candidate/baseline ratio
within the six alternating rounds.

| M2 phase                        | Baseline median [range]   | Candidate median [range] | Paired ratio |
| ------------------------------- | ------------------------- | ------------------------ | ------------ |
| Raw bridge parse                | 45.999 [44.545–47.422]    | 14.772 [14.383–15.121]   | 32.03%       |
| Raw bridge parse-with-positions | 82.582 [81.134–87.611]    | 26.781 [26.002–27.080]   | 32.37%       |
| Public parse                    | 51.056 [48.859–60.904]    | 19.867 [19.319–19.986]   | 38.79%       |
| Public parse-with-positions     | 100.102 [98.244–105.798]  | 43.077 [42.383–44.473]   | 43.34%       |
| Lint, no rules                  | 108.283 [106.650–113.250] | 50.368 [50.216–50.887]   | 46.52%       |
| Lint, one probe rule            | 108.407 [105.347–111.501] | 50.839 [49.742–51.857]   | 46.66%       |

| Additional fixture/phase              | Baseline median [range] | Candidate median [range] | Paired ratio |
| ------------------------------------- | ----------------------- | ------------------------ | ------------ |
| Representative-50 raw bridge snapshot | 52.736 [52.210–65.127]  | 16.425 [16.351–17.028]   | 31.04%       |
| Representative-50 public snapshot     | 66.442 [63.089–69.048]  | 26.943 [26.101–27.273]   | 40.56%       |
| Representative-50 no-rule lint        | 71.351 [69.599–73.184]  | 31.834 [31.444–34.719]   | 44.96%       |
| Nested-64 raw bridge snapshot         | 22.551 [22.029–23.099]  | 4.902 [4.715–4.975]      | 21.52%       |
| Nested-64 public snapshot             | 26.592 [26.034–27.684]  | 8.850 [8.702–8.998]      | 33.42%       |
| Nested-64 no-rule lint                | 27.689 [27.396–27.805]  | 9.725 [9.490–9.783]      | 35.08%       |

All 18 phase/fixture summaries and raw pairs are in [report.json](report.json).
The campaign contains **216 fresh timing workers, 6,480 measured calls and 36
separate verification workers**. Arms alternate order; all workers run serially.
The team held builds/tests/other benchmarks during measurement. Unrelated host
activity was not controlled. Within-process samples are correlated; no statistical
significance or guaranteed latency claim is made. Prior decoder gains are present
on both sides and are not attributed to streaming.

## Equivalence and provenance

All paired raw responses, complete Files, all-node snapshots and bounds/print
smoke results match. Every operation issues exactly one expected bridge call.
M2 contains 100 functions and 5,801 Nodes, and probe lint visits all 5,801.
Representative-50 contains 3,351 Nodes/50 markers; nested-64 contains 560 Nodes/one
marker. No-rule and probe-rule lint return zero diagnostics. Bounds and printing
are untimed equivalence checks only.

[report.json](report.json) retains package tarball hashes, complete package assets,
source archives and inventories, frozen consumer/dependency identities and links,
fixture source hashes/options, runtime identity, harness hashes, verification,
raw samples and summaries. [samples.jsonl](samples.jsonl) and
[verification.jsonl](verification.jsonl) retain the incremental worker records.
Absolute staging paths are historical provenance, not portability promises.

Baseline WASM SHA256 is
`eb13ed12954c6220cf5de70019a3a628b90bd8012d38d33321fb7c4a6e9197e7`, from
[Linux run 41529513788](https://github.com/mike-north/sh-ast/actions/runs/41529513788),
artifact 13181386622. Its source and archive identity are retained in
[brace provenance](../../brace-classification/canonical-artifact.json).
Candidate WASM SHA256 is
`c2adf9c8f0df30a16ce26bdcdde2b4050d094e0ed6c347650d7bc0e18ea9b0c9`, from
[Linux run 41534214435](https://github.com/mike-north/sh-ast/actions/runs/41534214435),
artifact 13182089937, source `25630a596f848b3f2ab6478ca34de66c23e28091`.
Candidate archive SHA256 is
`b22918c5c78efe73797e54206a24bed99324514c6fa4ee344298693d8c8efdd3`;
the binary contains 4,537,470 bytes. Both builds use Go 1.26.5/Binaryen 131.

## Reproduction

Follow [the bounded experiment instructions](../../../../tools/benchmark/STREAM-ENCODING.md)
for preparation, verification-only and quiet timing. The exact local package
preparation script is retained as [package-preparation.mjs.txt](package-preparation.mjs.txt).
From a checkout containing both producer revisions and installed build tools,
copy it to `work/stream-packages/prepare.mjs` and execute from the repository
root with `NODENV_VERSION=22.22.1 node`. Use fresh staging directories: the script
archives exact revisions, compiles/API-generates without Nx cache, npm-packs with
scripts disabled and verifies extracted packages. It never builds WASM.

The consumer preparation command takes the resulting two manifests and the exact
consumer SHA above. This run used the existing accepted consumer dependency
installation at `<dependency-checkout>`; the lock hash is recorded.
Then run verification-only, followed by `--rounds 6 --warmup 5 --iterations 30`
in an agreed quiet window. Do not reuse a prepared package after changing source,
WASM or dependencies. Six tests-first harness outcome tests and independent source,
artifact, verification and all-sample audits passed before accepting this report.
