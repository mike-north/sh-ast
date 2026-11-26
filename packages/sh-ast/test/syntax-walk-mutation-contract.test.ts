/**
 * Hand-specified ordinary-array outcomes define the supported mutation boundary.
 * These cases intentionally do not claim Go capacity or value-slot address parity.
 */
/// <reference lib="es2024.arraybuffer" />
import { describe, expect, it } from 'vitest';
import type { Comment, GoString, Node, SyntaxPos, Word } from '../generated/syntax-types.js';
import { printSync } from '../src/syntax-print.js';
import { walk, WalkPanicError } from '../src/syntax-walk.js';
import { parseSync } from '../src/syntax.js';
import { syntheticNode } from './syntax-fixtures.js';

/** Small valid coordinates make comment placement independent of parser output. */
function position(offset: number): SyntaxPos {
  return {
    Offset: offset,
    Line: 1,
    Col: offset + 1,
    IsValid: true,
    IsRecovered: false,
    OffsetOverflow: false,
  };
}

/** Complete literal words carry independently specified text and byte bounds. */
function word(value: string, offset = 0): Word {
  return syntheticNode('Word', {
    Parts: [
      syntheticNode('Lit', {
        Value: value,
        ValuePos: position(offset),
        ValueEnd: position(offset + new TextEncoder().encode(value).length),
      }),
    ],
  });
}

/** Comment records distinguish the stored object from copies passed to callbacks. */
function comment(text: GoString, offset = 0): Comment {
  return { Type: 'Comment', Hash: position(offset), Text: text };
}

describe('ordinary-array traversal mutation contract', () => {
  it('observes replacement of a future slot, ignores appended entries, and prints the current tree', () => {
    const args = [word('echo'), word('old', 5)];
    const call = syntheticNode('CallExpr', { Args: args });
    const visited: GoString[] = [];
    walk(call, (node) => {
      if (node?.Type === 'Lit') {
        visited.push(node.Value);
        if (node.Value === 'echo') {
          args.push(word('appended', 15));
          args[1] = word('new🎉', 5);
        }
      }
      return true;
    });
    expect(visited).toEqual(['echo', 'new🎉']);
    expect(printSync(call)).toBe('echo new🎉 appended');
  });

  it('visits an appended object moved into a captured slot even after the added slot is removed', () => {
    const args = [word('echo'), word('old', 5)];
    const appended = word('new🎉', 5);
    const call = syntheticNode('CallExpr', { Args: args });
    const visited: GoString[] = [];
    walk(call, (node) => {
      if (node?.Type === 'Lit') {
        visited.push(node.Value);
        if (node.Value === 'echo') {
          args.push(appended);
          args[1] = appended;
          args.pop();
        }
      }
      return true;
    });
    expect(visited).toEqual(['echo', 'new🎉']);
    expect(call.Args).toBe(args);
    expect(args).toHaveLength(2);
    expect(printSync(call)).toBe('echo new🎉');
  });

  it('keeps the active list when its owner field is replaced, but prints the replacement field', () => {
    const active = [word('echo'), word('old', 5)];
    const call = syntheticNode('CallExpr', { Args: active });
    const visited: GoString[] = [];
    walk(call, (node) => {
      if (node?.Type === 'Lit') {
        visited.push(node.Value);
        if (node.Value === 'echo') {
          call.Args = [word('replacement')];
          active[1] = word('live', 5);
        }
      }
      return true;
    });
    expect(visited).toEqual(['echo', 'live']);
    expect(printSync(call)).toBe('replacement');
  });

  it('reads reordered existing slots live, even when that visits an object again', () => {
    const args = [word('a'), word('b', 2), word('c', 4)];
    const call = syntheticNode('CallExpr', { Args: args });
    const visited: GoString[] = [];
    let reordered = false;
    walk(call, (node) => {
      if (node?.Type === 'Lit') {
        visited.push(node.Value);
        if (!reordered) {
          args.reverse();
          reordered = true;
        }
      }
      return true;
    });
    expect(visited).toEqual(['a', 'b', 'a']);
    expect(printSync(call)).toBe('c b a');
  });

  it('captures a list only when traversal reaches it, after earlier callbacks can replace it', () => {
    const assignment = syntheticNode('Assign', { Name: syntheticNode('Lit', { Value: 'A' }) });
    const call = syntheticNode('CallExpr', {
      Assigns: [assignment],
      Args: [word('old')],
    });
    const visited: GoString[] = [];
    walk(call, (node) => {
      if (node === assignment) {
        call.Args = [word('new')];
      }
      if (node?.Type === 'Lit') {
        visited.push(node.Value);
      }
      return true;
    });
    expect(visited).toEqual(['A', 'new']);
  });

  it('uses JavaScript Comment object identity when a stored value slot is replaced', () => {
    const original = comment('original');
    const replacement = comment('replacement');
    const later = comment('later', 12);
    const file = syntheticNode('File', { Last: [original, comment('old later', 12)] });
    const visited: Comment[] = [];
    walk(file, (node) => {
      if (node?.Type === 'Comment') {
        visited.push(node);
        if (node === original && file.Last !== null) {
          file.Last[0] = replacement;
          file.Last[1] = later;
          expect(node.Text).toBe('original');
          expect(node).not.toBe(file.Last[0]);
          node.Text = 'retained object edit';
        }
      }
      return true;
    });
    expect(visited).toEqual([original, later]);
    expect(file.Last).toEqual([replacement, later]);
    expect(original.Text).toBe('retained object edit');
    expect(replacement.Text).toBe('replacement');
  });

  it.each([
    { kind: 'Buffer', text: Buffer.from([0x78]) },
    { kind: 'Uint8Array', text: new Uint8Array([0x78]) },
  ])('keeps edits to $kind-backed comment copies out of the stored AST', ({ text }) => {
    expect.assertions(3);
    const file = parseSync('echo hi #x\n', { KeepComments: true });
    const attached = file.Stmts?.[0]?.Comments?.[0];
    if (!attached) throw new Error('Missing attached comment');
    attached.Text = text;

    walk(file, (node) => {
      if (node?.Type === 'Comment' && typeof node.Text !== 'string') {
        expect(node.Text[0]).toBe(0x78);
        node.Text[0] = 0x79;
      }
      return true;
    });

    expect(printSync(file)).toBe('echo hi #x\n');
    expect(text[0]).toBe(0x78);
  });

  it('visits a comment with empty text when its Buffer view goes out of bounds after a shrink', () => {
    const file = parseSync('echo hi #x\n', { KeepComments: true });
    const attached = file.Stmts?.[0]?.Comments?.[0];
    if (!attached) throw new Error('Missing attached comment');
    const backing = new ArrayBuffer(1, { maxByteLength: 2 });
    const text = Buffer.from(backing, 0, 1);
    text[0] = 0x78;
    attached.Text = text;
    backing.resize(0);

    const seen: GoString[] = [];
    walk(file, (node) => {
      if (node?.Type === 'Comment') seen.push(node.Text);
      return true;
    });

    expect(seen).toStrictEqual([new Uint8Array(0)]);
    expect(printSync(file)).toBe('echo hi #\n');
    backing.resize(1);
    expect(text.length).toBe(1);
    expect(seen).toStrictEqual([new Uint8Array(0)]);
  });

  it.each(
    (['Stmt', 'CaseItem', 'ArrayElem'] as const).flatMap((kind) =>
      (['Uint8Array', 'Buffer'] as const).map((storage) => ({ kind, storage })),
    ),
  )(
    'isolates immediate $kind comment copies backed by $storage while reading later slots live',
    ({ kind, storage }) => {
      const expectedText = new Uint8Array([0xe7, 0x95, 0x8c]);
      const text =
        storage === 'Buffer'
          ? Buffer.from([0, 0xe7, 0x95, 0x8c, 0]).subarray(1, 4)
          : new Uint8Array(expectedText);
      const original = comment(text);
      const later = comment('old later', 2);
      const replacement = comment('new later', 2);
      const comments = [original, later];
      const item: Node =
        kind === 'Stmt'
          ? syntheticNode('Stmt', {
              Position: position(10),
              Cmd: syntheticNode('CallExpr', { Args: [word('echo', 10)] }),
              Comments: comments,
            })
          : kind === 'CaseItem'
            ? syntheticNode('CaseItem', { Patterns: [word('case', 10)], Comments: comments })
            : syntheticNode('ArrayElem', { Value: word('value', 10), Comments: comments });
      const seen: GoString[] = [];
      walk(item, (node) => {
        if (node?.Type === 'Comment') {
          seen.push(typeof node.Text === 'string' ? node.Text : new Uint8Array(node.Text));
          expect(comments).not.toContain(node);
          if (typeof node.Text !== 'string') {
            node.Text[0] = 0xff;
            node.Hash.Offset = 99;
            comments[1] = replacement;
          }
        }
        return true;
      });
      expect(seen).toEqual([expectedText, 'new later']);
      expect([...text]).toEqual([...expectedText]);
      expect(original.Hash.Offset).toBe(0);
      expect(replacement.Text).toBe('new later');
    },
  );
});

describe('Walk panic message preservation', () => {
  it.each(['upstream panic 🎉', new Uint8Array([0xfe])] satisfies GoString[])(
    'retains the exact message independently of display rendering: %s',
    (message) => {
      const error = new WalkPanicError(message);
      expect(error.Message).toBe(message);
      expect(error.message).toBe(
        typeof message === 'string' ? message : new TextDecoder().decode(message),
      );
      expect(error.code).toBe('SH_AST_WALK_PANIC');
      expect(error.name).toBe('WalkPanicError');
    },
  );
});
