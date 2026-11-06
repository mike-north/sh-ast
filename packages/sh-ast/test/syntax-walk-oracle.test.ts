/** Independent native Go observations specify live callbacks, copying, nils and unwind. */
import { describe, expect, it } from 'vitest';
import type { Comment, GoString, Node, SyntaxPos, Word } from '../generated/syntax-types.js';
import { parseSync } from '../src/index.js';
import { walk, WalkPanicError } from '../src/syntax-walk.js';
import { syntheticNode } from './syntax-fixtures.js';
import oracle from './fixtures/walk-oracle.json' with { type: 'json' };

/** Fixtures use independently chosen byte coordinates, including an ordinary invalid position. */
function pos(offset: number, line = 1, col = offset + 1): SyntaxPos {
  return {
    Offset: offset,
    Line: line,
    Col: col,
    IsValid: line !== 0 || col !== 0,
    IsRecovered: false,
    OffsetOverflow: false,
  };
}
/** Literal words deliberately avoid the parser so callbacks control every identity. */
function word(value: string, offset: number): Word {
  return syntheticNode('Word', {
    Parts: [
      syntheticNode('Lit', {
        Value: value,
        ValuePos: pos(offset),
        ValueEnd: pos(offset + value.length),
      }),
    ],
  });
}
/** Complete minimal command statements make comment-boundary expectations explicit. */
function statement(value: string, offset: number) {
  return syntheticNode('Stmt', {
    Position: pos(offset),
    Cmd: syntheticNode('CallExpr', { Args: [word(value, offset)] }),
  });
}
/** A positioned comment value; tree comments are distinct from upstream range copies. */
function comment(value: string, offset: number): Comment {
  return { Type: 'Comment', Text: value, Hash: pos(offset) };
}
/** The fixture's setup describes a real Go construction, independently mirrored here. */
function construct(entry: (typeof oracle.cases)[number]): Node {
  switch (entry.setup) {
    case 'source':
      return parseSync(entry.source ?? '', { KeepComments: true, Variant: entry.variant ?? 0 });
    case 'call':
      return syntheticNode('CallExpr', { Args: [word('a', 1), word('b', 3)] });
    case 'assign-before-args':
      return syntheticNode('CallExpr', {
        Assigns: [
          syntheticNode('Assign', {
            Name: syntheticNode('Lit', { Value: 'A' }),
            Value: word('seed', 2),
          }),
        ],
        Args: [word('old', 10)],
      });
    case 'stmt-comments':
    case 'stmt-overflow':
    case 'file-comments': {
      const node = statement('cmd', 10);
      node.Comments = [comment('leading', 0), comment('trailing', 20), comment('ignored', 30)];
      if (entry.setup === 'stmt-overflow') {
        node.Semicolon = pos(2 ** 32 - 12, 1, 2 ** 14 - 1);
        node.Coprocess = true;
      }
      return entry.setup === 'file-comments'
        ? syntheticNode('File', { Stmts: [node], Last: [comment('last', 40)] })
        : node;
    }
    case 'case-comments':
    case 'case-recovered': {
      const pattern = word('pattern', 10);
      if (entry.setup === 'case-recovered' && pattern.Parts?.[0]?.Type === 'Lit') {
        pattern.Parts[0].ValuePos = {
          Offset: 0,
          Line: 0,
          Col: 0,
          IsValid: false,
          IsRecovered: true,
          OffsetOverflow: true,
        };
      }
      return syntheticNode('CaseItem', {
        Patterns: [pattern],
        Stmts: [statement('cmd', 20)],
        Comments: [comment('leading', 0), comment('trailing', 30), comment('ignored', 40)],
        Last: [comment('last', 50)],
      });
    }
    case 'array-comments':
    case 'array-invalid': {
      const index = word('index', 10);
      if (entry.setup === 'array-invalid' && index.Parts?.[0]?.Type === 'Lit') {
        index.Parts[0].ValuePos = pos(25, 0, 0);
      }
      return syntheticNode('ArrayElem', {
        Index: index,
        Value: word('value', 20),
        Comments: [
          comment('leading', entry.setup === 'array-invalid' ? 20 : 0),
          comment('trailing', 30),
          comment('ignored', 40),
        ],
      });
    }
    case 'param-aux':
      return syntheticNode('ParamExp', {
        Param: syntheticNode('Lit', { Value: 'p' }),
        Slice: { Offset: word('first', 1), Length: word('old-length', 2) },
        Repl: { All: false, Orig: word('orig', 3), With: word('old-with', 4) },
        Exp: { Op: 0, Word: word('fallback', 5) },
      });
    case 'nil-parts':
      return syntheticNode('Word', { Parts: [null, syntheticNode('Lit', { Value: 'after' })] });
    case 'nil-args':
      return syntheticNode('CallExpr', { Args: [null, word('after', 2)] });
    case 'nil-required':
      return syntheticNode('BinaryCmd', { Y: statement('after', 2) });
    case 'empty-pattern-boundary':
      return syntheticNode('CaseItem', { Comments: [comment('leading', 0)] });
    case 'nil-pattern-boundary':
      return syntheticNode('CaseItem', { Patterns: [null], Comments: [comment('leading', 0)] });
    case 'empty-word-boundary':
      return syntheticNode('Stmt', {
        Comments: [comment('leading', 0)],
        Cmd: syntheticNode('CallExpr', { Args: [syntheticNode('Word')] }),
      });
    case 'nil-command-boundary':
      return syntheticNode('Stmt', {
        Comments: [comment('leading', 0)],
        Cmd: { Type: 'TypedNil', Kind: 'CallExpr' },
      });
    case 'optional-nil':
      return syntheticNode('Assign');
    case 'typed-nil-Lit':
      return { Type: 'TypedNil', Kind: 'Lit' };
    case 'typed-nil-Comment':
      return { Type: 'TypedNil', Kind: 'Comment' };
    case 'typed-nil-SglQuoted':
      return { Type: 'TypedNil', Kind: 'SglQuoted' };
    case 'typed-nil-Word':
      return { Type: 'TypedNil', Kind: 'Word' };
    case 'typed-nil-BraceExp':
      return { Type: 'TypedNil', Kind: 'BraceExp' };
    case 'brace':
      return syntheticNode('BraceExp', { Elems: [word('a', 1), word('b', 3)] });
    case 'cycle': {
      const node = syntheticNode('Block');
      node.Stmts = [syntheticNode('Stmt', { Cmd: node })];
      return node;
    }
    default:
      throw new Error(`Unknown native setup: ${entry.setup}`);
  }
}
/** Identity discovery observes storage only; it never computes a traversal expectation. */
function comments(root: Node): Map<Comment, string> {
  const found = new Map<Comment, string>();
  const seen = new Set<object>();
  function visit(value: unknown, path: string): void {
    if (typeof value !== 'object' || value === null || seen.has(value)) {
      return;
    }
    seen.add(value);
    if ('Type' in value && value.Type === 'Comment') {
      found.set(value as Comment, path);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        visit(child, `${path}[${String(index)}]`);
      });
    } else {
      Object.entries(value).forEach(([key, child]) => {
        visit(child, `${path}.${key}`);
      });
    }
  }
  visit(root, '$');
  return found;
}
/** UTF-8 observations in these fixtures use strings; a separate test covers byte values. */
function text(value: GoString): string {
  return typeof value === 'string' ? value : new TextDecoder().decode(value);
}

const callbackFailures = {
  'callback-child': new Error('callback-child'),
  'callback-exit': new Error('callback-exit'),
  'callback-deferred': new Error('callback-deferred'),
};

describe('native syntax.Walk oracle', () => {
  it.each(oracle.cases)('$id', (entry) => {
    const root = construct(entry);
    const origins = comments(root);
    const events: { type: string; kind?: string; value?: string; origin?: string }[] = [];
    const stack: string[] = [];
    let reentered = false;
    const callback = (node: Node | null): boolean => {
      const event: (typeof events)[number] = { type: node?.Type ?? 'nil' };
      if (node?.Type === 'TypedNil') {
        event.kind = node.Kind;
      }
      if (node?.Type === 'Lit' && text(node.Value)) {
        event.value = text(node.Value);
      }
      if (node?.Type === 'Comment') {
        if (text(node.Text)) {
          event.value = text(node.Text);
        }
        event.origin = origins.get(node) ?? 'copy';
      }
      events.push(event);
      if (entry.mode === 'prune-root' && events.length === 1) {
        return false;
      }
      if (entry.mode === 'prune-nested' && node?.Type === 'CmdSubst') {
        return false;
      }
      if (entry.mode === 'prune-typed-nil' && node?.Type === 'TypedNil') {
        return false;
      }
      if (node === null) {
        const exited = stack.pop();
        if (entry.mode === 'panic-exit' && exited === 'Stmt') {
          throw callbackFailures['callback-exit'];
        }
        return entry.mode !== 'exit-false' && entry.mode !== 'nil-false';
      }
      stack.push(node.Type);
      if (
        entry.mode === 'force-boundaries' &&
        (node.Type === 'Stmt' || node.Type === 'CaseItem' || node.Type === 'ArrayElem')
      ) {
        node.Comments = [comment('boundary-probe', 0)];
      }
      if (entry.mode === 'replace-before-range' && node === root && root.Type === 'CallExpr') {
        root.Args = [word('fresh', 1)];
      }
      if (node.Type === 'Lit') {
        if (node.Value === 'a' && root.Type === 'CallExpr' && root.Args !== null) {
          if (entry.mode === 'slot-replace') {
            root.Args[1] = word('replacement', 3);
          }
          if (entry.mode === 'field-replace') {
            root.Args = [word('fresh', 1)];
          }
          if (entry.mode === 'append-and-replace') {
            root.Args.push(word('appended', 5));
            root.Args[1] = word('replacement', 3);
          }
          if (entry.mode === 'reenter' && !reentered) {
            reentered = true;
            walk(word('inner', 1), callback);
          }
        }
        if (node.Value === 'A' && entry.mode === 'assign-args' && root.Type === 'CallExpr') {
          root.Args = [word('fresh', 10)];
        }
        if (node.Value === 'first' && root.Type === 'ParamExp') {
          if (entry.mode === 'aux-replace') {
            root.Slice = { Offset: null, Length: word('new-length', 6) };
          }
          if (entry.mode === 'aux-nil') {
            root.Slice = null;
          }
        }
        if (node.Value === 'orig' && entry.mode === 'aux-replace' && root.Type === 'ParamExp') {
          root.Repl = { All: false, Orig: null, With: word('new-with', 7) };
        }
        if (node.Value === 'orig' && entry.mode === 'repl-nil' && root.Type === 'ParamExp') {
          root.Repl = null;
        }
        if (
          node.Value === 'cmd' &&
          (entry.mode === 'panic-child' || entry.mode === 'panic-child-and-deferred')
        ) {
          throw callbackFailures['callback-child'];
        }
      }
      if (node.Type === 'Comment') {
        if (entry.mode === 'comments-mutate') {
          node.Text = `${text(node.Text)}!`;
          node.Hash.Offset = 99;
          node.Hash.Col = 100;
        }
        if (node.Text === 'trailing' && entry.mode === 'panic-child-and-deferred') {
          throw callbackFailures['callback-deferred'];
        }
        if (node.Text === 'leading' && entry.mode === 'move-boundary') {
          if (root.Type === 'Stmt') {
            root.Semicolon = pos(200);
          }
          const boundary =
            root.Type === 'CaseItem'
              ? root.Patterns?.[0]
              : root.Type === 'ArrayElem' && root.Index?.Type === 'Word'
                ? root.Index
                : null;
          if (boundary?.Parts?.[0]?.Type === 'Lit') {
            boundary.Parts[0].ValuePos = pos(200);
          }
        }
      }
      return true;
    };
    let failure: unknown;
    try {
      walk(root, callback);
    } catch (error) {
      failure = error;
    }
    expect(events).toEqual(entry.events);
    if (entry.panic && entry.panic in callbackFailures) {
      expect(failure).toBe(callbackFailures[entry.panic as keyof typeof callbackFailures]);
    } else if (entry.panic) {
      expect(failure).toBeInstanceOf(WalkPanicError);
      expect((failure as WalkPanicError).Message).toBe(entry.panic);
    } else {
      expect(failure).toBeUndefined();
    }
    const finalComments = [...comments(root)]
      .map(([node, path]) => ({ path, text: text(node.Text), offset: node.Hash.Offset }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    expect(finalComments).toEqual(entry.comments ?? []);
  });

  it('copies a value comment position and byte string without sharing mutable backing state', () => {
    const original: Comment = { Type: 'Comment', Hash: pos(0), Text: new Uint8Array([255]) };
    const node = statement('cmd', 10);
    node.Comments = [original];
    walk(node, (child) => {
      if (child?.Type === 'Comment') {
        child.Hash.Offset = 9;
        if (child.Text instanceof Uint8Array) {
          child.Text[0] = 1;
        }
      }
      return true;
    });
    expect(original.Hash.Offset).toBe(0);
    expect(original.Text).toEqual(new Uint8Array([255]));
  });
});
