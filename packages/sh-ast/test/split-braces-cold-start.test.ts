/**
 * The built public SplitBraces API can be the first WASM operation. A fresh
 * process proves immediate return and one reusable runtime without parse warmup.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('splits before a queued microtask and initializes the runtime only once', () => {
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
    import { splitBraces, InputError } from ${JSON.stringify(entry)};
    const zero = { Offset: 0, Line: 0, Col: 0, IsValid: false, IsRecovered: false, OffsetOverflow: false };
    const word = { Type: 'Word', Parts: [{ Type: 'Lit', Value: '{a,b}', ValuePos: zero, ValueEnd: zero }] };
    assert.deepEqual(globalThis.syntaxCounts, { module: 0, instance: 0 });
    let microtaskRan = false;
    queueMicrotask(() => { microtaskRan = true; });
    assert.equal(splitBraces(word), true);
    assert.equal(microtaskRan, false);
    assert.equal(word.Parts[0].Type, 'BraceExp');
    assert.throws(() => splitBraces(null), InputError);
    assert.equal(splitBraces({ Type: 'Word', Parts: null }), false);
    assert.equal(microtaskRan, false);
    assert.deepEqual(globalThis.syntaxCounts, { module: 1, instance: 1 });
    console.log(JSON.stringify(globalThis.syntaxCounts));
  `;
  const output = execFileSync(
    process.execPath,
    [
      `--import=data:text/javascript,${encodeURIComponent(preload)}`,
      '--input-type=module',
      '-e',
      source,
    ],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 30_000 },
  );
  expect(JSON.parse(output)).toEqual({ module: 1, instance: 1 });
}, 35_000);
