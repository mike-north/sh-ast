/** Live comment placement must follow v3.14.1's node End and Pos arithmetic. */
import { expect, it } from 'vitest';
import { newPos } from '../src/index.js';
import { atStatementEnd } from '../src/syntax-walk-bounds.js';
import { syntheticNode } from './syntax-fixtures.js';

it('places comments after naked indexed assignments and braced clauses at their actual end', () => {
  const index = syntheticNode('Word', {
    Parts: [
      syntheticNode('Lit', {
        ValuePos: newPos(10, 1, 11),
        ValueEnd: newPos(12, 1, 13),
        Value: 'ix',
      }),
    ],
  });
  const cases = [
    {
      command: syntheticNode('CallExpr', {
        Assigns: [syntheticNode('Assign', { Naked: true, Index: index })],
      }),
      offset: 13,
    },
    {
      command: syntheticNode('ForClause', { Braces: true, DonePos: newPos(10, 1, 11) }),
      offset: 11,
    },
    { command: syntheticNode('CaseClause', { Braces: true, Esac: newPos(10, 1, 11) }), offset: 11 },
  ];
  for (const { command, offset } of cases) {
    const statement = syntheticNode('Stmt', { Cmd: command });
    expect(atStatementEnd(statement, newPos(offset, 1, offset + 1))).toBe(true);
    expect(atStatementEnd(statement, newPos(offset - 1, 1, offset))).toBe(false);
  }
});

it('keeps clamped ends valid when a coprocess terminator reaches the maximum offset', () => {
  const maximum = 0xffff_fff4;
  const statement = syntheticNode('Stmt', {
    Semicolon: newPos(maximum - 1, 1, 16383),
    Coprocess: true,
  });
  expect(atStatementEnd(statement, newPos(maximum - 1, 1, 1))).toBe(false);
  expect(atStatementEnd(statement, newPos(maximum, 1, 1))).toBe(true);
});

it('visits comments immediately before fi after the then-list comments', async () => {
  const { walk } = await import('../src/index.js');
  const comment = { Type: 'Comment' as const, Text: 'before fi', Hash: newPos(10, 2, 1) };
  const node = syntheticNode('IfClause', { Last: [comment] });
  const events: string[] = [];
  walk(node, (value) => {
    events.push(value?.Type === 'Comment' ? String(value.Text) : (value?.Type ?? 'nil'));
    return true;
  });
  expect(events).toEqual(['IfClause', 'before fi', 'nil', 'nil']);
});
