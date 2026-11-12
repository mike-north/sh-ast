/**
 * A hole in an interface-typed list is outside the mutation contract, but Walk's
 * reaction to it is still the recursive original's: the callback sees null, then
 * the walk panics for the nil node.
 */
import { describe, expect, it } from 'vitest';
import type { Node } from '../generated/syntax-types.js';
import { parseSync } from '../src/index.js';
import { walk } from '../src/syntax-walk.js';
import { walk as referenceWalk } from './reference/recursive-syntax-walk.js';

type Walker = (node: Node, callback: (node: Node | null) => boolean) => void;

/** Entry types seen before the walk ends, and the error that ended it. */
function run(walker: Walker, tree: Node): { events: (string | null)[]; error: unknown } {
  const events: (string | null)[] = [];
  let error: unknown = null;
  try {
    walker(tree, (node) => {
      events.push(node === null ? null : node.Type);
      return true;
    });
  } catch (cause) {
    error = cause;
  }
  return { events, error };
}

/** The Word of `echo hi` with a hole where its first part was. */
function holeInParts(): Node {
  const file = parseSync('echo hi');
  const stmt = file.Stmts?.[0];
  if (stmt?.Cmd?.Type !== 'CallExpr') throw new Error('unexpected fixture shape');
  const word = stmt.Cmd.Args?.[0];
  if (word?.Parts === null || word?.Parts === undefined)
    throw new Error('unexpected fixture shape');
  delete (word.Parts as unknown as Record<number, unknown>)[0];
  return file;
}

describe('a hole in Word.Parts (hole parity with the recursive original)', () => {
  it('reaches the callback as null and then panics as the original does', () => {
    const expected = run(referenceWalk, holeInParts());
    const actual = run(walk, holeInParts());
    expect(expected.events.at(-1)).toBeNull();
    expect(actual.events).toStrictEqual(expected.events);
    expect(actual.error).toBeInstanceOf(Error);
    expect((actual.error as Error).name).toBe((expected.error as Error).name);
    expect((actual.error as Error).message).toBe('syntax.Walk: unexpected node type <nil>');
    expect((actual.error as Error).message).toBe((expected.error as Error).message);
  });
});
