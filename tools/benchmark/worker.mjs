/** One fresh process owns one artifact/fixture/phase; first use cannot inherit another phase's runtime. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { executePhase } from './model.mjs';
import {
  operationFor,
  contractFor,
  optionsFor,
  records,
  verifyWalk,
  verifyBounds,
  verifySnapshot,
} from './adapter.mjs';
import { instrument, assertBudget } from './transport.mjs';

const request = JSON.parse(readFileSync(0, 'utf8'));
const { entry, fixture, phase, iterations, warmup, mode } = request;
const probe = mode === 'verify' ? instrument() : null;
const start = performance.now();
const api = await import(pathToFileURL(entry).href);
const importMs = performance.now() - start;
let result;
if (phase === 'import') {
  if (probe) {
    const transport = probe.read();
    assertBudget('import', transport, 0);
    result = { status: 'ok', transport };
  } else result = { status: 'ok', samples: [importMs] };
} else {
  const operation = operationFor(api, fixture, phase);
  if (!operation) result = { status: 'unsupported' };
  else if (!probe)
    result = executePhase(
      operation,
      phase === 'first-parse' ? 1 : iterations,
      phase === 'first-parse' ? 0 : warmup,
    );
  else {
    const state = operation.setup();
    probe.reset();
    const value = operation.run(state);
    const transport = probe.read();
    const nodeCount = phase.startsWith('bounds-') ? state.length : 0;
    assertBudget(phase, transport, nodeCount);
    operation.verify(value);
    const tree = api.parseSync(fixture.source, optionsFor(api, fixture));
    const work = { storedRecords: records(tree).length };
    if (api.walk) work.traversal = verifyWalk(api, tree, fixture);
    if (api.nodePos) {
      verifyBounds(api, tree, fixture);
      if (api.parseWithPositionsSync) {
        const parsed = api.parseWithPositionsSync(fixture.source, optionsFor(api, fixture));
        verifyBounds(api, parsed.File, fixture, parsed.Positions);
        if (fixture.markers === 1 && fixture.source.length < 1000) verifySnapshot(api, parsed);
      }
    }
    result = { status: 'ok', transport, nodeCount, work };
  }
}
console.log(
  JSON.stringify({ pid: process.pid, phase, mode, contract: contractFor(api, phase), ...result }),
);
