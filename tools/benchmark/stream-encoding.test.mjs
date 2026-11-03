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
  verifyPair,
  historicalRequests,
  publishedTarget,
  verifyHistoricalResult,
} from './stream-encoding-model.mjs';
import { freezeDependencies } from './stream-encoding-prepare.mjs';

test('historical target pairs actual 0.3.1 parse with candidate snapshot without relabeling work', () => {
  const plan = historicalRequests(2);
  assert.deepEqual(
    plan.map(({ arm, phase, round }) => [arm, phase, round]),
    [
      ['baseline', 'parse', 0],
      ['candidate', 'parse-with-positions', 0],
      ['candidate', 'parse-with-positions', 1],
      ['baseline', 'parse', 1],
    ],
  );
  assert(plan.every(({ fixture }) => fixture === 'consumer-m2'));
  const published = {
    label: '0.3.1',
    version: '0.3.1',
    registryTarball: 'https://registry.npmjs.org/sh-ast/-/sh-ast-0.3.1.tgz',
    integrity: 'sha512-published',
  };
  assert.equal(publishedTarget({ artifacts: [published] }), published);
  for (const invalid of [
    { ...published, gitHead: 'a'.repeat(40) },
    { ...published, version: '0.6.0' },
    { ...published, registryTarball: null },
    { ...published, label: 'local-candidate' },
  ])
    assert.throws(() => publishedTarget({ artifacts: [invalid] }));
  assert.throws(() => publishedTarget({ artifacts: [published, published] }));
  assert.throws(() => verifyHistoricalResult({ status: 'unsupported' }, 'baseline'));
  const legacy = {
    status: 'ok',
    transport: { parse: { calls: 1 } },
    work: { functions: 100, storedRecords: 6000 },
  };
  assert.doesNotThrow(() => verifyHistoricalResult(legacy, 'baseline'));
  assert.throws(() => verifyHistoricalResult({ ...legacy, work: { functions: 99 } }, 'baseline'));
  assert.throws(() => verifyHistoricalResult(legacy, 'candidate'));
  const faithful = {
    status: 'ok',
    transport: { 'parse-with-positions': { calls: 1 } },
    work: { functions: 100, nodes: 5801 },
  };
  assert.doesNotThrow(() => verifyHistoricalResult(faithful, 'candidate'));
  assert.throws(() =>
    verifyHistoricalResult({ ...faithful, work: { functions: 100, nodes: 5800 } }, 'candidate'),
  );
});

test('reviewed decoder changes permit only exact existing JavaScript path and hash pairs', () => {
  const before = '1'.repeat(64);
  const after = '2'.repeat(64);
  const baseline = {
    gitHead: 'a'.repeat(40),
    assets: { 'dist/syntax-snapshot.js': before, 'dist/index.js': before },
  };
  const candidate = {
    gitHead: 'b'.repeat(40),
    assets: { 'dist/syntax-snapshot.js': after, 'dist/index.js': before },
  };
  const reviewed = { 'dist/syntax-snapshot.js': { baseline: before, candidate: after } };
  assert.doesNotThrow(() => matchedArtifacts(baseline, candidate, reviewed));
  assert.throws(() => matchedArtifacts(baseline, candidate), /JavaScript/);
  assert.throws(
    () =>
      matchedArtifacts(
        baseline,
        { ...candidate, assets: { ...candidate.assets, 'dist/index.js': after } },
        reviewed,
      ),
    /JavaScript/,
  );
  assert.throws(
    () =>
      matchedArtifacts(
        baseline,
        {
          ...candidate,
          assets: { ...candidate.assets, 'dist/syntax-snapshot.js': '3'.repeat(64) },
        },
        reviewed,
      ),
    /JavaScript/,
  );
  assert.throws(
    () => matchedArtifacts(baseline, { ...candidate, assets: { ...baseline.assets } }, reviewed),
    /JavaScript/,
  );
  assert.throws(
    () =>
      matchedArtifacts(
        baseline,
        { ...candidate, assets: { 'dist/syntax-snapshot.js': after } },
        reviewed,
      ),
    /JavaScript/,
  );
  assert.throws(
    () =>
      matchedArtifacts(
        baseline,
        { ...candidate, assets: { ...candidate.assets, 'dist/extra.js': after } },
        reviewed,
      ),
    /JavaScript/,
  );
});

test('compact transport changes retain payload sizes while File and all-node observations must agree', () => {
  const baseline = {
    treeHash: 'tree',
    rawFileHash: 'file',
    positionsHash: 'all-bounds',
    smokeHash: 'smoke',
    responseHash: 'old-wire',
    responseBytes: 1234,
    nodes: 3,
    counts: { nodes: 3 },
  };
  const candidate = { ...baseline, responseHash: 'compact-wire', responseBytes: 432 };
  const pair = [baseline, candidate];
  assert.doesNotThrow(() => verifyPair(pair, 'raw-parse-with-positions', true));
  assert.equal(pair[0].responseBytes, 1234);
  assert.equal(pair[1].responseBytes, 432);
  assert.throws(() => verifyPair(pair, 'raw-parse-with-positions'), /responseHash/);
  assert.throws(() => verifyPair(pair, 'raw-parse', true), /responseHash/);
  for (const key of ['rawFileHash', 'treeHash', 'positionsHash', 'smokeHash', 'nodes', 'counts']) {
    assert.throws(
      () =>
        verifyPair(
          [baseline, { ...candidate, [key]: 'changed' }],
          'raw-parse-with-positions',
          true,
        ),
      new RegExp(key),
    );
  }
});

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
    writeFileSync(
      join(root, 'one', 'node_modules', 'dep', 'package.json'),
      JSON.stringify({ name: 'dep', version: '1.0.0', exports: {} }),
    );
    make(join(root, 'one', 'node_modules', 'punycode'), 'punycode', '2.3.1');
    const withBuiltinName = JSON.parse(readFileSync(peerManifest));
    withBuiltinName.dependencies = { punycode: '2.3.1' };
    writeFileSync(peerManifest, JSON.stringify(withBuiltinName));
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
    assert.equal(frozen.packages.length, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
