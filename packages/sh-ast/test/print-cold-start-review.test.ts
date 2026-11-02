/**
 * Printing is a first operation on the built public package. A fresh process
 * observes actual WASM construction and synchronous return without parse or
 * position prewarming, then proves reuse across an ordinary printing error.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('prints cold before a queued microtask and reuses one runtime after a PrintError', () => {
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
    import { printSync, PrintError, parseSync } from ${JSON.stringify(entry)};
    assert.deepEqual(globalThis.syntaxCounts, { module: 0, instance: 0 });
    let microtaskRan = false;
    queueMicrotask(() => { microtaskRan = true; });
    const first = printSync({ Type: 'File', Name: '', Stmts: null, Last: null });
    assert.equal(first, '\\n');
    assert.equal(microtaskRan, false);
    assert.deepEqual(globalThis.syntaxCounts, { module: 1, instance: 1 });
    const zero = { Offset: 0, Line: 0, Col: 0, IsValid: false, IsRecovered: false, OffsetOverflow: false };
    assert.throws(() => printSync({ Type: 'Comment', Hash: zero, Text: 'unsupported root' }), PrintError);
    assert.equal(printSync(parseSync('echo healthy')), 'echo healthy\\n');
    assert.equal(microtaskRan, false);
    assert.deepEqual(globalThis.syntaxCounts, { module: 1, instance: 1 });
    await Promise.resolve();
    assert.equal(microtaskRan, true);
    console.log(JSON.stringify({ first, counts: globalThis.syntaxCounts, reuse: 'healthy' }));
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
  expect(JSON.parse(output)).toEqual({
    first: '\n',
    counts: { module: 1, instance: 1 },
    reuse: 'healthy',
  });
}, 35_000);
