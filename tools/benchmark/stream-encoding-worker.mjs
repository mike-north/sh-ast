/** One process measures one immutable artifact/fixture/phase, with verification outside its clock. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { executePhase } from './model.mjs';
import { operationFor, optionsFor, records, verifyTree } from './adapter.mjs';
import { instrument } from './transport.mjs';
import { hash } from './artifacts.mjs';
import { lintConfiguration, rawOperation } from './stream-encoding-model.mjs';

const request = JSON.parse(readFileSync(0, 'utf8'));
const { artifact, consumer, fixture, phase, mode, warmup, iterations } = request;
const probe = mode === 'verify' ? instrument() : null;
const api = await import(pathToFileURL(artifact.entry).href);
let operation;
let lintVersion;
let counts = { nodes: 0, markers: 0, functions: 0 };
if (phase.startsWith('raw-')) {
  const { callSyntax } = await import(
    pathToFileURL(join(artifact.packageRoot, 'dist/wasm-instance.js')).href
  );
  operation = rawOperation(callSyntax, fixture, phase.slice(4), optionsFor(api, fixture));
} else if (phase.startsWith('lint-')) {
  const require = createRequire(consumer.entry);
  const { Linter } = await import(pathToFileURL(require.resolve('eslint')).href);
  const { default: plugin } = await import(pathToFileURL(consumer.entry).href);
  lintVersion = require('eslint/package.json').version;
  const linter = new Linter();
  const config = lintConfiguration(plugin, phase, counts);
  operation = {
    setup: () => null,
    run: () => {
      counts.nodes = counts.markers = counts.functions = 0;
      return linter.verify(fixture.source, config, { filename: 'benchmark.sh' });
    },
    verify: (messages) => {
      assert.deepEqual(messages, [], 'lint must parse without diagnostics');
      if (phase === 'lint-probe-rule') {
        assert(counts.nodes > 0, 'probe must visit syntax');
        assert.equal(counts.markers, fixture.markers, 'all marker leaves visited');
        if (fixture.dimensions?.functions)
          assert.equal(counts.functions, fixture.dimensions.functions);
        if (fixture.name === 'consumer-m2')
          assert.equal(counts.nodes, 5801, 'M2 consumer must visit every Node');
      }
    },
  };
} else operation = operationFor(api, fixture, phase);
assert(operation, `unsupported phase ${phase}`);

let result;
if (!probe) result = executePhase(operation, iterations, warmup);
else {
  const state = operation.setup();
  probe.reset();
  const value = operation.run(state);
  const transport = probe.read();
  operation.verify(value);
  const expected = phase.startsWith('lint-') ? 'parse-with-positions' : phase.replace(/^raw-/, '');
  assert.deepEqual(
    Object.fromEntries(Object.entries(transport).map(([key, record]) => [key, record.calls])),
    { [expected]: 1 },
    'each operation must actually parse once',
  );
  const parsed = api.parseWithPositionsSync(fixture.source, optionsFor(api, fixture));
  verifyTree(parsed.File, fixture);
  const stored = records(parsed.File);
  const nodes = stored.filter((node) => api.SYNTAX_INTERFACES.Node.includes(node.Type));
  if (fixture.name === 'consumer-m2') {
    assert.equal(nodes.length, 5801, 'exact M2 tree completeness');
    assert.equal(stored.filter((node) => node.Type === 'FuncDecl').length, 100);
  }
  const positions = nodes.map((node) => parsed.Positions.get(node));
  assert(positions.every(Boolean), 'every stored Node has a snapshot');
  // Bound/print calls are smoke checks only, outside all reported clocks and operation budgets.
  const smoke = {
    pos: api.nodePos(parsed.File),
    end: api.nodeEnd(parsed.File),
    printed: api.printSync(parsed.File),
  };
  verifyTree(api.parseSync(smoke.printed, optionsFor(api, fixture)), fixture);
  result = {
    status: 'ok',
    transport,
    nodes: nodes.length,
    counts,
    treeHash: hash(JSON.stringify(parsed.File)),
    positionsHash: hash(JSON.stringify(positions)),
    smokeHash: hash(JSON.stringify(smoke)),
    ...(phase.startsWith('raw-')
      ? { responseHash: hash(value), responseBytes: Buffer.byteLength(value) }
      : {}),
  };
}
console.log(
  JSON.stringify({
    pid: process.pid,
    node: process.version,
    execPath: process.execPath,
    phase,
    mode,
    eslintVersion: lintVersion,
    ...result,
  }),
);
