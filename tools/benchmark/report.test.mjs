/** Reports describe independent process medians rather than pooling correlated warm samples. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rowsFor, markdown } from './report.mjs';
test('unequal within-process samples do not overweight one process', () => {
  const row = {
    artifact: '0.3.1',
    fixture: 'tiny',
    dialect: 'bash',
    phase: 'parse',
    contract: 'parse',
    status: 'ok',
  };
  const [summary] = rowsFor([
    { ...row, samples: [1, 1, 1] },
    { ...row, samples: [9] },
  ]);
  assert.equal(summary.median, 5);
  assert.equal(summary.processes, 2);
  assert.equal(summary.observations, 4);
});
test('readable comparison retains unsupported and incompatible capability distinctions', () => {
  const rows = [
    {
      fixture: 'tiny',
      dialect: 'bash',
      phase: 'walk',
      artifact: '0.3.1',
      status: 'ok',
      contract: 'normalized',
      median: 1,
      min: 1,
      max: 1,
      processes: 1,
      observations: 1,
    },
    {
      fixture: 'tiny',
      dialect: 'bash',
      phase: 'walk',
      artifact: '0.5.0',
      status: 'ok',
      contract: 'faithful',
      median: 2,
      min: 2,
      max: 2,
      processes: 1,
      observations: 1,
    },
    {
      fixture: 'tiny',
      dialect: 'bash',
      phase: 'print',
      artifact: '0.3.1',
      status: 'unsupported',
      processes: 1,
    },
  ];
  const text = markdown({ environment: {}, rows });
  assert.match(text, /noncomparable/);
  assert.match(text, /unsupported/);
  assert.doesNotMatch(text, /2.00x/);
});

test('faithful phase comparisons include adjacent releases and candidate control', async () => {
  const { comparisonsFor } = await import('./report.mjs');
  const base = {
    fixture: 'tiny',
    dialect: 'bash',
    phase: 'bounds-root',
    status: 'ok',
    contract: 'bounds-root:faithful',
  };
  const result = comparisonsFor([
    { ...base, artifact: '0.4.0', median: 4 },
    { ...base, artifact: '0.5.0', median: 2 },
    { ...base, artifact: 'local-candidate', median: 3 },
  ]);
  assert.equal(
    result.find((row) => row.baseline === '0.4.0' && row.candidate === '0.5.0').ratio,
    0.5,
  );
  assert.equal(
    result.find((row) => row.baseline === '0.5.0' && row.candidate === 'local-candidate').ratio,
    1.5,
  );
});

test('positive sub-hundredth millisecond durations are never displayed as zero', () => {
  const base = {
    fixture: 'tiny',
    dialect: 'bash',
    phase: 'snapshot-lookup',
    artifact: '0.5.0',
    status: 'ok',
    contract: 'snapshot',
    processes: 1,
    observations: 1,
  };
  const text = markdown({
    environment: {},
    rows: [
      { ...base, min: 0.001, median: 0.003, max: 0.009 },
      { ...base, fixture: 'zero', min: 0, median: 0, max: 0 },
    ],
  });
  assert.match(text, /<0\.01 \[<0\.01, <0\.01\]/);
  assert.match(text, /0\.00 \[0\.00, 0\.00\]/);
});
