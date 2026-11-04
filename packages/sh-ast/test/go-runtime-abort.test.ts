/**
 * Fresh-process regression for golang/go#80472. On js/wasm, runtime.itabInit
 * stored method PCs through a GC write barrier, and those PCs overlap heap
 * addresses once the Go heap has grown. The first time a print or positions
 * call built new multi-method itabs after that, the runtime aborted with
 * "fatal error: found bad pointer in Go heap" and every later call failed.
 * Fixed in go1.26.6 and go1.27.0; this sequence aborted a go1.26.5 build and
 * must keep succeeding on the toolchain pinned in shim/go.mod.
 *
 * The sequence runs in a child process against the built package because the
 * abort poisons the whole runtime: an in-process test would take every later
 * test in the worker down with it, and a warm process hides the cold itabs.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(
  new URL('../../../tools/benchmark/fixtures/representative-50.json', import.meta.url),
);
const entry = new URL('../dist/index.js', import.meta.url).href;

/** Heap-growth multiplier and body size that aborted go1.26.5 builds. */
const GROWTH = 10;
const BODY = 2;

// Each target is parsed from source, then its picked node is printed. The
// expectation per step is hand-written: node types the printer does not accept
// reject with PrintError (a normal, recoverable result), the rest print.
const childSource = `
  import { readFileSync } from 'node:fs';
  const lib = await import(${JSON.stringify(entry)});
  const base = JSON.parse(readFileSync(${JSON.stringify(fixture)}, 'utf8')).source;
  const k = ${String(GROWTH)};
  const j = ${String(BODY)};
  const results = [];
  const step = (name, f) => {
    try { f(); results.push([name, 'ok']); }
    catch (e) { results.push([name, e.constructor.name]); }
  };
  step('grow', () => lib.parseWithPositionsSync(base.repeat(k), { KeepComments: true }));
  const body = base.repeat(j);
  const targets = [
    ['CaseItem', 'case x in\\na)\\n' + body + '\\n;;\\nesac\\n', (f) => f.Stmts[0].Cmd.Items[0]],
    ['Redirect', 'cat <<EOF\\n' + body + 'EOF\\n', (f) => f.Stmts[0].Redirs[0]],
    ['DblQuoted', 'echo "' + '$a'.repeat(20000 * j) + '"\\n', (f) => f.Stmts[0].Cmd.Args[1].Parts[0]],
    ['ParamExp', 'echo \${x:-' + '$b'.repeat(20000 * j) + '}\\n', (f) => f.Stmts[0].Cmd.Args[1].Parts[0]],
    ['Lit', 'echo ' + 'a'.repeat(400000 * j) + '\\n', (f) => f.Stmts[0].Cmd.Args[1].Parts[0]],
    ['Comment', '# ' + 'c'.repeat(400000 * j) + '\\n:\\n', (f) => f.Stmts[0].Comments[0]],
    ['CmdSubst', 'echo $(' + body + ')\\n', (f) => f.Stmts[0].Cmd.Args[1].Parts[0]],
  ];
  for (const [name, src, pick] of targets) {
    let node;
    step('parse ' + name, () => { node = pick(lib.parseSync(src, { KeepComments: true })); });
    step('print ' + name, () => lib.printSync(node));
  }
  let printed = '';
  step('liveness', () => { printed = lib.printSync(lib.parseSync('echo hi').Stmts[0].Cmd.Args[0]); });
  console.log(JSON.stringify({ results, printed }));
`;

describe('Go runtime itab abort (golang/go#80472)', () => {
  it('survives printing and positions after the Go heap has grown', () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', childSource], {
      encoding: 'utf8',
      cwd: packageRoot,
      timeout: 120_000,
    });
    const { results, printed } = JSON.parse(output.trim().split('\n').pop() ?? '') as {
      results: [string, string][];
      printed: string;
    };

    expect(results).toEqual([
      ['grow', 'ok'],
      ['parse CaseItem', 'ok'],
      ['print CaseItem', 'PrintError'],
      ['parse Redirect', 'ok'],
      ['print Redirect', 'PrintError'],
      ['parse DblQuoted', 'ok'],
      ['print DblQuoted', 'ok'],
      ['parse ParamExp', 'ok'],
      ['print ParamExp', 'ok'],
      ['parse Lit', 'ok'],
      ['print Lit', 'ok'],
      ['parse Comment', 'ok'],
      ['print Comment', 'PrintError'],
      ['parse CmdSubst', 'ok'],
      ['print CmdSubst', 'ok'],
      ['liveness', 'ok'],
    ]);
    expect(printed).toBe('echo');
  }, 150_000);
});
