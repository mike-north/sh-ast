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
export function matchedArtifacts(baseline, candidate) {
  for (const artifact of [baseline, candidate])
    assert.match(artifact.gitHead ?? '', /^[a-f0-9]{40}$/, 'exact producer revision required');
  assert.notEqual(baseline.gitHead, candidate.gitHead, 'producer revisions must be distinct');
  const javascript = (artifact) =>
    Object.fromEntries(
      Object.entries(artifact.assets ?? {})
        .filter(([name]) => /\.[cm]?js$/.test(name))
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  assert.deepEqual(
    javascript(baseline),
    javascript(candidate),
    'producer JavaScript must be identical',
  );
  return [
    { ...baseline, label: 'baseline' },
    { ...candidate, label: 'candidate' },
  ];
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
