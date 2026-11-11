# Published sh-ast 0.9.0 parse receipt

The exact npm **sh-ast 0.9.0** artifact measured **7.885083500 ms** for warm
`parseSync` on the fixed consumer-m2 source, meeting the unchanged **10 ms**
aggregate target. All eight process medians also meet that target. One individual
call took **10.005375000 ms** and remains in the observations; this is not an
every-call guarantee. Complete `parseWithPositionsSync` measured **11.826031000 ms**.

This is one published-artifact campaign on Node **22.22.1**, Darwin **27.2.0 arm64**,
Apple **M5 Max**, 18 logical CPUs and 128 GiB. The fixture name does not identify
the hardware. It supplies published-version stage observations for
[issue #51](https://github.com/mike-north/sh-ast/issues/51); it does not establish
a new positions-gain comparison, public-output identity or API-equivalence audit,
downstream ESLint/M2/VM latency, publication/OIDC behavior or signature verification.
Acceptance of the combined evidence is separate from this measurement record.

## Exact artifact and fixed workload

[Package provenance](provenance.json) and [all 103 extracted asset hashes](package-artifacts.json)
identify the registry package, including its JavaScript, generated assets,
declarations and WASM. No local build substitutes for the published artifact.

- Registry tarball: `https://registry.npmjs.org/sh-ast/-/sh-ast-0.9.0.tgz`,
  1,537,875 bytes.
- Registry integrity:
  `sha512-3KgPAS4CkskmrpAZmszq1MeL1IztGlrsdInh9/oBC8FpETK+jP/Lcsj/YlkSUNH+FGVbX0NA7mue5CbMH/XD+g==`.
- Tarball SHA-256: `96e79eb92ec296346b6e7801642ef28e0d843aaa4f64a66e8b26b6e0f43ba52c`.
- WASM SHA-256: `a0d94a30ed7e401b74126d4f070fd1aa1a0eb18d8583a326f972f177d20c0a54`.
- Node executable SHA-256: `245e0321af97d3c21dd4e7104457334dfe3c3ba7982d0db75363e354565f8cbb`.
- Fixture source SHA-256: `569025b5300d91d0f1297ff3531613e89d4fd5fb067d314e2ac111debe7d1562`,
  11,270 UTF-8 bytes; Bash, `KeepComments: true`, filename `benchmark.sh`.

Registry SHA-512 and SHA-1 matched downloaded bytes. This is content-integrity
evidence, not registry signature or attestation verification. Registry metadata
did not supply a `gitHead` or engine requirement. The measured harness comes from
repository commit `211c5b7d4207b5e409d3b1ed841ad629d5f03fde`; its file hashes are
retained separately from package identity.

The historical description counts **701 entries from `source.split('\n')`**.
The unchanged harness report's `fixtures[].lines` is **700**, counting newline
separators (`source.split('\n').length - 1`). Both describe the same hashed source.
The recorded numeric metadata is preserved, not corrected to another convention.

## Public observations

The plan was fixed before timing. Each operation runs eight serial fresh
processes, each with five excluded warmups and 30 measured calls. Public parse
rounds 0–7 precede public positions rounds 0–7: 16 timing processes and 480 raw
observations. Diagnostics run afterward in another 16 processes with the same
round/warmup/iteration counts; each diagnostic process also performs the existing
untimed ABI-initialization call before warmups. There are four separate untimed
verification workers and 36 distinct worker PIDs overall. Process startup, setup
and correctness checks are outside operation clocks. No fixture is executed as
shell code.

Every duration below is milliseconds. Aggregation takes a median per process,
then the median of those eight medians; observations within a process are
correlated. Ranges are descriptive, not confidence intervals.

| Public operation         |       Median |      Process-median range |   Individual sample range |
| ------------------------ | -----------: | ------------------------: | ------------------------: |
| `parseSync`              |  7.885083500 |   7.703958500–8.053313000 |  6.934875000–10.005375000 |
| `parseWithPositionsSync` | 11.826031000 | 11.426270500–12.779833000 | 10.707667000–20.526500000 |

| Round, one-based | Parse process median | Positions process median |
| ---------------- | -------------------: | -----------------------: |
| 1                |          7.949104000 |             12.779833000 |
| 2                |          7.841250000 |             11.938854000 |
| 3                |          7.767125500 |             12.051229000 |
| 4                |          7.770645500 |             12.331146000 |
| 5                |          7.953249500 |             11.713208000 |
| 6                |          7.703958500 |             11.653292000 |
| 7                |          7.928917000 |             11.426270500 |
| 8                |          8.053313000 |             11.526312500 |

The single public parse call above 10 ms is round 8, observation 30, PID 18037.
It remains in [public-samples.jsonl](public-samples.jsonl), including its original
`10.005375000000015` value. Positions' 20.5265 ms maximum is likewise retained.
There was one campaign with no calibration, selective repeats, early stopping,
discarded samples or target changes. Both public and diagnostic commands exited 0.
[The public report](public-report.json) retains all summaries and verification
records as well as the raw observations.

## Separate stage diagnostics

[All diagnostic observations](stage-samples.jsonl) and the
[diagnostic report](stage-report.json) remain separate from public acceptance
measurements. All six diagnostic stage fields are supported in this package.

| Diagnostic boundary   | Parse median | Positions median |
| --------------------- | -----------: | ---------------: |
| Instrumented total    |  7.625458000 |     12.300552000 |
| Input                 |  0.079260500 |      0.081364500 |
| Full WASM export call |  4.340885500 |      6.961895750 |
| Parser plus setup     |  0.947648000 |      0.907200000 |
| Export remainder      |  3.396607500 |      5.981955250 |
| Transfer              |  0.295937250 |      0.320583500 |
| Decode                |  2.686208250 |      4.667427250 |

- Parser timing includes construction/configuration, reader setup and upstream
  `Parser.Parse`.
- The `encode` field is the full WASM export-call duration minus the measured
  parser phase. It includes other native work and call overhead; it is **not an
  exclusive encoder timer**.
- Input ends at the first linear-memory allocation. Transfer covers pre-export
  memory copies plus response lookup/text decoding up to the first `JSON.parse`.
  Decode runs from that `JSON.parse` through restoration, validation and any
  snapshot construction to return. See the [harness contracts](../../../../tools/benchmark/README.md).

Per-observation export remainder accounting and total component accounting match
the retained values. Independently aggregated stage medians need not sum to the
median total. Instrumented parse total is lower than the separate public parse
total in this campaign; these separate-process distributions do not establish
causal probe cost and are never pooled. Unsupported boundaries in other versions
remain absent/unsupported, never synthetic zeroes.

All four verification workers report one bridge call with 11,270 input bytes,
5,801 stored records/nodes, 100 functions and 5,701 traversal entries/exits.
The raw reports retain this bounded workload accounting; it is not a replacement
for a cross-version output-identity corpus.

## Host context and historical scope

The frozen readiness rule used a fixed one-second CPU-time-delta sample and held
on recognized build/test runtimes using at least half a logical CPU. The actual
sample lasted 1,085.018125 ms, with no such busy runtime. Preflight load averages
were 6.642578125 / 6.943359375 / 9.287109375. Persistent macOS PerfPowerServices
activity was explicitly recorded at 189.858580% sampled CPU; host activity was
not zero. Post-campaign context at 19:12:22 UTC recorded load averages
7.932128906 / 7.685546875 / 9.308105469 and PerfPowerServices at 189.8% lifetime
average CPU. That post statistic differs from preflight deltas; neither snapshot
is continuous campaign monitoring. No other process was controlled.

The separate [accepted #57 campaign](../../parse-transport-integration/README.md)
compared exact accepted main `87da64f` with canonical candidate `1431a4f` in two
locally packaged, commit-identified arms. Both packages retained version 0.7.0;
they were not published 0.9.0. Its accepted aggregate parse/positions gains were
14.289447250 / 15.449937750 ms, with paired positions-gain misses in rounds **2
and 6**. Its bounded output/API evidence remains a historical record.

This published receipt uses one actual registry artifact, later source changes
and a different WASM hash. It retains the host/runtime/fixture and per-process
aggregation but uses phase-major ordering instead of alternating paired arms.
Do not subtract unmatched historical/current timings to claim a fresh gain or
extend historical correctness evidence to an unmeasured output-identity audit.

## Metadata preservation

Both JSONL files are byte-identical copies of the original observations. Only
execution-path strings were normalized in the reports and prepared manifest:
original repository-root prefixes become `<repo>`, prepared-directory prefixes
become `<prepared>`, public/stage output prefixes become `<public-output>` /
`<stage-output>`, and the Node executable becomes `<node-22.22.1>`. The same
directory mapping applies to invocation-relative paths.

[metadata-normalization.json](metadata-normalization.json) retains original,
path-only and final formatted file SHA-256 values, every changed JSON string
location and common non-string-token digests. Path replacement operated on JSON
string tokens only; repository formatting then reflowed report whitespace.
All numeric tokens, ordering and structural delimiters remain unchanged. The
path-only non-string-byte digests are also retained for that intermediate step.
No observations or metadata fields were dropped. Private execution
environment and process-path records are not part of this public receipt.

## Reproduce the workload

Use a checkout containing this evidence and the recorded harness, with Node
22.22.1. The example below requires a fresh preparation directory, downloads the
registry artifact with lifecycle scripts disabled, rehydrates the retained asset
inventory and verifies bytes/entrypoints using the existing harness. It performs
no local build. Preparation and downloads are outside measured work.

```sh
export NODENV_VERSION=22.22.1
mkdir work/published-090-repro
npm pack sh-ast@0.9.0 --ignore-scripts --json --pack-destination work/published-090-repro
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { extractPackage, verifyPrepared, hash } from './tools/benchmark/artifacts.mjs';
const evidence = 'design/validation/performance/published-0.9.0-2026-11-05';
const provenance = JSON.parse(readFileSync(join(evidence, 'provenance.json')));
assert.equal(process.version, 'v22.22.1');
assert.equal(hash(readFileSync(process.execPath)), provenance.nodeExecutableSha256);
for (const [path, digest] of Object.entries(provenance.harnessFileSha256))
  assert.equal(hash(readFileSync(path)), digest);
assert.equal(hash(readFileSync('tools/benchmark/fixtures/consumer-m2.json')),
  provenance.fixture.jsonFileSha256);
const cache = resolve('work/published-090-repro');
const retained = JSON.parse(readFileSync(join(evidence, 'package-artifacts.json')));
const artifact = retained.artifacts[0];
artifact.tarball = join(cache, 'sh-ast-0.9.0.tgz');
artifact.packageRoot = join(cache, 'package');
artifact.entry = join(artifact.packageRoot, 'dist/index.js');
extractPackage(artifact.tarball, artifact.packageRoot);
const prepared = { ...retained, cache, preparedAt: new Date().toISOString() };
verifyPrepared(prepared);
writeFileSync(join(cache, 'artifacts.json'), JSON.stringify(prepared, null, 2) + '\n', { flag: 'wx' });
JS
```

On a suitable quiet host, freeze a new input/argv/readiness record before timing.
Require new output directories: the existing standard runner truncates its raw
output file if an old directory is reused. These are the measured workload
commands with only the prepared/output locations rebound; they do not reserve the
host or automatically perform the original preflight. Run serially and stop on
any failure. Preserve partial observations; a later attempt is a separate record.

```sh
set -e
mkdir work/published-090-repro-public
env -u NO_COLOR NX_PARALLEL=2 NODENV_VERSION=22.22.1 nice -n 10 node tools/benchmark/run.mjs \
  --prepared work/published-090-repro/artifacts.json --output work/published-090-repro-public \
  --rounds 8 --warmup 5 --iterations 30 --fixtures consumer-m2 --dialects bash \
  --phases parse,parse-with-positions
mkdir work/published-090-repro-stages
env -u NO_COLOR NX_PARALLEL=2 NODENV_VERSION=22.22.1 nice -n 10 node tools/benchmark/run.mjs \
  --prepared work/published-090-repro/artifacts.json --output work/published-090-repro-stages \
  --rounds 8 --warmup 5 --iterations 30 --fixtures consumer-m2 --dialects bash \
  --phases parse-stages,parse-with-positions-stages
```

Absolute paths, PIDs and preparation timestamps will differ. New timings remain
a new campaign and cannot replace this retained run or erase its outliers.
