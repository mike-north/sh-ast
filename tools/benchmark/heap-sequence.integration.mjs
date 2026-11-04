/**
 * Large-input public-API sequences must leave the WASM instance usable. This
 * guards the js/wasm runtime failure in which an itab first built while a GC is
 * marking a heap larger than the module's numeric method "PCs" aborts the Go
 * runtime ("found bad pointer in Go heap"), after which every call throws. See
 * packages/sh-ast/shim/internal/syntaxwire/itabs.go. The failure depends on
 * heap layout, so the sequence runs at several sizes, each in a fresh process.
 *
 * SH_AST_ENTRY may name another built package's dist/index.js, to confirm the
 * test fails on a build without the fix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const entry =
  process.env.SH_AST_ENTRY ??
  fileURLToPath(new URL('../../packages/sh-ast/dist/index.js', import.meta.url));
const m2 = JSON.parse(
  readFileSync(new URL('./fixtures/consumer-m2.json', import.meta.url), 'utf8'),
).source;

/** Repetition counts of the 701-line fixture; 100 and 120 failed before the fix. */
const SIZES = [60, 80, 90, 100, 110, 120, 130, 150];

/**
 * The reported sequence: two failing and recovered parses, an invalid-UTF-8
 * parse error, then a large and a small positions parse. Each step's expected
 * outcome is asserted, so a dead instance cannot pass as an expected error.
 */
const child = `
const [entry, k, m2] = [process.argv[1], Number(process.argv[2]), process.argv[3]];
const { parseSync, parseWithPositionsSync, ParseError } = await import(entry);
const big = m2.repeat(k), fail = big + '\\nif true; then\\n';
const invalid = new Uint8Array([...new TextEncoder().encode(m2.repeat(Math.ceil(k * 0.6))), 0xff, 10]);
const parseError = (run) => { try { run(); } catch (error) { if (error instanceof ParseError) return; throw error; } throw new Error('expected ParseError'); };
parseError(() => parseSync(fail, { KeepComments: true }));
parseSync(fail, { KeepComments: true, RecoverErrors: 2 });
parseError(() => parseSync(invalid, { KeepComments: true }));
const parsed = parseWithPositionsSync(big, { KeepComments: true });
if (parsed.File.Stmts.length !== 200 * k) throw new Error('large File lost statements');
const small = parseWithPositionsSync('echo hi', {});
if (small.File.Stmts.length !== 1) throw new Error('instance unusable after large parse');
console.log('sequence ok');
`;

const run = promisify(execFile);

test('large parse sequences never abort the Go runtime', { timeout: 15 * 60 * 1000 }, async () => {
  // Two at a time: fresh processes are independent, and this bounds memory.
  const failures = [];
  for (let i = 0; i < SIZES.length; i += 2) {
    await Promise.all(
      SIZES.slice(i, i + 2).map(async (k) => {
        try {
          const { stdout } = await run(
            process.execPath,
            ['--input-type=module', '-e', child, entry, String(k), m2],
            { maxBuffer: 1 << 24, timeout: 10 * 60 * 1000 },
          );
          if (!stdout.includes('sequence ok')) failures.push(`k=${k}: ${stdout}`);
        } catch (error) {
          const output = `${error.stderr ?? ''}`.split('\n').slice(0, 3).join(' | ');
          failures.push(`k=${k}: exit ${error.code}: ${output}`);
        }
      }),
    );
  }
  assert.deepEqual(failures, []);
});
