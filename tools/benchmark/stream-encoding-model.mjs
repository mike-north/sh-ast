/** Matched streaming-encoder experiments keep bridge, public API and consumer clocks distinct. */
import assert from 'node:assert/strict';
import { summarize } from './model.mjs';
import { verifyTree } from './adapter.mjs';

/** Each phase is independently warmed in its own process; lint configurations are different work. */
export const streamPhases = [
  'raw-parse',
  'raw-parse-with-positions',
  'parse',
  'parse-with-positions',
  'lint-no-rules',
  'lint-probe-rule',
];

/** Source revisions identify the comparison; release labels alone cannot identify a local candidate. */
export function matchedArtifacts(baseline, candidate, expectedJavascriptChanges = {}) {
  for (const artifact of [baseline, candidate])
    assert.match(artifact.gitHead ?? '', /^[a-f0-9]{40}$/, 'exact producer revision required');
  assert.notEqual(baseline.gitHead, candidate.gitHead, 'producer revisions must be distinct');
  const javascript = (artifact) =>
    Object.fromEntries(
      Object.entries(artifact.assets ?? {})
        .filter(([name]) => /\.[cm]?js$/.test(name))
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  const before = javascript(baseline);
  const after = javascript(candidate);
  assert.deepEqual(
    Object.keys(before),
    Object.keys(after),
    'producer JavaScript paths must be identical',
  );
  const changes = Object.fromEntries(
    Object.keys(before)
      .filter((path) => before[path] !== after[path])
      .map((path) => [path, { baseline: before[path], candidate: after[path] }]),
  );
  // Review approves exact bytes, not a wildcard or a path that could later hide unrelated edits.
  assert.deepEqual(
    changes,
    expectedJavascriptChanges,
    'producer JavaScript differs from reviewed changes',
  );
  return [
    { ...baseline, label: 'baseline' },
    { ...candidate, label: 'candidate' },
  ];
}

/** Compact sidecars may change transport bytes only; plain parse and semantic work remain equal. */
export function verifyPair(pair, phase, compactSidecar = false) {
  assert.equal(pair.length, 2, 'verification requires two arms');
  const keys = [
    'treeHash',
    'rawFileHash',
    'positionsHash',
    'smokeHash',
    'nodes',
    'counts',
    'eslintVersion',
  ];
  if (!compactSidecar || phase !== 'raw-parse-with-positions')
    keys.push('responseHash', 'responseBytes');
  for (const key of keys)
    assert.deepEqual(pair[0][key], pair[1][key], `verification mismatch ${phase}/${key}`);
}

/** This optional latency target intentionally compares different public outputs on one M2 source. */
export function historicalRequests(rounds) {
  assert(Number.isSafeInteger(rounds) && rounds > 0);
  return Array.from({ length: rounds }, (_, round) =>
    (round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']).map((arm) => ({
      fixture: 'consumer-m2',
      round,
      arm,
      phase: arm === 'baseline' ? 'parse' : 'parse-with-positions',
    })),
  ).flat();
}

/** Historical identity must come from registry preparation; a local version label cannot stand in for it. */
export function publishedTarget(prepared) {
  const matches = prepared.artifacts.filter((artifact) => artifact.label === '0.3.1');
  assert.equal(matches.length, 1, 'one published 0.3.1 artifact required');
  const artifact = matches[0];
  assert.equal(artifact.version, '0.3.1');
  assert(!artifact.gitHead, 'historical target cannot be a local build');
  assert.equal(typeof artifact.registryTarball, 'string', 'registry provenance required');
  assert.match(
    artifact.registryTarball,
    /^https:\/\/registry\.npmjs\.org\/sh-ast\/-\/sh-ast-0\.3\.1\.tgz$/,
  );
  assert.equal(typeof artifact.integrity, 'string', 'registry integrity required');
  return artifact;
}

/** Equal source completeness and real bridge budgets apply even though normalized and faithful trees differ. */
export function verifyHistoricalResult(result, arm) {
  assert.equal(result.status, 'ok', 'historical target API must be supported');
  const operation = arm === 'baseline' ? 'parse' : 'parse-with-positions';
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.transport).map(([key, value]) => [key, value.calls])),
    { [operation]: 1 },
  );
  assert.equal(result.work.functions, 100, 'historical M2 requires all 100 functions');
  if (arm === 'candidate')
    assert.equal(result.work.nodes, 5801, 'candidate M2 requires all 5801 Nodes');
}

/** Alternation is per fixture/phase so systematic first-arm bias does not accumulate. */
export function requests(fixtures, rounds) {
  assert(Number.isSafeInteger(rounds) && rounds > 0);
  return fixtures.flatMap((fixture) =>
    streamPhases.flatMap((phase) =>
      Array.from({ length: rounds }, (_, round) =>
        (round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']).map((arm) => ({
          fixture,
          phase,
          round,
          arm,
        })),
      ).flat(),
    ),
  );
}

/** The plugin supplies a language, not a ruleset. Probe lint measures one explicit visitor rule. */
export function lintConfiguration(plugin, phase, counts) {
  assert(['lint-no-rules', 'lint-probe-rule'].includes(phase));
  const config = { files: ['**/*.sh'], plugins: { sh: plugin }, language: 'sh/sh', rules: {} };
  if (phase === 'lint-probe-rule') {
    config.plugins.probe = {
      rules: {
        visit: {
          meta: { schema: [] },
          create(context) {
            return {
              '*': (node) => {
                counts.nodes++;
                if (node.type === 'FuncDecl') counts.functions++;
                if (node.type === 'Lit' && context.sourceCode.getText(node) === 'BENCHMARK_TOKEN')
                  counts.markers++;
              },
            };
          },
        },
      },
    };
    config.rules['probe/visit'] = 'error';
  }
  return config;
}

/** Raw bridge wall time includes ABI allocation/copy/result-string/free, but excludes JSON decoding. */
export function rawOperation(callSyntax, fixture, operation, options) {
  return {
    setup: () => ({
      source: new TextEncoder().encode(fixture.source),
      options: JSON.stringify(options),
    }),
    run: ({ source, options: encoded }) => callSyntax(operation, source, encoded),
    verify: (text) => {
      const result = JSON.parse(text);
      assert(!result.Error, `unexpected Error: ${JSON.stringify(result.Error)}`);
      verifyTree(result.File, fixture);
      if (operation === 'parse-with-positions') assert(Array.isArray(result.Positions));
    },
  };
}

/** Ratios pair process medians; individual warm samples are not independent trials. */
export function pairedSummary(records) {
  const rounds = [...new Set(records.map((x) => x.round))].sort((a, b) => a - b);
  const pairs = rounds.map((round) => {
    const group = records.filter((x) => x.round === round);
    assert.equal(group.length, 2, 'each round must be paired');
    const median = (arm) => {
      const matching = group.filter((x) => x.arm === arm);
      assert.equal(matching.length, 1, 'each round must be paired by arm');
      return summarize(matching[0].samples).median;
    };
    const baseline = median('baseline');
    const candidate = median('candidate');
    return {
      round,
      baseline,
      candidate,
      deltaMs: candidate - baseline,
      ratio: candidate / baseline,
    };
  });
  return {
    baseline: summarize(pairs.map((x) => x.baseline)),
    candidate: summarize(pairs.map((x) => x.candidate)),
    pairs,
  };
}
