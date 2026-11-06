/** A prepared candidate must include the files its manifest promises, even from a clean build. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyEntrypoints } from './artifacts.mjs';

test('preparation rejects missing declared runtime and type entrypoints', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sh-ast-entrypoints-test-'));
  try {
    mkdirSync(join(directory, 'dist'));
    writeFileSync(join(directory, 'dist/index.js'), 'export {};');
    const manifest = {
      main: './dist/index.js',
      types: './dist/sh-ast.d.ts',
      exports: {
        '.': { default: './dist/index.js', types: './dist/sh-ast.d.ts' },
      },
    };
    assert.throws(() => verifyEntrypoints(directory, manifest), /sh-ast.d.ts/);
    writeFileSync(join(directory, 'dist/sh-ast.d.ts'), 'export {};');
    assert.doesNotThrow(() => verifyEntrypoints(directory, manifest));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
