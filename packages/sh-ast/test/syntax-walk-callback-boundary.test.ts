/**
 * JavaScript callers must supply the same boolean callback-result domain as Go.
 * Truthiness cannot stand in for synchronous pruning, including on exit events
 * whose valid boolean values are ignored. Caller exceptions keep their identity.
 */
import { describe, expect, it } from 'vitest';
import type { Node } from '../generated/syntax-types.js';
import { InputError } from '../src/syntax-errors.js';
import { parseSync } from '../src/syntax.js';
import { walk } from '../src/syntax-walk.js';

/** Every value is outside Go's callback return domain, regardless of JS truthiness. */
const invalidResults: readonly { readonly label: string; readonly value: unknown }[] = [
  { label: 'undefined', value: undefined },
  { label: 'null', value: null },
  { label: 'zero', value: 0 },
  { label: 'one', value: 1 },
  { label: 'empty text', value: '' },
  { label: 'nonempty text', value: 'true' },
  { label: 'object', value: {} },
  { label: 'Promise', value: Promise.resolve(true) },
];

describe('Walk callback result boundary', () => {
  it.each(invalidResults)('rejects $label on entry before visiting children', ({ value }) => {
    const file = parseSync('echo child');
    const events: (Node['Type'] | null)[] = [];
    const callback = (node: Node | null): unknown => {
      events.push(node?.Type ?? null);
      return value;
    };
    // Runtime JavaScript is not constrained by the public callback declaration.
    expect(() => {
      Reflect.apply(walk, undefined, [file, callback]);
    }).toThrow(InputError);
    expect(events).toEqual(['File']);
  });

  it.each(invalidResults)(
    'rejects $label on exit instead of ignoring its invalid domain',
    ({ value }) => {
      const events: (Node['Type'] | null)[] = [];
      const node: Node = { Type: 'TypedNil', Kind: 'Lit' };
      const callback = (current: Node | null): unknown => {
        events.push(current?.Type ?? null);
        return current === null ? value : true;
      };
      expect(() => {
        Reflect.apply(walk, undefined, [node, callback]);
      }).toThrow(InputError);
      expect(events).toEqual(['TypedNil', null]);
    },
  );

  it('rejects an invalid ordinary exit before continuing to later siblings', () => {
    const file = parseSync('echo later');
    const events: (Node['Type'] | null)[] = [];
    const callback = (node: Node | null): unknown => {
      events.push(node?.Type ?? null);
      return node === null ? undefined : true;
    };
    expect(() => {
      Reflect.apply(walk, undefined, [file, callback]);
    }).toThrow(InputError);
    expect(events).toEqual(['File', 'Stmt', 'CallExpr', 'Word', 'Lit', null]);
  });

  it('ignores valid false exit results while continuing the full traversal', () => {
    const file = parseSync('echo later');
    const actual: (Node['Type'] | null)[] = [];
    walk(file, (node) => {
      actual.push(node?.Type ?? null);
      return node !== null;
    });
    expect(actual).toEqual([
      'File',
      'Stmt',
      'CallExpr',
      'Word',
      'Lit',
      null,
      null,
      'Word',
      'Lit',
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('preserves callback exceptions and deferred comment visits while unwinding', () => {
    const file = parseSync('echo value # trailing\n', { KeepComments: true });
    const failure = new Error('caller exception identity');
    const comments: string[] = [];
    const callback = (node: Node | null): boolean => {
      if (node?.Type === 'Lit') throw failure;
      if (node?.Type === 'Comment' && typeof node.Text === 'string') comments.push(node.Text);
      return true;
    };
    expect(() => {
      walk(file, callback);
    }).toThrow(failure);
    try {
      walk(file, callback);
      throw new Error('Expected callback failure');
    } catch (caught) {
      expect(caught).toBe(failure);
    }
    expect(comments).toEqual([' trailing', ' trailing']);
  });
});
