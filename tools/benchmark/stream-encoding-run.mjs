/** Matched serial campaign over immutable packages; preparation and correctness probes precede all timing. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { cpus, platform, arch, release } from 'node:os';
import { hash } from './artifacts.mjs';
import { verifyExperiment, files } from './stream-encoding-prepare.mjs';
import { requests, pairedSummary, streamPhases } from './stream-encoding-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    prepared: { type: 'string' },
    output: { type: 'string' },
    fixtures: { type: 'string', multiple: true },
    rounds: { type: 'string', default: '6' },
    iterations: { type: 'string', default: '30' },
    warmup: { type: 'string', default: '5' },
    'verify-only': { type: 'boolean', default: false },
  },
});
assert(values.prepared && values.output, '--prepared and --output required');
const config = Object.fromEntries(
  ['rounds', 'iterations', 'warmup'].map((key) => {
    const n = Number(values[key]);
    assert(Number.isSafeInteger(n) && n >= (key === 'warmup' ? 0 : 1), `invalid ${key}`);
    return [key, n];
  }),
);
const prepared = JSON.parse(readFileSync(resolve(values.prepared), 'utf8'));
verifyExperiment(prepared);
const fixturePaths = values.fixtures ?? [
  join(here, '../../design/validation/performance/in-place-wire-decode/consumer-m2.json'),
  join(here, 'fixtures/representative-50.json'),
  join(here, 'fixtures/nested-64.json'),
];
const fixtures = fixturePaths.map((path) => {
  const fixture = { ...JSON.parse(readFileSync(path, 'utf8')), dialect: 'bash' };
  return {
    ...fixture,
    path: resolve(path),
    sourceSha256: hash(fixture.source),
    sourceBytes: Buffer.byteLength(fixture.source),
  };
});
assert.equal(
  new Set(fixtures.map((x) => x.name)).size,
  fixtures.length,
  'fixture names must be unique',
);
const output = resolve(values.output);
mkdirSync(output); // An incomplete campaign is retained, never silently overwritten.
const invoke = (arm, fixture, phase, mode) => {
  const artifact = prepared.artifacts.find((x) => x.label === arm);
  return JSON.parse(
    execFileSync(process.execPath, [join(here, 'stream-encoding-worker.mjs')], {
      input: JSON.stringify({
        artifact,
        consumer: prepared.arms[arm],
        fixture,
        phase,
        mode,
        ...config,
      }),
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
};
const report = {
  createdAt: new Date().toISOString(),
  config,
  prepared,
  environment: {
    node: process.version,
    execPath: process.execPath,
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    cpu: cpus()[0]?.model,
  },
  harness: files(here),
  fixtures,
  verification: [],
  samples: [],
  summaries: [],
  contracts: {
    raw: 'ABI bridge wall time including allocation/copy/UTF8 result/free; excluding JSON decode',
    public: 'complete public parse or parse-with-positions API, Bash, KeepComments, benchmark.sh',
    lintNoRules:
      'Linter.verify with sh/sh language and rules:{}; parser-inclusive, no enabled rules',
    lintProbeRule:
      'same Linter.verify plus one explicit accept-all visitor rule counting nodes/functions/markers',
  },
};
writeFileSync(join(output, 'prepared.json'), JSON.stringify(prepared, null, 2) + '\n');
for (const fixture of fixtures)
  for (const phase of streamPhases) {
    const pair = ['baseline', 'candidate'].map((arm) => ({
      arm,
      fixture: fixture.name,
      phase,
      ...invoke(arm, fixture, phase, 'verify'),
    }));
    for (const key of [
      'treeHash',
      'positionsHash',
      'smokeHash',
      'responseHash',
      'responseBytes',
      'nodes',
      'counts',
      'eslintVersion',
    ])
      assert.deepEqual(
        pair[0][key],
        pair[1][key],
        `verification mismatch ${fixture.name}/${phase}/${key}`,
      );
    report.verification.push(...pair);
    appendFileSync(
      join(output, 'verification.jsonl'),
      pair.map((x) => JSON.stringify(x)).join('\n') + '\n',
    );
  }
if (!values['verify-only']) {
  for (const request of requests(
    fixtures.map((x) => x.name),
    config.rounds,
  )) {
    const fixture = fixtures.find((x) => x.name === request.fixture);
    const sample = { ...request, ...invoke(request.arm, fixture, request.phase, 'timing') };
    report.samples.push(sample);
    appendFileSync(join(output, 'samples.jsonl'), JSON.stringify(sample) + '\n');
    console.error(
      `${request.fixture}/${request.phase}/${request.round}/${request.arm}: ${sample.summary.median.toFixed(3)} ms`,
    );
  }
  for (const fixture of fixtures)
    for (const phase of streamPhases)
      report.summaries.push({
        fixture: fixture.name,
        phase,
        ...pairedSummary(
          report.samples.filter((x) => x.fixture === fixture.name && x.phase === phase),
        ),
      });
}
verifyExperiment(prepared);
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(join(output, 'report.json'));
