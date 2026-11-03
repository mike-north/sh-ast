# Matched streaming-encoder experiment

This bounded experiment compares two exact faithful producer packages with one
identical ESLint consumer build. It reuses the existing artifact verification,
public phase adapters, timing boundaries and fixture sources. It does not compare
general ESLint performance. An optional, separate historical latency target is
described below; it does not participate in the matched six-phase comparison.

The six separately warmed phases are raw bridge parse/parse-with-positions,
public parse/parse-with-positions, no-rule `Linter.verify`, and `Linter.verify`
with one explicit visitor rule. No-rule lint has `rules: {}`. Probe lint counts
every visited node, function and `BENCHMARK_TOKEN` literal; this is a specified
rule workload, not a representative claim about arbitrary user rules. Both use
`language: 'sh/sh'`, `files: ['**/*.sh']` and filename `benchmark.sh`. The consumer
uses Bash and retains comments, matching the producer requests.

Raw bridge time includes ABI allocation, input copies, Go execution, response
conversion to a UTF-8 JavaScript string, and free. Source/options encoding happens
before the clock; JSON decoding and verification happen afterward. This is not
pure parser time or just the WASM export duration. Public timings include their
normal decode/snapshot work. No phase prewarms a different phase's runtime.

## Prepare outside the measurement window

Use exact baseline `80bdcd9f99e2ad5e48dc8d15af13c8470f12794e` and the final reviewed
candidate, each with its verified Linux CI WASM. Build/API-generate and pack each
package before preparation. Never substitute a local WASM. Retain the CI run,
artifact, source commit, archive digest, extracted WASM digest and rebuild-match
record alongside the resulting report. The harness verifies package bytes; it
does not authenticate a user-supplied CI provenance assertion.

Provide two standard `tools/benchmark/artifacts.mjs` manifests, each identifying
one local artifact with exact `gitHead`, `sourceAssets`, `gitStatus`, `entry`,
`packageRoot`, `version`, `tarball`, `tarballSha256`, `integrity` and all `assets`.
Existing prepared manifests can be reused if their frozen hashes still match.
For a fresh local-only package, use `npm pack --ignore-scripts --json` after the
build, `extractPackage` from artifacts.mjs, and `files` from the preparation module
to inventory the extraction. No registry-history downloads are needed. Keep
entrypoints/declarations: `verifyPrepared` verifies the complete advertised package.
Before timing, compare runtime JS inventories and require only the WASM to differ
for this Go-only optimization. Preserve any actual difference instead of assuming
equal versions imply equal code.

Freeze accepted consumer `6747c0cb6aaea416c35296ded2694cfb4fad913e` once:

```sh
NODENV_VERSION=22.22.1 node --version
NODENV_VERSION=22.22.1 node tools/benchmark/stream-encoding-prepare.mjs \
  --baseline /absolute/baseline/artifacts.json \
  --candidate /absolute/candidate/artifacts.json \
  --consumer-root /Users/mnorth/Development/eslint-sh \
  --consumer-ref 6747c0cb6aaea416c35296ded2694cfb4fad913e \
  --dependency-root /Users/mnorth/Development/eslint-sh/.claude/worktrees/sh-ast-05-perf \
  --output /absolute/new-experiment
```

The source revision is archived, regardless of the consumer checkout's current
branch. The dependency installation must already contain the intended versions;
resolved versions, source paths, lock hash and copied runtime package hashes are
retained. Dependencies, including installed peers, are copied into isolated
staging with their actual transitive resolution preserved. The compiler/types can
read the existing installation during the single build, but no consumer checkout
is modified. Identical emitted consumer files and frozen runtime dependencies are
used in both arms; only the producer package resolution differs. Output paths must
be new to prevent mixing old and new experiments.

Validate without timing first:

```sh
NODENV_VERSION=22.22.1 node tools/benchmark/stream-encoding-run.mjs \
  --prepared /absolute/new-experiment/prepared.json \
  --verify-only --output /absolute/new-verification
```

Default fixtures are exact consumer M2, representative-50 and nested-64. Explicit
`--fixtures /absolute/file.json` can be repeated for a small smoke check. Before
timing, both arms must agree on complete raw response hashes, complete File and
all-node snapshot hashes, visited counts, and bounds/print smoke results. M2 must
contain 100 functions and 5,801 stored Nodes; probe lint must visit all 5,801.
Every phase, including no-rule lint, must actually issue exactly one expected
bridge operation. Verification instrumentation never runs in latency workers.

## Measure only in an agreed quiet window

```sh
NODENV_VERSION=22.22.1 node tools/benchmark/stream-encoding-run.mjs \
  --prepared /absolute/new-experiment/prepared.json \
  --rounds 6 --warmup 5 --iterations 30 \
  --output /absolute/new-measurement
```

All workers run serially in fresh processes; baseline/candidate order alternates
by round within each fixture/phase. Verify-only checks are repeated before timing.
Warmups run the same operation and are excluded; assertions occur after clocks.
No forced GC or allocation instrumentation is used. Bounds and printing are
untimed smoke checks only. Avoid concurrent builds/tests/benchmarks and record
unavoidable host activity separately.

`verification.jsonl` and `samples.jsonl` are written incrementally. A successful
campaign writes `report.json` with runtime/CPU identity, fixture source hashes,
harness hashes, package/dependency provenance, raw samples and paired process
medians. An interrupted campaign has no final report and is incomplete. Summaries
retain process-level ranges and each paired ratio/delta; within-process samples
are correlated. The <=30% investigation target is not a performance assertion.

Run small outcome tests with:

```sh
NODENV_VERSION=22.22.1 node --test tools/benchmark/stream-encoding.test.mjs
```

## Compact sidecar comparison (#36)

The defaults above retain #35's identical-JavaScript and raw-response checks.
For #36 use baseline `1e96b49434e05b03c9f9fd8a001151186af1668d` and the final
reviewed canonical candidate. Refresh the accepted consumer revision before
preparation; use one frozen build and dependency closure for both arms.

After reviewing the actual emitted JavaScript diff, create a JSON file mapping
each changed path to its exact baseline and candidate SHA-256 values, for example:

```json
{
  "dist/syntax-snapshot.js": {
    "baseline": "<reviewed baseline file SHA-256>",
    "candidate": "<reviewed candidate file SHA-256>"
  }
}
```

Pass `--reviewed-javascript-changes /absolute/reviewed-changes.json` and
`--compact-sidecar` to preparation. The actual complete changed-JavaScript map
must equal this declaration, including both hashes. Added or deleted JavaScript
paths, undeclared changes, stale hashes, and declared changes that did not happen
fail. The declaration is saved and rechecked before and after measurement;
complete package inventories remain independently verified. It is not a wildcard
permission for a decoder file to change again after review.

Compact mode permits different raw response hashes and byte counts only for
`raw-parse-with-positions`. Both sizes and hashes remain in verification records
so payload reduction is visible. Complete raw File, public File, all-node snapshot,
smoke, and visitor-count equality remain mandatory. Plain parse retains exact raw
response equality. Every public snapshot occurrence is also checked against live
upstream `nodePos`/`nodeEnd` outside timing. No raw metric is relabeled pure WASM time.

## Optional historical M2 latency target

Supply `--historical-prepared /absolute/artifacts.json` to the runner only when an
actual published `sh-ast@0.3.1` artifact is already prepared using the existing
artifact tooling. A matching version label on a local build is rejected. Registry
tarball URL, SRI, tarball hash and extracted asset hashes are retained and verified.
No target package is downloaded or synthesized by the measurement runner.

This separate comparison uses the existing generic worker for both arms:
published 0.3.1 public `parseSync` versus candidate public
`parseWithPositionsSync`, with identical M2 source, Bash, comment-retention intent
and filename. The normalized legacy tree and faithful tree plus snapshot are
different outputs. Ratios are a latency target, never an equal-work claim. Both
must parse once and preserve all markers and 100 functions; only the faithful
candidate must have 5,801 Nodes. An unavailable API fails the target.

The default six fresh-process alternating pairs, five warmups and thirty calls
use the main runner's numeric options. `--verify-only` also checks this target
without timing it. Historical samples and the explicitly unequal-output summary
go to `historical-samples.jsonl` and `historical-target.json`. The main
`report.json` is written first and remains valid if the optional target fails;
such a failure is recorded separately and sets a nonzero process exit code.
