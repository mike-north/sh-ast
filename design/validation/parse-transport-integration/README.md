# Canonical transport integration validation

The final public campaign meets both predeclared aggregate targets on **Node
22.22.1, Darwin 27.2.0/arm64, Apple M5 Max (18 logical CPUs)**. This is a current
machine result, not a claim about an M2, the earlier Linux VM, or downstream
ESLint end-to-end latency.

Accepted main is `87da64fb2f293c2a247bb365399f0150c43ba2ea`;
the measured canonical candidate is
`1431a4f36a82bc4be255baa25ce77d801e9c0d39`. Its Linux artifact comes from the
exact integrated source `f13d3e737444e9c50c22304fb7e038f6544e3ffe`, Actions run
[41962404069](https://github.com/mike-north/sh-ast/actions/runs/41962404069).
[Canonical provenance](canonical-artifact.json) records the archive and WASM
hashes. The committed artifact subsequently passed independent Linux byte
reproduction at [1431a4f](https://github.com/mike-north/sh-ast/actions/runs/41962969403).

## Fixed public campaign

The plan was frozen before timing: eight rounds, each containing `parse` and
`parse-with-positions`, each operation running the two arms in alternating order.
Every arm/operation/round owns a fresh process: 32 processes, five excluded
warmups and 30 measured calls each, 960 raw observations. Both arms use the
701-line/11,270-byte `consumer-m2` fixture, Bash, and `KeepComments: true`.
The fixture name does not identify the hardware used here.

No calibration, tuning, selective repeats, or early stopping occurred. The
campaign ran once during a coordinated quiet slot. Every result is retained in
[public-samples.jsonl](public-samples.jsonl). Within-process observations are
correlated; the aggregation is the median of eight process medians, not a pooled
median of 240 calls and not a confidence interval.

| Public operation         |                Accepted main, ms |          Canonical candidate, ms | Absolute gain, ms |
| ------------------------ | -------------------------------: | -------------------------------: | ----------------: |
| `parseSync`              | 22.066062 [20.880458, 24.710229] |    7.776615 [7.271042, 8.311583] |         14.289447 |
| `parseWithPositionsSync` | 27.218437 [25.390145, 28.969896] | 11.768500 [11.273459, 12.282104] |         15.449938 |

Brackets are the minimum and maximum process medians. Candidate parse is
7.776615 ms, meeting the 10 ms target; every individual process median is also
below 10 ms. The aggregate positions gain is 15.449938 ms, exceeding the parse
gain of 14.289447 ms by 1.160491 ms. This satisfies the predeclared aggregate
comparison. **Two paired rounds miss the positions-gain comparison**, as shown
below; no universal per-run gain is claimed.

| Round | Main parse | Candidate parse | Main positions | Candidate positions | Parse gain | Positions gain | Positions gain >= parse gain |
| ----- | ---------: | --------------: | -------------: | ------------------: | ---------: | -------------: | ---------------------------- |
| 1     |  24.710229 |        8.311583 |      28.969896 |           12.161355 |  16.398646 |      16.808541 | pass                         |
| 2     |  23.654500 |        8.081688 |      27.598375 |           12.102292 |  15.572812 |      15.496083 | **miss**                     |
| 3     |  21.195334 |        7.271042 |      27.640104 |           11.584541 |  13.924292 |      16.055563 | pass                         |
| 4     |  21.590812 |        7.803146 |      27.058000 |           12.282104 |  13.787666 |      14.775896 | pass                         |
| 5     |  22.776812 |        8.083750 |      26.001312 |           11.273459 |  14.693063 |      14.727854 | pass                         |
| 6     |  22.541312 |        7.630187 |      26.101021 |           11.625166 |  14.911125 |      14.475855 | **miss**                     |
| 7     |  20.942459 |        7.687020 |      25.390145 |           11.545938 |  13.255439 |      13.844208 | pass                         |
| 8     |  20.880458 |        7.750084 |      27.378875 |           11.911833 |  13.130375 |      15.467042 | pass                         |

[The full report](public-report.json) retains unrounded values. Separate
[verification workers](public-verification.json) confirm one bridge call and
11,270 input bytes for each operation, 5,801 stored records/nodes, 100 functions,
and 5,701 faithful traversal entries and exits in both arms. Package integrity,
all extracted assets, source archives, and source files are pinned in
[package-artifacts.json](package-artifacts.json); the exact order, environment,
fixture, and executable hashes are in [public-frozen.json](public-frozen.json).
Recorded absolute paths describe the observed run; they are not portable inputs.
Both packages retain version 0.7.0 in package metadata; their identities are the
repository commits above. [An independent campaign audit](independent-campaign-audit.md)
recomputed every raw statistic and checked the full package and source provenance.

## Separate stage diagnostics

After the public campaign, a separate fixed run used eight fresh processes per
arm and operation, five warmups and 30 observations, with the existing stage
instrumentation. These 32 process records are retained in
[stage-samples.jsonl](stage-samples.jsonl); [stage-report.json](stage-report.json)
retains every process-median range. Instrumentation changes cost, so these totals
are not acceptance measurements and are not pooled with the public campaign.

The parser phase includes parser construction/configuration, reader setup, and
upstream `Parser.Parse`. The `encode` field is **WASM export-call duration minus
the measured parser phase**: it includes other native work and call overhead,
not exclusively encoder execution. Input, transfer, and decode are the boundaries
defined in the [harness](../../../tools/benchmark/README.md). The individual
stage medians need not add to the median total.

Accepted main does not expose the parser diagnostic timer. Its parse/encode split
is **unsupported**, represented by absent stage samples/status, never a fabricated
zero. The table shows the observed full WASM call instead.

| Diagnostic, ms     |  Main parse | Candidate parse | Main positions | Candidate positions |
| ------------------ | ----------: | --------------: | -------------: | ------------------: |
| Instrumented total |   25.974906 |        8.915135 |      30.921208 |           13.468583 |
| Input              |    0.087000 |        0.085625 |       0.083323 |            0.085302 |
| WASM export call   |   17.636062 |        5.145916 |      18.937177 |            7.919271 |
| Parser phase       | unsupported |        1.200576 |    unsupported |            1.154944 |
| Export remainder   | unsupported |        3.919942 |    unsupported |            6.799503 |
| Transfer           |    2.014302 |        0.307198 |       2.292615 |            0.346500 |
| Decode             |    6.373771 |        3.254625 |       9.678687 |            5.063146 |

The earlier published-0.7.0/VM measurements remain separately labeled historical
results in [PARSE-TRANSPORT-51.md](../PARSE-TRANSPORT-51.md#measurement).
They are not current matched controls. This campaign introduces no patched timer
into accepted main or the published release.

## Canonical correctness and source scope

- Uncached Node 22.22.1 build/check/test passes: 1,114 Vitest tests, TSD, 39
  tooling tests, and four integration tests, including the large-heap sequence.
- Native Go tests and 15 backport verifier tests pass. Regenerating the five
  syntax schema files yields identical bytes. Public API reports are unchanged.
- [429 supported-input identity cases](identity.json) match exact accepted main
  in isolated packaged processes, including Unicode sentinels/refill, native
  resource boundaries, comments, member order, bytes, errors, and positions.
  This is a bounded corpus, not a claim about arbitrary JavaScript graphs.
- [Twelve public caller cases](canonical-public-calls.json), each repeated 20
  times, pass for both APIs through direct and actual ESLint language dispatch:
  resource refusal and immediate reuse, ordinary source, and U+0080/U+0081.
  This is correctness dispatch evidence, not an ESLint latency benchmark.
- Forty faithful error-only envelopes with immediate successful parses and 20
  legacy error-only envelopes with immediate successful parses pass. Native
  resource refusal remains before File/sidecar composition.
- [The isolated Go 1.26.5 sensitivity record](heap-regression.json) retains both
  print-path and parse-path heap-abort reproductions. Production Go 1.26.10 is
  unchanged and both production suites pass.

Runtime source and WASM remain exactly the measured candidate. After measurement,
a misleading diagnostic comment was clarified. The original measured file is
retained in [reproduction/stages.mjs.txt](reproduction/stages.mjs.txt), and
[comment-only-proof.json](comment-only-proof.json) proves identical non-trivia
JavaScript token kinds/spellings before and after the clarification, while
explicitly retaining the different file hashes. No acceptance rerun followed.

## Reproduction

Use a fresh detached worktree at the measured candidate and Node 22.22.1. Copy the
three `.mjs.txt` scripts below to the required scratch layout, removing only the
`.txt` suffix. The originals are retained byte-for-byte, including their original
relative paths. Preparation runs no measurements; it archives exact commits,
builds each package, creates and safely extracts npm tarballs, and verifies every
package asset. The campaign refuses to overwrite existing raw observations.

```sh
git worktree add --detach /tmp/sh-ast-pr57-repro 1431a4f36a82bc4be255baa25ce77d801e9c0d39
mkdir -p /tmp/sh-ast-pr57-repro/scratch/issue57-campaign
cp design/validation/parse-transport-integration/reproduction/prepare.mjs.txt /tmp/sh-ast-pr57-repro/scratch/issue57-campaign/prepare.mjs
cp design/validation/parse-transport-integration/reproduction/campaign.mjs.txt /tmp/sh-ast-pr57-repro/scratch/issue57-campaign/campaign.mjs
cp design/validation/parse-transport-integration/reproduction/plan.test.mjs.txt /tmp/sh-ast-pr57-repro/scratch/issue57-campaign/plan.test.mjs
cd /tmp/sh-ast-pr57-repro
export NODENV_VERSION=22.22.1
pnpm install --frozen-lockfile
node scratch/issue57-campaign/prepare.mjs
node --test scratch/issue57-campaign/plan.test.mjs
node scratch/issue57-campaign/campaign.mjs --verify
node scratch/issue57-campaign/campaign.mjs --freeze
# Begin once the machine is otherwise quiet.
node scratch/issue57-campaign/campaign.mjs --run
# Separate diagnostics; never use these as acceptance observations.
node tools/benchmark/run.mjs --prepared scratch/issue57-campaign/artifacts.json --output scratch/issue57-stages --rounds 8 --warmup 5 --iterations 30 --fixtures consumer-m2 --dialects bash --phases parse-stages,parse-with-positions-stages
```

Source, canonical artifact, and package hashes should match this record. Absolute
paths and preparation timestamps will differ. New timing values are a new campaign;
they do not replace the retained observations or erase the recorded paired misses.
