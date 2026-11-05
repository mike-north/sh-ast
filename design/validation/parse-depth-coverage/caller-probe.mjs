/** Runs the fixed recorded campaign against an explicitly supplied prepared ESLint consumer. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFor } from './caller-inputs.mjs';

const directory = new URL('./', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('caller-manifest.json', directory)));
const specs = JSON.parse(readFileSync(new URL('caller-inputs.json', directory)));
/** SHA-256 compares immutable input and dependency bytes, not merely package labels. */
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const consumerRoot = resolve(process.argv[2] ?? '');
const output = process.argv[3];
assert(process.argv[2] && output, 'usage: node caller-probe.mjs PREPARED_CONSUMER NEW_OUTPUT.json');
assert.equal(process.version, manifest.node);
assert.equal(
  hash(readFileSync(new URL('../../../packages/sh-ast/shim/sh-ast.wasm', directory))),
  manifest.wasmSha256,
);
for (const [path, digest] of Object.entries(manifest.dependencyFiles))
  assert.equal(hash(readFileSync(resolve(consumerRoot, path))), digest, path);
for (const [path, digest] of Object.entries(manifest.publicRuntimeFiles)) {
  assert.equal(hash(readFileSync(new URL('../../../' + path, directory))), digest, path);
}
const results = [];
for (const operation of ['parseSync', 'parseWithPositionsSync']) {
  for (const [index, input] of specs.entries()) {
    const source = sourceFor(input);
    assert.equal(hash(source), input.sourceSha256, input.name);
    const spec = {
      ...input,
      source,
      operation,
      caller: 'eslint',
      recoverErrors: index % 2 ? 100000 : 0,
    };
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('caller-child.mjs', directory)), consumerRoot],
      {
        input: JSON.stringify(spec),
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      },
    );
    assert.ifError(child.error);
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim().split('\n').at(-1));
    const row = { ...result, status: child.status, signal: child.signal };
    results.push(row);
    assert.equal(row.outcome, spec.expected);
    assert.equal(row.changed, false);
    assert.equal(row.iterations, spec.repeats);
    if (row.outcome === 'ShParseMaxDepthError') assert.equal(row.reuse, 'File');
  }
}
// Never overwrite the committed historical observations with a later run.
writeFileSync(
  output,
  JSON.stringify(
    {
      sourceCommit: manifest.sourceCommit,
      artifactCommit: manifest.artifactCommit,
      node: process.version,
      wasmSha256: manifest.wasmSha256,
      configurations: results.length,
      primaryCalls: results.reduce((n, row) => n + row.iterations, 0),
      results,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(`Verified ${results.length} configurations; new observations written to ${output}`);
