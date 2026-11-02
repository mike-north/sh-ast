/**
 * Issue #2 regressions: Do is a statement list distinct from DoPos. Preserve
 * nested loop bodies, no-op bodies, and exact multibyte command contents.
 */
import { describe, expect, it } from 'vitest';
import { parseSync } from '../src/index.js';
import { firstNode, nodes, sourceText } from './regression-helpers.js';

const unicode = 'for x in 🎉 你好; do echo "café 🎉 你好 e\u0301"; done\n';

describe('loop body preservation', () => {
  it.each([
    ['for x in a b; do echo "$x"; done', 'ForClause'],
    ['while true; do echo hi; done', 'WhileClause'],
    ['until false; do echo hi; done', 'WhileClause'],
  ] as const)('retains the body of %s', (source, type) => {
    const clause = firstNode(parseSync(source), type);
    expect(clause.Do).toHaveLength(1);
    const stmt = clause.Do?.[0];
    if (!stmt) throw new Error('Missing body');
    expect(firstNode(stmt, 'CallExpr').Args?.[0]?.Parts?.[0]).toMatchObject({
      Type: 'Lit',
      Value: 'echo',
    });
    expect(clause.DoPos.IsValid).toBe(true);
  });
  it('preserves doubly nested for/while bodies', () => {
    const outer = firstNode(
      parseSync('for x in a; do while true; do echo inner; done; done'),
      'ForClause',
    );
    const inner = outer.Do?.[0]?.Cmd;
    expect(inner?.Type).toBe('WhileClause');
    if (inner?.Type !== 'WhileClause' || !inner.Do?.[0]) throw new Error('Missing inner body');
    expect(firstNode(inner.Do[0], 'CallExpr').Args?.[0]?.Parts?.[0]).toMatchObject({
      Type: 'Lit',
      Value: 'echo',
    });
  });
  it('preserves the minimal colon no-op body', () => {
    const clause = firstNode(parseSync('for x in a; do :; done'), 'ForClause');
    expect(clause.Do).toHaveLength(1);
    if (!clause.Do?.[0]) throw new Error('Missing no-op body');
    expect(firstNode(clause.Do[0], 'Lit').Value).toBe(':');
  });
  it('retains multibyte command and quoted argument byte spans', () => {
    const clause = firstNode(parseSync(unicode), 'ForClause');
    if (!clause.Do?.[0]) throw new Error('Missing multibyte body');
    const call = firstNode(clause.Do[0], 'CallExpr');
    expect(sourceText(unicode, call)).toBe('echo "café 🎉 你好 e\u0301"');
    const quoted = call.Args?.[1];
    if (!quoted) throw new Error('Missing quoted argument');
    expect(sourceText(unicode, quoted)).toBe('"café 🎉 你好 e\u0301"');
    const literals = nodes(clause.Do[0]).filter((node) => node.Type === 'Lit');
    expect(literals.length).toBeGreaterThan(1);
    for (const literal of literals) expect(sourceText(unicode, literal)).toBe(literal.Value);
  });
});
