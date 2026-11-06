/**
 * A consumer installation establishes the syntax package's responsibility
 * boundary independently of workspace aliases and source-relative imports.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The temporary consumer has no analysis or ESLint packages available. */
let consumer: string;

beforeAll(() => {
  consumer = mkdtempSync(join(tmpdir(), 'sh-ast-syntax-boundary-'));
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer], {
      cwd: packageRoot,
      encoding: 'utf8',
    }),
  ) as { filename: string }[];
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--package-lock=false',
      '--no-audit',
      '--no-fund',
      join(consumer, packed[0].filename),
    ],
    { cwd: consumer, encoding: 'utf8' },
  );
}, 30_000);

afterAll(() => {
  if (consumer) rmSync(consumer, { recursive: true, force: true });
});

/** Every probe imports the installed package in an uninitialized Node process. */
function probe(source: string): string {
  return execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: consumer,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('installed syntax-only package', () => {
  it('excludes retired analysis runtime and declaration artifacts', () => {
    const installed = join(consumer, 'node_modules/sh-ast');
    expect(existsSync(join(installed, 'dist/analyze'))).toBe(false);
    expect(existsSync(join(installed, 'dist/analyze.d.ts'))).toBe(false);
  });

  it('keeps first-use parse, traversal, bounds, printing and syntax constants synchronous', () => {
    expect(
      probe(`
      import assert from 'node:assert/strict';
      import { parseSync, walk, printSync, nodePos, nodeEnd, LangBash, ShAstError, ParseError } from 'sh-ast';
      let microtaskRan = false;
      queueMicrotask(() => { microtaskRan = true; });
      const file = parseSync('echo "🎉 你好 e\\u0301"\\n', { Variant: LangBash });
      assert.equal(file.Type, 'File');
      assert.equal(microtaskRan, false);
      assert.equal(typeof file.then, 'undefined');
      const call = file.Stmts[0].Cmd;
      assert.equal(nodePos(call).Offset, 0);
      assert.equal(nodeEnd(call).Offset, Buffer.byteLength('echo "🎉 你好 e\\u0301"'));
      const kinds = [];
      walk(file, node => { if (node) kinds.push(node.Type); return true; });
      assert.ok(kinds.includes('CallExpr'));
      assert.equal(printSync(file), 'echo "🎉 你好 e\\u0301"\\n');
      assert.throws(() => parseSync('('), error => error instanceof ParseError && error instanceof ShAstError);
      console.log('synchronous syntax operations');
    `),
    ).toContain('synchronous syntax operations');
  }, 35_000);

  it('rejects the former analysis subpath instead of forwarding it', () => {
    expect(
      probe(`
      import assert from 'node:assert/strict';
      await assert.rejects(import('sh-ast/analyze'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
      console.log('analysis subpath absent');
    `),
    ).toContain('analysis subpath absent');
  });

  it('exports no analysis operations or analysis failure classes from the root', () => {
    expect(
      probe(`
      import assert from 'node:assert/strict';
      import * as syntax from 'sh-ast';
      for (const name of ['resolveWord', 'resolveArgv0', 'enumerateCommands', 'ShAnalyzeMaxDepthError', 'ShAnalyzeInvalidWrapperSpecError']) {
        assert.equal(Object.hasOwn(syntax, name), false, name);
      }
      console.log('syntax namespace only');
    `),
    ).toContain('syntax namespace only');
  });

  it('publishes only its syntax entry point and has no consumer-layer dependencies', () => {
    const manifest = JSON.parse(
      readFileSync(join(consumer, 'node_modules/sh-ast/package.json'), 'utf8'),
    ) as {
      exports: Record<string, unknown>;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.exports)).toEqual(['.']);
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    };
    expect(
      Object.keys(dependencies).filter((name) => name === 'sh-analysis' || name.includes('eslint')),
    ).toEqual([]);
  });
});
