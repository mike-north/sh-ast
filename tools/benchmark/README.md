# Producer performance benchmarks

Run from the repository root with the repository's Node/pnpm toolchain:

```sh
pnpm install --frozen-lockfile
pnpm benchmark --output work/benchmark
```

The command builds the local candidate and generates its API declaration rollups,
then downloads the actual published `sh-ast`
0.3.1, 0.4.0, 0.5.0 and 0.7.0 packages, and packs the local candidate with lifecycle hooks
disabled. Extraction occurs in a new OS temporary directory; no benchmark
packages are added to the workspace or dependency lockfile. Archive members must
stay under `package/`; that prefix is stripped into a fresh directory using local
ownership and umask. Unexpected paths, symbolic links and special files are rejected. This
is a package-layout boundary, not a sandbox for the package code subsequently
executed by workers. Registry SRI and exact
manifest versions are checked. Every advertised runtime and declaration entrypoint
must exist in the extracted package. The report records tarball SHA-256, every extracted
asset hash, candidate source hashes, Git HEAD and working-tree status. The package
version alone does not identify the local candidate. Equal runtime assets between
0.7.0 and local provide a useful noise control, not evidence of an optimization.
The cache directory is retained for repeat runs and can be removed when finished.

To separate package preparation from a quiet measurement window:

```sh
pnpm benchmark --prepare-only --output work/benchmark-prepared
pnpm benchmark --prepared work/benchmark-prepared/artifacts.json \
  --output work/benchmark-baseline --rounds 5 --iterations 10 --warmup 3
```

Prepared assets are checked again before and after measurements. Preparation and
build time are excluded. Avoid concurrent builds, tests and other benchmarks.
`--help` lists the full interface. A small smoke run is:

```sh
pnpm benchmark --fixtures heredoc --dialects bash,posix \
  --rounds 1 --iterations 1 --warmup 0 --output work/benchmark-smoke
```

Defaults are three fresh process rounds, two excluded warmups, five measured
iterations, Bash, and `representative-1`, `representative-50`, `nested-8`,
`nested-64`, `heredoc`, `consumer-m2`. `consumer-m2` is the eslint-sh M2 source
(701 lines, 11,270 bytes, 100 functions, 5,801 Nodes) used by issue #51, copied
byte-for-byte from `design/validation/performance/in-place-wire-decode/`. All ten original parsing-release fixture sources are retained
byte-for-byte from the historical `work/performance-review/fixtures` harness;
only JSON formatting may differ. Their source hashes are emitted in each report.
The new heredoc fixture includes Unicode, combining marks and retained comments.
Use `--fixtures name,...` and `--dialects bash,posix,mksh,bats` to select work.
All included sources are compatible with these dialects; dialect variants are
explicit inputs even where the fixture uses their common syntax subset.

## Phase contracts

Every artifact/fixture/dialect/phase/round gets a fresh process. Artifact order
rotates between rounds and workers run serially. Cold means a fresh JS/WASM
runtime, not a cold OS filesystem cache. Process startup is excluded.

- `import`: dynamic package import only, with no parse; one observation per process.
- `first-parse`: one actual parse including lazy WASM initialization, after import.
- `parse`: `parseSync`, with explicit comment retention and dialect selection.
- `parse-with-positions`: the separate complete parse-plus-snapshot API.
- `parse-stages`, `parse-with-positions-stages`: the same work as `parse` and
  `parse-with-positions`, with each measured call attributed to stages. Probes
  installed before import wrap the package's real WASM instance and the global
  `JSON.parse`, adding a few function calls per call, so these totals sit
  slightly above the uninstrumented phases. Each stage is reported as its own
  row, `<phase>:<stage>`, and side by side in REPORT.md's stage table:
  - `input`: public call start to the first linear-memory allocation (source
    and option validation and encoding). Native nesting-budget work is in `parse`.
  - `wasm`: the `syntaxProcess` export call; always `parse` + `encode`.
  - `parse`: parser construction/configuration, reader setup, and upstream
    `Parser.Parse` inside that call, as reported by the
    shim's `syntaxLastParseNanoseconds` export. Packages without that export
    (all published releases up to 0.7.0) report `parse` and `encode` as
    unsupported; `wasm` still covers both.
  - `encode`: the rest of the export call: syntax records and any position
    sidecar written as JSON, plus buffer handling inside Go.
  - `transfer`: copies into linear memory before the export, then locating
    and decoding the response text up to the first `JSON.parse`.
  - `decode`: `JSON.parse` through return: byte restoration, File validation
    (which also restores compact positions) and any snapshot construction.

  Stage phases need the faithful linear-memory ABI; 0.3.1 reports them as
  unsupported.

- `walk`: the public traversal over a pre-parsed tree with an accept-all callback.
  Normalized 0.3.1 traversal and faithful entry/null-exit traversal are **not
  comparable work units**, even though both exports are named `walk`.
- `bounds-root`: `nodePos` and `nodeEnd` for the pre-parsed File (two calls).
- `bounds-all`: both live operations for every stored syntax Node (2N calls).
  This deliberately exercises repeated subtree reconstruction. It can be slow;
  select fewer iterations or exclude it with `--phases` for routine parse work.
- `snapshot-lookup`: lookup for every stored Node in a prebuilt position snapshot.
- `print`: default printer output for a pre-parsed tree.
- `edited-print`: the same print operation after all marker literals are edited
  during setup. Mutation and parsing are excluded from print time.

Missing APIs are `unsupported`, with no synthetic timing samples. Parse ratios
compare the same source/comment request but include each version's different
output representation; they are not pure Go parser or equivalent AST costs.
Stored-record counts, faithful walk entry/exit counts and normalized node counts
are labeled separately. Copied callback comments are never used as snapshot keys.

Setup and correctness checks happen outside clocks. Print checks reparse the
result outside the interval, so each timed call still prints the same prepared
input. Within-process GC/JIT/cache behavior is part of warm measurements; no GC
forcing or allocation instrumentation is added to timing workers.

Separate verification workers intercept the actual WASM ABI and report operation
counts and input payload bytes. Exact budgets require one parse/print bridge call,
one parse-with-positions call without per-node bounds work, zero bridge calls for
walk/snapshot lookup, and two live calls per bounds node. Marker visits reject
silently skipped traversal; print and edited print must reparse with all markers.
Unicode source byte offsets independently check live marker bounds. Snapshot
verification checks stable original bounds after editing explicit `Lit.ValueEnd`;
small single-marker fixtures additionally compare every stored node with live
bounds and reject copied-node lookup. Large-fixture snapshots verify lookup
coverage and marker bounds without repeating every expensive live bound check.

## Outputs and interpretation

- `artifacts.json`: frozen package provenance and reusable artifact locations.
- `samples.jsonl`: every raw timing process, its PID, round, phase and samples.
  Written incrementally so a failed run retains observations, but an incomplete
  run is not a completed comparison.
- `report.json`: schema version, environment (Node/OS/platform/architecture/CPU),
  invocation/options, source dimensions/hashes, artifacts, verification evidence,
  raw samples, process-level summaries and adjacent-release comparisons.
- `REPORT.md`: readable duration distributions and ratios, rounded to two decimals;
  positive durations below 0.01 ms display as `<0.01` instead of zero.

Summaries use **medians per process**, then report their median/min/max and process
count. Repeated warm samples within a process are correlated; they are not treated
as independent trials. Adjacent comparisons are 0.4.0/0.3.1, 0.5.0/0.4.0, 0.7.0/0.5.0 and
local/0.7.0, with incompatible contracts explicitly noncomparable. These are
observations, not statistical significance claims or hard regression thresholds.

The retained [published-version baseline](../../design/validation/performance/published-versions-2026-11-02/README.md)
contains a complete Bash/POSIX run, raw evidence and bounded follow-up investigations.

Historical [parsing-release end-to-end evidence](../../design/validation/performance/FINAL-CANONICAL-RETEST.md)
measured specific built producer/consumer candidates, not fresh published-package
producer phases. Consumer-side measurements of ESLint traversal, printing and fixes
include consumer observations and reparses, so they cannot be used as numeric
baselines for these isolated producer phases. To reproduce a producer measurement,
run the benchmark CLI described above against the packed artifacts. This facility makes no runtime changes.

## Public-output identity

Transport optimizations must not change what the public parsers return. This
check runs two built packages, each in a fresh process, over every fixture plus
edge sources (Unicode, invalid UTF-8, byte filenames, heredocs, CRLF, recovery,
parse and language errors, invalid options) in every dialect, and compares a
canonical serialization of each `parseSync` and `parseWithPositionsSync`
result: member order, byte strings, frozenness, every snapshot observation and
thrown error class, message and fields. Use the published release as ground truth:

```sh
node tools/benchmark/identity.mjs --prepared work/benchmark/artifacts.json
# or, for any two built packages:
node tools/benchmark/identity.mjs --baseline <old>/dist/index.js --candidate packages/sh-ast/dist/index.js
```

It prints the case count, mismatch count and both serializations' SHA-256, and
exits nonzero on any mismatch.

Run `pnpm test:benchmark` for accounting/capability/provenance/comparison outcome
tests and a built-package worker integration test. No test asserts latency.
`heap-sequence.integration.mjs` runs a large public-API sequence at several sizes,
each in a fresh process, and fails if the Go runtime aborts; set `SH_AST_ENTRY` to
another build's `dist/index.js` to check that build.
