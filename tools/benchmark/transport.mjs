/** Optional WASM instrumentation lives only in verification workers, never in latency workers. */
import assert from 'node:assert/strict';

/** Intercept the two published bridge ABIs while preserving the runtime's instance interface. */
export function instrument() {
  let observations = {};
  const Original = WebAssembly.Instance;
  WebAssembly.Instance = function (module, imports) {
    const instance = new Original(module, imports);
    const exposed = { ...instance.exports };
    for (const name of ['syntaxProcess', 'process']) {
      if (typeof exposed[name] !== 'function') continue;
      const raw = exposed[name];
      exposed[name] = (...args) => {
        const operation =
          name === 'process'
            ? 'parse'
            : new TextDecoder().decode(new Uint8Array(exposed.mem.buffer, args[0], args[1]));
        const record = (observations[operation] ??= { calls: 0, payloadBytes: 0 });
        record.calls++;
        record.payloadBytes += args[name === 'process' ? 1 : 3];
        return raw(...args);
      };
    }
    return new Proxy(instance, {
      get(target, key) {
        return key === 'exports' ? exposed : Reflect.get(target, key, target);
      },
    });
  };
  WebAssembly.Instance.prototype = Original.prototype;
  return {
    reset() {
      observations = {};
    },
    read() {
      return structuredClone(observations);
    },
  };
}
/** Budgets describe one actual API operation, excluding setup and post-operation validation. */
export function assertBudget(phase, observed, nodes) {
  const expected = {};
  if (['parse', 'first-parse'].includes(phase)) expected.parse = 1;
  if (phase === 'parse-with-positions') expected['parse-with-positions'] = 1;
  if (['print', 'edited-print'].includes(phase)) expected.print = 1;
  if (phase.startsWith('bounds-')) {
    expected.pos = nodes;
    expected.end = nodes;
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(observed).map(([key, value]) => [key, value.calls])),
    expected,
    `bridge budget for ${phase}`,
  );
}
