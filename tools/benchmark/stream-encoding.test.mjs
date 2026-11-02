/** Outcome tests for matched artifacts, measurement boundaries and lint configurations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  matchedArtifacts,
  requests,
  lintConfiguration,
  rawOperation,
  pairedSummary,
} from './stream-encoding-model.mjs';
import { freezeDependencies } from './stream-encoding-prepare.mjs';

test('a matched comparison requires exact distinct producer revisions and faithful consumer identity', () => {
  const baseline = { label: 'local-candidate', gitHead: 'a'.repeat(40) };
  const candidate = { label: 'local-candidate', gitHead: 'b'.repeat(40) };
  const result = matchedArtifacts(baseline, candidate);
  assert.deepEqual(
    result.map((x) => x.label),
    ['baseline', 'candidate'],
  );
  assert.equal(baseline.label, 'local-candidate');
  assert.throws(() => matchedArtifacts(baseline, baseline), /distinct/);
  assert.throws(() => matchedArtifacts({ label: '0.5.0' }, candidate), /revision/);
  assert.throws(
    () =>
      matchedArtifacts(
        { ...baseline, assets: { 'dist/index.js': 'one' } },
        { ...candidate, assets: { 'dist/index.js': 'two' } },
      ),
    /JavaScript/,
  );
});

test('each phase gets independent serial workers with alternating arm order', () => {
  const result = requests(['m2'], 2);
  assert.equal(result.length, 24);
  for (const phase of new Set(result.map((x) => x.phase))) {
    assert.deepEqual(
      result.filter((x) => x.phase === phase).map((x) => [x.round, x.arm]),
      [
        [0, 'baseline'],
        [0, 'candidate'],
        [1, 'candidate'],
        [1, 'baseline'],
      ],
    );
  }
  assert(result.some((x) => x.phase === 'lint-no-rules'));
  assert(result.some((x) => x.phase === 'lint-probe-rule'));
});

test('no-rule lint has no enabled rule; probe traversal is a separately labeled configuration', () => {
  const plugin = {};
  const counts = { nodes: 0, markers: 0, functions: 0 };
  const plain = lintConfiguration(plugin, 'lint-no-rules', counts);
  assert.deepEqual(plain.rules, {});
  assert.deepEqual(Object.keys(plain.plugins), ['sh']);
  const probe = lintConfiguration(plugin, 'lint-probe-rule', counts);
  assert.equal(probe.rules['probe/visit'], 'error');
  const visit = probe.plugins.probe.rules.visit.create({
    sourceCode: { getText: () => 'BENCHMARK_TOKEN' },
  })['*'];
  visit({ type: 'Lit' });
  visit({ type: 'FuncDecl' });
  assert.deepEqual(counts, { nodes: 2, markers: 1, functions: 1 });
});

test('raw bridge prepares bytes outside clocks and validates errors after the call', () => {
  let args;
  const operation = rawOperation(
    (...values) => {
      args = values;
      return '{"File":{"Type":"File"}}';
    },
    { source: 'echo 🎉', markers: 0 },
    'parse',
    { Variant: 0 },
  );
  const state = operation.setup();
  const value = operation.run(state);
  assert.equal(args[0], 'parse');
  assert.equal(new TextDecoder().decode(args[1]), 'echo 🎉');
  assert.equal(args[2], '{"Variant":0}');
  operation.verify(value);
  assert.throws(() => operation.verify('{"Error":{"Kind":"ParseError"}}'), /Error/);
});

test('paired report uses process medians, preserves pair direction and rejects missing rounds', () => {
  const samples = [
    { arm: 'baseline', round: 0, samples: [1, 9, 5] },
    { arm: 'candidate', round: 0, samples: [2, 2, 2] },
    { arm: 'baseline', round: 1, samples: [10, 10, 10] },
    { arm: 'candidate', round: 1, samples: [5, 5, 5] },
  ];
  const report = pairedSummary(samples);
  assert.equal(report.baseline.median, 7.5);
  assert.deepEqual(
    report.pairs.map((x) => x.ratio),
    [0.4, 0.5],
  );
  assert.throws(() => pairedSummary(samples.slice(1)), /paired/);
});

test('freezing dependency closures copies runtime bytes and retains distinct transitive versions', () => {
  const root = mkdtempSync(join(tmpdir(), 'stream-deps-test-'));
  try {
    const make = (path, name, version, dependencies = {}) => {
      mkdirSync(path, { recursive: true });
      writeFileSync(
        join(path, 'package.json'),
        JSON.stringify({ name, version, main: 'index.js', dependencies }),
      );
      writeFileSync(join(path, 'index.js'), `export default ${JSON.stringify(version)};`);
    };
    for (const [name, version] of [
      ['one', '1.0.0'],
      ['two', '2.0.0'],
    ]) {
      make(join(root, name), name, '1.0.0', { dep: version });
      make(join(root, name, 'node_modules', 'dep'), 'dep', version);
    }
    const peerManifest = join(root, 'one', 'package.json');
    writeFileSync(
      peerManifest,
      JSON.stringify({
        name: 'one',
        version: '1.0.0',
        main: 'index.js',
        peerDependencies: { dep: '1.0.0' },
      }),
    );
    const frozen = freezeDependencies(
      { one: join(root, 'one'), two: join(root, 'two') },
      join(root, 'frozen'),
    );
    writeFileSync(join(root, 'one', 'node_modules', 'dep', 'index.js'), 'changed');
    assert.match(
      readFileSync(join(frozen.roots.one, 'node_modules', 'dep', 'index.js'), 'utf8'),
      /1.0.0/,
    );
    assert.match(
      readFileSync(join(frozen.roots.two, 'node_modules', 'dep', 'index.js'), 'utf8'),
      /2.0.0/,
    );
    assert.equal(frozen.packages.length, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
