/** Proves the CI check rejects compiler errors that typed ESLint cannot report. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const fixture = resolve('packages/sh-ast/test/standards-implicit-control.test.ts');
const source = `/** An unused input still requires an explicit type. @internal */
export function ignore(_input) {
  return 1;
}
`;

test('the real CI check rejects TS7006 in an otherwise lint-clean test helper', () => {
  let created = false;
  try {
    writeFileSync(fixture, source, { flag: 'wx' });
    created = true;
    // The independent compiler establishes the semantic defect, rather than an
    // option-string assertion or a failure caused by another quality gate.
    const program = ts.createProgram([fixture], { strict: true, noEmit: true });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.ok(diagnostics.some((entry) => entry.file?.fileName === fixture && entry.code === 7006));
    const result = spawnSync('pnpm', ['check'], {
      encoding: 'utf8',
      env: { ...process.env, NX_SKIP_NX_CACHE: 'true' },
      maxBuffer: 16 * 1024 * 1024,
    });
    const output = result.stdout + result.stderr;
    console.log(`Independent compiler: TS7006; real pnpm check exit: ${result.status}\n${output}`);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, null);
    assert.notEqual(result.status, 0, 'CI must reject the implicit-any helper');
    assert.match(output, /standards-implicit-control\.test\.ts[^\n]*TS7006/);
  } finally {
    if (created) {
      unlinkSync(fixture);
    }
  }
});

// Authored files in all four projects must be discovered on disk, including
// extensions that do not yet occur in the repository. Type-contract assertions
// keep their tsd meaning; an unrelated implicit-any helper must still fail.
for (const directory of ['src', 'test', 'generated', 'test-d']) {
  test(`the real CI check rejects implicit any in every ${directory} TypeScript extension`, () => {
    // Distinct basenames prevent TypeScript from preferring .ts over a sibling .tsx.
    const fixtures = ['ts', 'mts', 'cts', 'tsx'].map((extension) =>
      resolve(
        `packages/sh-ast/${directory}/standards-extension-${extension}-control.test.${extension}`,
      ),
    );
    const created = [];
    try {
      for (const path of fixtures) {
        writeFileSync(
          path,
          '/** An unused local input must not silently become any. */\nfunction _ignore(_input) {\n  return 1;\n}\n',
          { flag: 'wx' },
        );
        created.push(path);
      }
      const result = spawnSync('pnpm', ['check'], {
        encoding: 'utf8',
        env: { ...process.env, NX_SKIP_NX_CACHE: 'true' },
        maxBuffer: 16 * 1024 * 1024,
      });
      const output = result.stdout + result.stderr;
      console.log(
        `${directory} extension control; real pnpm check exit: ${result.status}\n${output}`,
      );
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, null);
      assert.notEqual(result.status, 0);
      for (const extension of ['ts', 'mts', 'cts', 'tsx']) {
        assert.match(
          output,
          new RegExp(
            `standards-extension-${extension}-control\\.test\\.${extension}[^\\n]*(?:\\n[^\\n]*){0,3}implicitly has an ['\"‘’]?any['\"‘’]? type`,
          ),
        );
      }
      assert.match(output, /implicitly has an ['"‘’]?any['"‘’]? type/);
    } finally {
      for (const path of created) {
        unlinkSync(path);
      }
    }
  });
}
