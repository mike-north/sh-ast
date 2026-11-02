/** Pure accounting and phase boundaries shared by the CLI, workers and outcome tests. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/** A distribution describes observations, not a confidence interval or independent trials. */
export function summarize(samples) {
  assert(samples.length > 0 && samples.every(Number.isFinite));
  const values = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return {
    count: values.length,
    min: values[0],
    median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    max: values.at(-1),
  };
}
/** A package label is accepted only with matching manifest and byte-level registry integrity. */
export function verifyIdentity(manifest, version, bytes, integrity) {
  assert.equal(manifest.name, 'sh-ast');
  assert.equal(manifest.version, version);
  const [algorithm, expected] = integrity.split('-');
  assert(['sha512', 'sha256', 'sha1'].includes(algorithm));
  assert.equal(
    createHash(algorithm).update(bytes).digest('base64'),
    expected,
    'tarball integrity mismatch',
  );
}
/** Rotating order limits systematic first/last bias without concealing the actual sequence. */
export function schedule(artifacts, rounds) {
  return Array.from({ length: rounds }, (_, i) => [
    ...artifacts.slice(i % artifacts.length),
    ...artifacts.slice(0, i % artifacts.length),
  ]);
}
/** Ratios require equal work contracts; missing APIs are not instantaneous operations. */
export function compare(baseline, candidate) {
  if (baseline.status !== 'ok' || candidate.status !== 'ok') return { status: 'unsupported' };
  if (baseline.contract !== candidate.contract) return { status: 'noncomparable' };
  return { status: 'ok', ratio: candidate.median / baseline.median };
}
/** Setup and correctness checks are outside clocks; warmup executes identical work but is excluded. */
export function executePhase(operation, iterations, warmup, clock = () => performance.now()) {
  if (!operation) return { status: 'unsupported' };
  const state = operation.setup();
  for (let i = 0; i < warmup; i++) operation.verify(operation.run(state));
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = clock();
    const value = operation.run(state);
    samples.push(clock() - start);
    operation.verify(value);
  }
  return { status: 'ok', samples, summary: summarize(samples) };
}
