/** Stage attribution arithmetic, its report table, and the identity serializer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeStages } from './stages.mjs';
import { stageTable } from './report.mjs';
import { describe } from './identity.mjs';

const marks = { start: 10, alloc: 10.5, exportStart: 11, exportEnd: 20, jsonStart: 21.5, end: 28 };

test('stage durations partition one call between its observed boundaries', () => {
  assert.deepEqual(attributeStages(marks, 2), {
    input: 0.5,
    wasm: 9,
    parse: 2,
    encode: 7,
    transfer: 2,
    decode: 6.5,
  });
});

test('a package without a parse timer reports wasm but not its split', () => {
  const stages = attributeStages(marks, null);
  assert.equal(stages.wasm, 9);
  assert.equal(stages.parse, null);
  assert.equal(stages.encode, null);
});

test('missing, reordered or impossible observations are rejected, not guessed', () => {
  assert.throws(() => attributeStages({ ...marks, jsonStart: undefined }, 2), /out of order/);
  assert.throws(() => attributeStages({ ...marks, exportEnd: 10.9 }, 2), /out of order/);
  assert.throws(() => attributeStages(marks, 9.5), /exceeds/);
});

test('the stage table lists every stage beside its phase total', () => {
  const base = { fixture: 'm2', dialect: 'bash', artifact: 'local-candidate', status: 'ok' };
  const rows = [
    { ...base, phase: 'parse-stages', median: 18 },
    ...['input', 'wasm', 'parse', 'encode', 'transfer', 'decode'].map((stage, i) => ({
      ...base,
      phase: `parse-stages:${stage}`,
      median: i + 1,
    })),
    { ...base, artifact: '0.7.0', phase: 'parse-stages', median: 50 },
    { ...base, artifact: '0.7.0', phase: 'parse-stages:parse', status: 'unsupported' },
  ];
  const lines = stageTable(rows);
  assert(
    lines.includes(
      '| m2 / bash | parse-stages | local-candidate | 1.00 | 2.00 | 3.00 | 4.00 | 5.00 | 6.00 | 18.00 |',
    ),
  );
  assert(
    lines.includes(
      '| m2 / bash | parse-stages | 0.7.0 | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | 50.00 |',
    ),
  );
  assert.deepEqual(stageTable(rows.filter((row) => !row.phase.endsWith('-stages'))), []);
});

test('identity serialization distinguishes every observable difference it claims to', () => {
  assert.equal(describe({ a: 1, b: 'x' }), '{"a":number:1,"b":"x"}');
  assert.notEqual(describe({ a: 1, b: 2 }), describe({ b: 2, a: 1 }));
  assert.notEqual(describe(new Uint8Array([104, 105])), describe('hi'));
  assert.notEqual(describe([1]), describe({ 0: 1 }));
  assert.notEqual(describe(Object.freeze({ a: 1 })), describe({ a: 1 }));
  assert.notEqual(describe(null), describe(undefined));
  assert.notEqual(describe(1), describe('1'));
  assert.equal(describe(new Uint8Array([0, 255])), 'bytes:[0,255]');
});
