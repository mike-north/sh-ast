/** Report process-level distributions; repeated observations within one process are correlated. */
import { summarize, compare } from './model.mjs';

/** A row combines independent process medians without pretending all warm iterations are independent. */
export function rowsFor(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const key = JSON.stringify([sample.fixture, sample.dialect, sample.phase, sample.artifact]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const identity = {
      fixture: first.fixture,
      dialect: first.dialect,
      phase: first.phase,
      artifact: first.artifact,
      contract: first.contract,
    };
    if (group.every((sample) => sample.status === 'unsupported'))
      return { ...identity, status: 'unsupported', processes: group.length };
    if (!group.every((sample) => sample.status === 'ok'))
      throw new Error('Inconsistent capability across processes');
    const medians = group.map((sample) => summarize(sample.samples).median);
    return {
      ...identity,
      status: 'ok',
      processes: group.length,
      observations: group.reduce((sum, sample) => sum + sample.samples.length, 0),
      ...summarize(medians),
    };
  });
}
/** Positive values below display precision remain visibly nonzero; raw JSON is never rounded. */
function duration(ms) {
  return ms > 0 && ms < 0.01 ? '<0.01' : ms.toFixed(2);
}

/** Human output intentionally rounds durations and ratios; JSON retains the raw observations. */
export function markdown(report) {
  const lines = [
    '# sh-ast producer benchmark',
    '',
    `Node ${report.environment.node}; ${report.environment.platform}/${report.environment.arch}; ${report.environment.cpu}.`,
    '',
    'Times are milliseconds: median [min, max] of process medians. Positive durations below 0.01 ms display as <0.01. Within-process samples are correlated. Ratios use published 0.3.1 only where work contracts match. Parse ratios compare equal source/comment requests, not equivalent output representations.',
    '',
    '| Fixture / dialect | Phase | Artifact | Processes / observations | ms | vs 0.3.1 |',
    '| --- | --- | --- | ---: | ---: | ---: |',
  ];
  for (const row of report.rows) {
    const baseline = report.rows.find(
      (other) =>
        other.fixture === row.fixture &&
        other.dialect === row.dialect &&
        other.phase === row.phase &&
        other.artifact === '0.3.1',
    );
    const comparison = compare(baseline ?? { status: 'unsupported' }, row);
    const elapsed =
      row.status === 'ok'
        ? `${duration(row.median)} [${duration(row.min)}, ${duration(row.max)}]`
        : 'unsupported';
    lines.push(
      `| ${row.fixture} / ${row.dialect} | ${row.phase} | ${row.artifact} | ${row.processes} / ${row.observations ?? '—'} | ${elapsed} | ${comparison.status === 'ok' ? `${comparison.ratio.toFixed(2)}x` : comparison.status} |`,
    );
  }
  lines.push(
    '',
    '## Adjacent release comparisons',
    '',
    '| Fixture / dialect | Phase | Comparison | Ratio |',
    '| --- | --- | --- | ---: |',
  );
  for (const row of comparisonsFor(report.rows))
    lines.push(
      `| ${row.fixture} / ${row.dialect} | ${row.phase} | ${row.candidate} / ${row.baseline} | ${row.status === 'ok' ? `${row.ratio.toFixed(2)}x` : row.status} |`,
    );
  return lines.join('\n') + '\n';
}

/** Adjacent release changes and the local control retain capability/representation boundaries. */
export function comparisonsFor(rows) {
  const comparisons = [];
  for (const [baseline, candidate] of [
    ['0.3.1', '0.4.0'],
    ['0.4.0', '0.5.0'],
    ['0.5.0', 'local-candidate'],
  ]) {
    for (const row of rows.filter((row) => row.artifact === candidate)) {
      const prior = rows.find(
        (other) =>
          other.artifact === baseline &&
          other.fixture === row.fixture &&
          other.dialect === row.dialect &&
          other.phase === row.phase,
      );
      comparisons.push({
        fixture: row.fixture,
        dialect: row.dialect,
        phase: row.phase,
        baseline,
        candidate,
        ...compare(prior ?? { status: 'unsupported' }, row),
      });
    }
  }
  return comparisons;
}
