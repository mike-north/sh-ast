/** Bridge budgets detect skipped work without relying on wall-clock thresholds. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBudget } from './transport.mjs';
test('a complete parse uses exactly one bridge operation', () => {
  assert.doesNotThrow(() => assertBudget('parse', { parse: { calls: 1, payloadBytes: 23 } }, 0));
  assert.throws(() => assertBudget('parse', {}, 0));
  assert.throws(() => assertBudget('parse', { parse: { calls: 2, payloadBytes: 46 } }, 0));
});
test('snapshots cannot hide per-node live bounds and JS walks cannot call WASM', () => {
  assert.doesNotThrow(() =>
    assertBudget(
      'parse-with-positions',
      { 'parse-with-positions': { calls: 1, payloadBytes: 23 } },
      0,
    ),
  );
  assert.throws(() =>
    assertBudget(
      'parse-with-positions',
      { 'parse-with-positions': { calls: 1 }, pos: { calls: 1 } },
      0,
    ),
  );
  assert.doesNotThrow(() => assertBudget('walk', {}, 12));
  assert.throws(() => assertBudget('walk', { pos: { calls: 1 } }, 12));
});
test('all-node current bounds require exactly two calls per stored node', () => {
  assert.doesNotThrow(() =>
    assertBudget('bounds-all', { pos: { calls: 4 }, end: { calls: 4 } }, 4),
  );
  assert.throws(() => assertBudget('bounds-all', { pos: { calls: 1 }, end: { calls: 1 } }, 4));
});
