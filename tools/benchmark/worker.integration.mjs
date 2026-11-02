/** A built real package proves workers execute genuine parse/traversal/printing, not only mocks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(new URL('../../packages/sh-ast/dist/index.js', import.meta.url));
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const fixture = { source: '# 你好 🎉 é\necho BENCHMARK_TOKEN\n', markers: 1, dialect: 'bash' };
test(
  'fresh real workers return exact sample counts and verified complete work',
  { timeout: 30000 },
  () => {
    for (const phase of [
      'first-parse',
      'parse-with-positions',
      'walk',
      'bounds-all',
      'snapshot-lookup',
      'print',
      'edited-print',
    ]) {
      const run = (mode) =>
        JSON.parse(
          execFileSync(process.execPath, [worker], {
            input: JSON.stringify({ entry, fixture, phase, mode, iterations: 2, warmup: 1 }),
            encoding: 'utf8',
          }),
        );
      const timing = run('timing');
      assert.equal(timing.status, 'ok');
      assert.equal(timing.samples.length, phase === 'first-parse' ? 1 : 2);
      const verification = run('verify');
      assert.equal(verification.status, 'ok');
      assert.equal(verification.work.traversal.markerVisits, 1);
      assert.notEqual(timing.pid, verification.pid);
      assert.equal(verification.samples, undefined);
    }
  },
);

test('import-only verification never reports instrumented timing samples', () => {
  const result = JSON.parse(
    execFileSync(process.execPath, [worker], {
      input: JSON.stringify({
        entry,
        fixture,
        phase: 'import',
        mode: 'verify',
        iterations: 2,
        warmup: 1,
      }),
      encoding: 'utf8',
    }),
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.samples, undefined);
  assert.deepEqual(result.transport, {});
});
