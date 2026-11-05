/**
 * Fresh-process regression for golang/go#80472. On js/wasm, runtime.itabInit
 * stored method PCs through a GC write barrier, and those PCs overlap heap
 * addresses once the Go heap has grown. The first time a print or positions
 * call built new multi-method itabs after that, the runtime aborted with
 * "fatal error: found bad pointer in Go heap" and every later call failed.
 * Fixed in go1.26.6 and go1.27.0; these sequences aborted go1.26.5 builds and
 * must keep succeeding on the toolchain pinned in shim/go.mod.
 *
 * Each sequence runs in its own child process against the built package: the
 * abort poisons the whole runtime, and a warm process hides the cold itabs.
 *
 * Whether a given size aborts depends on the Go heap layout, which the bridge's
 * transport (encoder buffers, response sizes, allocation pattern) determines.
 * One size that aborted before a transport change can pass afterwards on a
 * defective toolchain, so several sizes run. Any change to the transport must
 * re-prove this test: build the shim with go1.26.5 using the CI recipe, confirm
 * at least one size here fails, and add sizes until one does.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const entry = new URL('../dist/index.js', import.meta.url).href;
const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../tools/benchmark/fixtures/${name}.json`, import.meta.url));

/**
 * Heap-growth multiplier k and print-body multiplier j per fixture. Each listed
 * size aborted a go1.26.5 build of either main or this transport (see header).
 */
const SIZES: readonly { fixture: string; k: number; j: number }[] = [
  { fixture: 'representative-50', k: 10, j: 2 },
  { fixture: 'consumer-m2', k: 20, j: 2 },
  { fixture: 'consumer-m2', k: 30, j: 3 },
];

// Each target is parsed from source, then its picked node is printed. The
// expectation per step is hand-written: node types the printer does not accept
// reject with PrintError (a normal, recoverable result), the rest print.
const childSource = (path: string, k: number, j: number): string => `
  import { readFileSync } from 'node:fs';
  const lib = await import(${JSON.stringify(entry)});
  const base = JSON.parse(readFileSync(${JSON.stringify(path)}, 'utf8')).source;
  const k = ${String(k)};
  const j = ${String(j)};
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

const EXPECTED = [
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
];

const run = promisify(execFile);

/** Runs one size in a fresh process; an abort or a wrong step is a failure line. */
async function sequence(size: (typeof SIZES)[number]): Promise<string | null> {
  const label = `${size.fixture} k=${String(size.k)} j=${String(size.j)}`;
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ['--input-type=module', '-e', childSource(fixture(size.fixture), size.k, size.j)],
      { encoding: 'utf8', cwd: packageRoot, timeout: 240_000, maxBuffer: 1 << 24 },
    );
    const { results, printed } = JSON.parse(stdout.trim().split('\n').pop() ?? '') as {
      results: [string, string][];
      printed: string;
    };
    if (JSON.stringify(results) !== JSON.stringify(EXPECTED) || printed !== 'echo') {
      // The Go runtime reports an abort on stderr; the child itself keeps running.
      const fatal = stderr.split('\n').find((line) => line.startsWith('fatal error')) ?? '';
      return `${label}: ${fatal} ${JSON.stringify({ results, printed })}`;
    }
    return null;
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? error);
    return `${label}: ${stderr.split('\n').slice(0, 2).join(' | ')}`;
  }
}

describe('Go runtime itab abort (golang/go#80472)', () => {
  it('survives printing and positions after the Go heap has grown, at every size', async () => {
    const failures: string[] = [];
    // Two at a time: processes are independent, and this bounds peak memory.
    for (let i = 0; i < SIZES.length; i += 2) {
      const outcomes = await Promise.all(SIZES.slice(i, i + 2).map(sequence));
      for (const outcome of outcomes) if (outcome !== null) failures.push(outcome);
    }
    expect(failures).toEqual([]);
  }, 600_000);
});
