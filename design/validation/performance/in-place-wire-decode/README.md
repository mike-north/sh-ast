# In-place wire decoder comparison

This is the decoder-only portion of [#37](https://github.com/mike-north/sh-ast/issues/37),
based on `3fecd43`. Snapshot path correlation is unchanged. This does not complete
#37 or claim its combined-prototype target of a 20 ms reduction.

The comparison uses published 0.5.0 and the locally packed candidate, with
identical canonical WASM. Exact package assets, candidate source hashes, fixture
hashes, raw process samples and verification operations are retained in
`report.json` and `samples.jsonl`. The candidate was uncommitted when packed;
the source hashes, not its base Git SHA or unchanged version, identify the code.

## Results

Node **24.14.0**, darwin/arm64, Apple M5 Max. Five fresh processes per case, each
with three excluded warmups and ten measured calls; artifact order rotates.
Table entries are medians of process medians, with process-median ranges. The team
paused builds/tests during the measurement window. Other system activity was not
controlled. These are observations, not statistical significance claims.

| Fixture / phase                               |     Published 0.5.0 ms |  Decoder candidate ms |
| --------------------------------------------- | ---------------------: | --------------------: |
| Consumer M2 / parse                           |   64.35 [55.17, 67.77] |  51.60 [45.88, 53.32] |
| Consumer M2 / parse plus snapshot             | 103.56 [99.82, 107.90] | 94.49 [92.73, 100.64] |
| Representative 500-line / parse               |   27.52 [26.08, 30.63] |  27.56 [26.63, 29.41] |
| Representative 500-line / parse plus snapshot |   68.20 [67.32, 72.29] |  65.31 [64.39, 67.00] |
| Nested 64 / parse plus snapshot               |   28.08 [27.40, 30.28] |  26.69 [26.43, 27.48] |

The M2 medians improve by 12.75 ms for parse and 9.07 ms for parse plus snapshot.
The snapshot process ranges overlap slightly; a repeatable exact 9% improvement
is not established. Representative parse and tiny heredoc results show no clear
change. This producer run does not measure end-to-end ESLint latency.

The hand-authored M2 generator from #35 is retained exactly in `consumer-m2.json`.
It has no `BENCHMARK_TOKEN` markers, so the harness's marker count alone is not a
completeness proof for this fixture. Separately, outside all timing, both artifacts
produced deep-equal Files, all **5,801** node occurrences had equal snapshot values,
and the tree contained the expected **100** functions (`m2-equivalence.json`).
Other fixtures retain the benchmark facility's marker-based verification.
Focused decoder tests also compare real canonical-WASM envelopes with the retired
copying decoder and verify malformed-byte rejection and own-property safety.

## Reproduction

Use the [benchmark facility](../../../../tools/benchmark/README.md) and Node
24.14.0 to reproduce these measurements. Check `pnpm exec node --version`:
the local nodenv pnpm shim can override a PATH-only Node selection.

```sh
cp design/validation/performance/in-place-wire-decode/consumer-m2.json tools/benchmark/fixtures/
pnpm benchmark --prepare-only --output scratch/decode-prepared
```

Keep only artifacts labeled `0.5.0` and `local-candidate` in a copy of the prepared
manifest named `pair.json`, retaining all their identity fields. The following
untimed check also reproduces the independent M2 completeness/equivalence evidence:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { records } from './tools/benchmark/adapter.mjs';
const prepared = JSON.parse(readFileSync('scratch/decode-prepared/artifacts.json'));
prepared.artifacts = prepared.artifacts.filter(a => ['0.5.0', 'local-candidate'].includes(a.label));
writeFileSync('scratch/decode-prepared/pair.json', JSON.stringify(prepared, null, 2));
const fixture = JSON.parse(readFileSync('tools/benchmark/fixtures/consumer-m2.json'));
const apis = await Promise.all(prepared.artifacts.map(a => import(a.entry)));
const results = apis.map(api => api.parseWithPositionsSync(fixture.source, {
  KeepComments: true, Filename: 'benchmark.sh', Variant: api.LangBash,
}));
assert.deepEqual(results[0].File, results[1].File);
const nodes = results.map((result, i) => records(result.File).filter(node =>
  apis[i].SYNTAX_INTERFACES.Node.includes(node.Type)));
assert.equal(nodes[0].length, 5801);
assert.equal(nodes[1].length, 5801);
assert.equal(records(results[0].File).filter(node => node.Type === 'FuncDecl').length, 100);
for (let i = 0; i < nodes[0].length; i++) {
  assert.deepEqual(results[0].Positions.get(nodes[0][i]), results[1].Positions.get(nodes[1][i]));
}
assert.equal(prepared.artifacts[0].assets['shim/sh-ast.wasm'],
  prepared.artifacts[1].assets['shim/sh-ast.wasm']);
JS
```

Then run the timed comparison:

```sh
pnpm benchmark --prepared scratch/decode-prepared/pair.json \
  --fixtures consumer-m2,representative-50,nested-64,heredoc \
  --phases parse,parse-with-positions --rounds 5 --iterations 10 --warmup 3 \
  --output scratch/decode-results
```

The broader generated report includes unsupported adjacent-version comparisons
because only the relevant pair was selected. They are not zero-latency results.
