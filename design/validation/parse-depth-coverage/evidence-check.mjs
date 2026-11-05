/** Offline consistency check of recorded evidence; this does not execute the campaign. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sourceFor } from './caller-inputs.mjs';

const directory = new URL('./', import.meta.url);
const read = (name) => readFileSync(new URL(name, directory));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(read('caller-manifest.json'));
const recorded = JSON.parse(read('canonical-caller-results.json'));
const inputs = JSON.parse(read('caller-inputs.json'));
const artifact = JSON.parse(read('canonical-artifact.json'));
assert.equal(hash(read('canonical-caller-results.json')), manifest.resultsSha256);
assert.equal(hash(read('caller-inputs.json')), manifest.inputsSha256);
assert.equal(hash(read('../../../packages/sh-ast/shim/sh-ast.wasm')), manifest.wasmSha256);
assert.equal(recorded.sourceCommit, manifest.sourceCommit);
assert.equal(artifact.sourceCommit, manifest.sourceCommit);
assert.equal(artifact.wasmSha256, manifest.wasmSha256);
assert.equal(recorded.wasmSha256, manifest.wasmSha256);
assert.equal(recorded.node, manifest.node);
assert.equal(inputs.length, 22);
assert.equal(recorded.configurations, 44);
assert.equal(recorded.results.length, 44);
assert.equal(recorded.primaryCalls, 736);
let calls = 0;
for (const [operationIndex, operation] of ['parseSync', 'parseWithPositionsSync'].entries()) {
  for (const [index, input] of inputs.entries()) {
    assert.equal(hash(sourceFor(input)), input.sourceSha256);
    const row = recorded.results[operationIndex * inputs.length + index];
    assert.equal(row.name, input.name);
    assert.equal(row.n, input.n);
    assert.equal(row.operation, operation);
    assert.equal(row.expected, input.expected);
    assert.equal(row.outcome, input.expected);
    assert.equal(row.recoverErrors, index % 2 ? 100000 : 0);
    assert.equal(row.status, 0);
    assert.equal(row.signal, null);
    assert.equal(row.error, undefined);
    assert.equal(row.changed, false);
    assert.equal(row.iterations, input.repeats);
    calls += row.iterations;
    if (input.expected === 'ShParseMaxDepthError') {
      assert.equal(row.code, 'SH_AST_PARSE_MAX_DEPTH');
      assert.equal(row.maxDepth, 128);
      assert.equal(row.estimatedDepth, 129);
      assert.equal(row.reuse, 'File');
    }
  }
}
assert.equal(calls, 736);
console.log(
  'Recorded evidence consistent: 44 configurations, 736 primary calls; no campaign rerun.',
);
