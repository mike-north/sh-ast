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
import { instrumentStages, stageNames } from './stages.mjs';
import { summarize } from './model.mjs';

const request = JSON.parse(readFileSync(0, 'utf8'));
const { entry, fixture, phase: requestedPhase, iterations, warmup, mode } = request;
// A stage phase performs its base phase's work while attributing each call to stages.
const stagePhase = requestedPhase.endsWith('-stages');
const phase = stagePhase ? requestedPhase.slice(0, -'-stages'.length) : requestedPhase;
const probe = mode === 'verify' ? instrument() : null;
const stages = stagePhase && !probe ? instrumentStages() : null;
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
  if (!operation || (stages && !api.SYNTAX_SCHEMA)) result = { status: 'unsupported' };
  else if (stages) result = executeStages(operation, stages);
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
    const stored = records(tree);
    // Counts describe each API's real output; normalized records are not faithful Nodes.
    const work = {
      storedRecords: stored.length,
      functions: stored.filter((node) => (node.Type ?? node.type) === 'FuncDecl').length,
      ...(api.SYNTAX_INTERFACES
        ? {
            nodes: stored.filter((node) => api.SYNTAX_INTERFACES.Node.includes(node.Type)).length,
          }
        : {}),
    };
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
  JSON.stringify({
    pid: process.pid,
    phase: requestedPhase,
    mode,
    contract: contractFor(api, requestedPhase),
    ...result,
  }),
);

/**
 * Like executePhase, but each measured call also yields its stage durations.
 * A stage the package cannot report (null in every call) is unsupported.
 */
function executeStages(operation, probe) {
  const state = operation.setup();
  // WASM is instantiated lazily, so ABI support is known only after one call.
  operation.verify(operation.run(state));
  if (!probe.supported) return { status: 'unsupported' };
  for (let i = 0; i < warmup; i++) operation.verify(operation.run(state));
  const samples = [];
  const byStage = Object.fromEntries(stageNames.map((name) => [name, []]));
  for (let i = 0; i < iterations; i++) {
    probe.begin();
    const value = operation.run(state);
    const observed = probe.end();
    operation.verify(value);
    samples.push(observed.input + observed.wasm + observed.transfer + observed.decode);
    for (const name of stageNames) byStage[name].push(observed[name]);
  }
  const stageResults = Object.fromEntries(
    stageNames.map((name) =>
      byStage[name].every((value) => value === null)
        ? [name, { status: 'unsupported' }]
        : [name, { status: 'ok', samples: byStage[name] }],
    ),
  );
  return { status: 'ok', samples, summary: summarize(samples), stages: stageResults };
}
