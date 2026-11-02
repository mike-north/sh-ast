/**
 * Installed-style, fresh-process evidence for synchronous initialization. The
 * process imports built output with no prewarming and observes actual WASM
 * construction, rather than inferring reuse from repeated equal parse results.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('cold built-package startup', () => {
  it('returns before a queued microtask and creates one reusable WASM instance', () => {
    const preload = `
      globalThis.syntaxCounts = { module: 0, instance: 0 };
      for (const [name, counter] of [['Module', 'module'], ['Instance', 'instance']]) {
        const original = WebAssembly[name];
        WebAssembly[name] = new Proxy(original, {
          construct(target, args, constructor) {
            globalThis.syntaxCounts[counter]++;
            return Reflect.construct(target, args, constructor);
          },
        });
      }
    `;
    const entry = new URL('../dist/index.js', import.meta.url).href;
    const source = `
      import assert from 'node:assert/strict';
      import { performance } from 'node:perf_hooks';
      import { parseSync, ParseError } from ${JSON.stringify(entry)};
      assert.deepEqual(globalThis.syntaxCounts, { module: 0, instance: 0 });
      let microtaskRan = false;
      queueMicrotask(() => { microtaskRan = true; });
      const start = performance.now();
      const first = parseSync('echo cold');
      const coldMs = performance.now() - start;
      assert.equal(first.Type, 'File');
      assert.equal(microtaskRan, false);
      assert.equal(typeof first.then, 'undefined');
      assert.throws(() => parseSync('('), ParseError);
      const warmStart = performance.now();
      assert.equal(parseSync('echo warm').Type, 'File');
      const warmMs = performance.now() - warmStart;
      assert.deepEqual(globalThis.syntaxCounts, { module: 1, instance: 1 });
      console.log(JSON.stringify({ coldMs, warmMs, counts: globalThis.syntaxCounts }));
    `;
    const output = execFileSync(
      process.execPath,
      [
        `--import=data:text/javascript,${encodeURIComponent(preload)}`,
        '--input-type=module',
        '-e',
        source,
      ],
      { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 30_000 },
    );
    expect(output).toContain('"module":1,"instance":1');
  }, 35_000);
});
