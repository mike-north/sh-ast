# Producer performance benchmarks

Run from the repository root with the repository's Node/pnpm toolchain:

```sh
pnpm install --frozen-lockfile
pnpm benchmark --output scratch/benchmark
```

The command builds the local candidate and generates its API declaration rollups,
then downloads the actual published `sh-ast`
0.3.1, 0.4.0 and 0.5.0 packages, and packs the local candidate with lifecycle hooks
disabled. Extraction occurs in a new OS temporary directory; no benchmark
packages are added to the workspace or dependency lockfile. Registry SRI and exact
manifest versions are checked. Every advertised runtime and declaration entrypoint
must exist in the extracted package. The report records tarball SHA-256, every extracted
asset hash, candidate source hashes, Git HEAD and working-tree status. The package
version alone does not identify the local candidate. Equal runtime assets between
0.5.0 and local provide a useful noise control, not evidence of an optimization.
The cache directory is retained for repeat runs and can be removed when finished.

To separate package preparation from a quiet measurement window:

```sh
pnpm benchmark --prepare-only --output scratch/benchmark-prepared
pnpm benchmark --prepared scratch/benchmark-prepared/artifacts.json \
  --output scratch/benchmark-baseline --rounds 5 --iterations 10 --warmup 3
```

Prepared assets are checked again before and after measurements. Preparation and
build time are excluded. Avoid concurrent builds, tests and other benchmarks.
`--help` lists the full interface. A small smoke run is:

```sh
pnpm benchmark --fixtures heredoc --dialects bash,posix \
  --rounds 1 --iterations 1 --warmup 0 --output scratch/benchmark-smoke
```

Defaults are three fresh process rounds, two excluded warmups, five measured
iterations, Bash, and `representative-1`, `representative-50`, `nested-8`,
`nested-64`, `heredoc`. All ten original Release A fixture sources are retained
byte-for-byte from the historical `scratch/performance-review/fixtures` harness;
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
as independent trials. Adjacent comparisons are 0.4.0/0.3.1, 0.5.0/0.4.0 and
local/0.5.0, with incompatible contracts explicitly noncomparable. These are
observations, not statistical significance claims or hard regression thresholds.

The retained [published-version baseline](../../design/validation/performance/published-versions-2026-11-02/README.md)
contains a complete Bash/POSIX run, raw evidence and bounded follow-up investigations.

Historical [Release A end-to-end evidence](../../design/validation/performance/FINAL-CANONICAL-RETEST.md)
measured specific built producer/consumer candidates, not fresh published-package
producer phases. The consumer repository's `work-records/release-b/performance`
measures ESLint traversal, printing and fixes (including consumer observations and
reparses). Those reports explain workload selection but cannot be used as numeric
baselines for these isolated producer phases. This facility makes no runtime changes.

Run `pnpm test:benchmark` for accounting/capability/provenance/comparison outcome
tests and a built-package worker integration test. No test asserts latency.
