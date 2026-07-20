/**
 * Tests for https://github.com/mike-north/sh-ast/issues/23: `sh-ast/analyze`
 * re-exports the shared base error class (`ShAstError`) and the base AST
 * types (`ShNode`, `Position`) that the subpath's public surface consumes
 * and exposes, so a consumer of the analyze subpath can catch/reference them
 * without also importing from the root `sh-ast` entry point.
 *
 * @see design/PACKAGES.md §`sh-ast` — the public API under test
 */
import { describe, expect, it } from 'vitest';
import {
  ShAnalyzeInvalidWrapperSpecError,
  ShAnalyzeMaxDepthError,
  ShAstError,
  enumerateCommands,
} from '../src/analyze/index.js';
import type { ShNode } from '../src/analyze/index.js';

const SYNTHETIC_LOC = { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } };

function syntheticNode(type: string, fields: Readonly<Record<string, unknown>> = {}): ShNode {
  return { type, range: [0, 0], loc: SYNTHETIC_LOC, ...fields };
}

/**
 * A synthetic, hand-built tree of `n` nested `Subshell` frames — mirrors
 * `analyze-enumerate-commands.test.ts`'s own `syntheticNestedSubshells`
 * helper, bypassing `parseSync` (and its own, unrelated depth guard)
 * entirely so this test exercises only `enumerateCommands`'s guard.
 */
function syntheticNestedSubshells(n: number): ShNode {
  let acc = syntheticNode('Stmt', {
    cmd: syntheticNode('CallExpr', {
      args: [syntheticNode('Word', { parts: [syntheticNode('Lit', { value: 'inner' })] })],
    }),
  });
  for (let i = 0; i < n; i += 1) {
    acc = syntheticNode('Stmt', { cmd: syntheticNode('Subshell', { stmts: [acc] }) });
  }
  return acc;
}

describe('ShAstError reachable from sh-ast/analyze (issue #23)', () => {
  it('is the same class as the root entry point export (not a re-declared duplicate)', async () => {
    const root = await import('../src/index.js');
    expect(ShAstError).toBe(root.ShAstError);
  });

  it('lets a consumer catch/reference the base without importing from root sh-ast', () => {
    expect.assertions(2);
    try {
      enumerateCommands(syntheticNestedSubshells(501));
    } catch (error) {
      // Both the concrete subclass and the shared base imported from
      // `sh-ast/analyze` alone narrow this error correctly.
      expect(error).toBeInstanceOf(ShAnalyzeMaxDepthError);
      expect(error).toBeInstanceOf(ShAstError);
    }
  });

  it('ShAnalyzeInvalidWrapperSpecError is also an instance of the analyze-imported ShAstError', () => {
    expect.assertions(1);
    try {
      throw new ShAnalyzeInvalidWrapperSpecError('names must be a non-empty array');
    } catch (error) {
      expect(error).toBeInstanceOf(ShAstError);
    }
  });
});
