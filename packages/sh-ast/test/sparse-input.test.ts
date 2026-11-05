/** Sparse list holes are missing required records, unlike explicit upstream nil entries. */
import { expect, it } from 'vitest';
import type { File, Stmt } from '../src/index.js';
import { InputError, nodePos, PrintPanicError, printSync } from '../src/index.js';

/** A File's list shape distinguishes absent slots, empty slices, and explicit nil elements. */
function fileWithStatements(Stmts: File['Stmts']): File {
  return { Type: 'File', Name: '', Stmts, Last: [] };
}

it('rejects a sparse statement slot before printing an unrepresentable record', () => {
  const sparse = fileWithStatements(new Array<Stmt | null>(1));
  expect(() => printSync(sparse)).toThrow(InputError);
  expect(() => printSync(sparse)).toThrow('Expected a complete, acyclic upstream Node record');
});

it('rejects a sparse statement slot before computing a native bound', () => {
  const sparse = fileWithStatements(new Array<Stmt | null>(1));
  expect(() => nodePos(sparse)).toThrow(InputError);
  expect(() => nodePos(sparse)).toThrow('Expected a complete, acyclic upstream Node record');
});

it('preserves an empty statement slice as a printable empty File', () => {
  expect(printSync(fileWithStatements([]))).toBe('\n');
});

it('retains native printer panic identity for an explicit nil statement', () => {
  expect(() => printSync(fileWithStatements([null]))).toThrow(PrintPanicError);
});
