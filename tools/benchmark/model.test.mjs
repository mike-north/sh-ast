/** Outcome tests for trustworthy benchmark accounting; elapsed speed is never an assertion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { summarize, verifyIdentity, compare, schedule, executePhase } from './model.mjs';

test('summaries preserve sample counts and independently known distribution', () => {
  assert.deepEqual(summarize([9, 1, 3, 7]), { count: 4, min: 1, median: 5, max: 9 });
  assert.throws(() => summarize([]));
});
test('artifact identity rejects wrong version and mismatched integrity', () => {
  const bytes = Buffer.from('published bytes');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.doesNotThrow(() =>
    verifyIdentity({ name: 'sh-ast', version: '0.4.0' }, '0.4.0', bytes, integrity),
  );
  assert.throws(() =>
    verifyIdentity({ name: 'sh-ast', version: '0.5.0' }, '0.4.0', bytes, integrity),
  );
  assert.throws(() =>
    verifyIdentity(
      { name: 'sh-ast', version: '0.4.0' },
      '0.4.0',
      Buffer.from('changed'),
      integrity,
    ),
  );
});
test('rounds rotate artifact order and retain each replicate exactly once', () => {
  assert.deepEqual(schedule(['a', 'b', 'c'], 3), [
    ['a', 'b', 'c'],
    ['b', 'c', 'a'],
    ['c', 'a', 'b'],
  ]);
});
test('comparisons never invent zero latency or compare incompatible operations', () => {
  assert.deepEqual(
    compare({ status: 'unsupported' }, { status: 'ok', contract: 'parse', median: 2 }),
    { status: 'unsupported' },
  );
  assert.deepEqual(
    compare(
      { status: 'ok', contract: 'normalized', median: 2 },
      { status: 'ok', contract: 'faithful', median: 6 },
    ),
    { status: 'noncomparable' },
  );
  assert.deepEqual(
    compare(
      { status: 'ok', contract: 'parse', median: 2 },
      { status: 'ok', contract: 'parse', median: 6 },
    ),
    { status: 'ok', ratio: 3 },
  );
});
test('warmup is excluded, setup precedes timing, verification follows timing', () => {
  const events = [];
  const result = executePhase(
    {
      setup() {
        events.push('setup');
        return 42;
      },
      run(value) {
        assert.equal(value, 42);
        events.push('run');
        return 7;
      },
      verify(value) {
        assert.equal(value, 7);
        events.push('verify');
      },
    },
    2,
    1,
    () => {
      events.push('clock');
      return 1;
    },
  );
  assert.equal(result.samples.length, 2);
  assert.deepEqual(events, [
    'setup',
    'run',
    'verify',
    'clock',
    'run',
    'clock',
    'verify',
    'clock',
    'run',
    'clock',
    'verify',
  ]);
});
test('unsupported operations perform no setup and contain no timing samples', () => {
  assert.deepEqual(executePhase(null, 2, 1), { status: 'unsupported' });
});
