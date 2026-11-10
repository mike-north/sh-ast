/** Repeatable producer measurements with immutable artifacts, serial fresh workers and auditable samples. */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { cpus, platform, arch, release, totalmem } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { prepare, verifyPrepared, hash } from './artifacts.mjs';
import { phases } from './adapter.mjs';
import { schedule } from './model.mjs';
import { rowsFor, markdown, comparisonsFor } from './report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { values } = parseArgs({
  options: {
    output: { type: 'string', default: 'work/benchmark' },
    prepared: { type: 'string' },
    'prepare-only': { type: 'boolean' },
    rounds: { type: 'string', default: '3' },
    iterations: { type: 'string', default: '5' },
    warmup: { type: 'string', default: '2' },
    fixtures: {
      type: 'string',
      default: 'representative-1,representative-50,nested-8,nested-64,heredoc,consumer-m2',
    },
    dialects: { type: 'string', default: 'bash' },
    phases: { type: 'string', default: phases.join(',') },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'pnpm benchmark [--output DIR] [--prepare-only | --prepared artifacts.json] [--fixtures name,...] [--dialects bash,posix] [--phases ' +
      phases.join(',') +
      '] [--rounds 3] [--iterations 5] [--warmup 2]',
  );
  process.exit(0);
}
const output = resolve(values.output);
mkdirSync(output, { recursive: true });
const config = Object.fromEntries(
  ['rounds', 'iterations', 'warmup'].map((key) => {
    const n = Number(values[key]);
    if (!Number.isSafeInteger(n) || n < (key === 'warmup' ? 0 : 1))
      throw new Error(`Invalid ${key}`);
    return [key, n];
  }),
);
const selectedPhases = values.phases.split(',');
if (selectedPhases.some((phase) => !phases.includes(phase))) throw new Error('Unknown phase');
const dialects = values.dialects.split(',');
if (dialects.some((dialect) => !['bash', 'posix', 'mksh', 'bats'].includes(dialect)))
  throw new Error('Unknown dialect');
const prepared = values.prepared
  ? JSON.parse(readFileSync(resolve(values.prepared), 'utf8'))
  : prepare(root);
verifyPrepared(prepared);
writeFileSync(join(output, 'artifacts.json'), JSON.stringify(prepared, null, 2) + '\n');
if (values['prepare-only']) {
  console.log(`Prepared ${join(output, 'artifacts.json')}`);
  process.exit(0);
}
const fixtures = values.fixtures.split(',').flatMap((name) => {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid fixture name');
  const fixture = JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'));
  return dialects.map((dialect) => ({ ...fixture, dialect }));
});
const environment = {
  node: process.version,
  platform: platform(),
  arch: arch(),
  osRelease: release(),
  cpu: cpus()[0]?.model,
  cpuCount: cpus().length,
  totalMemory: totalmem(),
};
const samples = [];
const verification = [];
const rawPath = join(output, 'samples.jsonl');
writeFileSync(rawPath, '');
/** Blocking subprocesses are intentional: concurrent workers would contaminate measurements. */
function worker(artifact, fixture, phase, mode) {
  const request = { entry: artifact.entry, fixture, phase, mode, ...config };
  const result = JSON.parse(
    execFileSync(process.execPath, [join(here, 'worker.mjs')], {
      input: JSON.stringify(request),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 180000,
    }),
  );
  return { artifact: artifact.label, fixture: fixture.name, dialect: fixture.dialect, ...result };
}
/**
 * A stage phase's process contributes one derived sample per stage, named
 * `<phase>:<stage>`, so each stage is summarized and compared like a phase.
 * The raw process record (with its per-stage arrays) is what samples.jsonl keeps.
 */
function stageSamples(sample) {
  if (!sample.stages) return [];
  const identity = { ...sample };
  for (const key of ['stages', 'samples', 'summary']) delete identity[key];
  return Object.entries(sample.stages).map(([stage, observed]) => ({
    ...identity,
    phase: `${sample.phase}:${stage}`,
    contract: `${sample.contract}:${stage}`,
    ...observed,
  }));
}
for (const fixture of fixtures)
  for (const phase of selectedPhases) {
    console.error(`${fixture.name}/${fixture.dialect}: ${phase}`);
    for (const artifact of prepared.artifacts)
      verification.push(worker(artifact, fixture, phase, 'verify'));
    for (const [round, order] of schedule(prepared.artifacts, config.rounds).entries())
      for (const artifact of order) {
        const sample = { round, ...worker(artifact, fixture, phase, 'timing') };
        samples.push(sample, ...stageSamples(sample));
        appendFileSync(rawPath, JSON.stringify(sample) + '\n');
      }
  }
verifyPrepared(prepared);
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  environment,
  config: {
    ...config,
    phases: selectedPhases,
    dialects,
    invocation: [process.execPath, ...process.argv.slice(1)],
  },
  artifacts: prepared.artifacts,
  fixtures: fixtures.map(({ source, ...fixture }) => ({
    ...fixture,
    bytes: Buffer.byteLength(source),
    utf16Units: source.length,
    lines: source.split('\n').length - 1,
    sha256: hash(source),
  })),
  verification,
  samples,
  rows: rowsFor(samples),
};
report.comparisons = comparisonsFor(report.rows);
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(output, 'REPORT.md'), markdown(report));
console.log(`Wrote ${join(output, 'report.json')} and REPORT.md`);
