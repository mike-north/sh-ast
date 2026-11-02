/**
 * Walk expectations come from hand-derived protocol examples and the independent
 * native syntax.Walk oracle, never generated field metadata or a TS traversal.
 */
import { describe, expect, it } from 'vitest';
import { parseSync } from '../src/index.js';
import { walk, WalkPanicError } from '../src/syntax-walk.js';
import oracle from './fixtures/walk-oracle.json' with { type: 'json' };

describe('faithful walk callback protocol', () => {
  it('enters nodes in upstream order and emits a nil exit for each unpruned entry', () => {
    const events: string[] = [];
    walk(parseSync('echo x'), (node) => {
      events.push(node?.Type ?? 'nil');
      return true;
    });
    expect(events).toEqual([
      'File',
      'Stmt',
      'CallExpr',
      'Word',
      'Lit',
      'nil',
      'nil',
      'Word',
      'Lit',
      'nil',
      'nil',
      'nil',
      'nil',
      'nil',
    ]);
  });

  it('prunes before dereferencing an unsupported node', () => {
    const events: string[] = [];
    walk({ Type: 'BraceExp', Sequence: false, Elems: null }, (node) => {
      events.push(node?.Type ?? 'nil');
      return false;
    });
    expect(events).toEqual(['BraceExp']);
  });

  it('distinguishes supported typed-nil leaves from dereferenced typed-nil records', () => {
    const events: string[] = [];
    walk({ Type: 'TypedNil', Kind: 'Lit' }, (node) => {
      events.push(node?.Type ?? 'nil');
      return true;
    });
    expect(events).toEqual(['TypedNil', 'nil']);
    expect(() => {
      walk({ Type: 'TypedNil', Kind: 'Word' }, () => true);
    }).toThrow(WalkPanicError);
  });

  it.each(oracle.cases.filter((entry) => entry.setup === 'source' && !entry.mode))(
    'matches independent upstream entry/exit order for $id',
    (entry) => {
      const events: string[] = [];
      walk(
        parseSync(entry.source ?? '', { KeepComments: true, Variant: entry.variant ?? 0 }),
        (node) => {
          events.push(node?.Type ?? 'nil');
          return true;
        },
      );
      expect(events).toEqual(entry.events.map((event) => event.type));
    },
  );
});
