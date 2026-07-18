/**
 * Regression coverage for
 * https://github.com/mike-north/sh-ast/issues/2 ("Normalizer drops
 * ForClause/WhileClause loop bodies", a port of eslint-sh#27).
 *
 * Root cause: `normalize.ts`'s hand-maintained `POS_KEYS` denylist listed the
 * bare field name `'Do'`, which is used by mvdan/sh v3.13.1's `ForClause`
 * and `WhileClause` structs for *two different fields*: `DoPos Pos` (a
 * position, correctly dropped) and `Do []*Stmt` (the loop body statement
 * list, a real child). Denylisting `'Do'` discarded the statement list
 * before schema-driven child resolution in `buildFields` ever ran on it, so
 * every `for`/`while`/`until` loop's body vanished from the normalized tree
 * with no trace (not even an empty `do` array).
 *
 * @see https://pkg.go.dev/mvdan.cc/sh/v3@v3.13.1/syntax#ForClause
 * @see https://pkg.go.dev/mvdan.cc/sh/v3@v3.13.1/syntax#WhileClause
 */
import { describe, expect, it } from 'vitest';
import { parseSync, walk } from '../src/index.js';
import type { ShNode } from '../src/index.js';

const sh = String.raw;

/** Depth-first search for the first node of the given `type` in `file`. */
function firstNodeOfType(file: ShNode, type: string): ShNode {
  let found: ShNode | undefined;
  walk(file, (node) => {
    if (!found && node.type === type) found = node;
  });
  if (!found) {
    throw new Error(`no node of type ${type} found`);
  }
  return found;
}

/**
 * Resolves a `CallExpr`'s command word the same way `parse.test.ts`'s
 * criterion-1 test does: `cmd.args[0].parts[0].value`.
 */
function commandNameOf(callExpr: ShNode): unknown {
  const args = callExpr.args as ShNode[];
  const firstArg = args[0];
  const parts = firstArg.parts as ShNode[];
  return parts[0]?.value;
}

describe('parseSync — issue #2: ForClause/WhileClause loop bodies', () => {
  it('populates a ForClause\'s "do" body with the loop\'s CallExpr', () => {
    const file = parseSync('for x in a b; do echo "$x"; done');
    const forClause = firstNodeOfType(file, 'ForClause');
    const body = forClause.do as ShNode[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    const bodyStmt = body[0];
    const callExpr = bodyStmt.cmd as ShNode;
    expect(callExpr.type).toBe('CallExpr');
    expect(commandNameOf(callExpr)).toBe('echo');
  });

  it('populates a WhileClause\'s "do" body with the loop\'s CallExpr', () => {
    const file = parseSync('while true; do echo hi; done');
    const whileClause = firstNodeOfType(file, 'WhileClause');
    const body = whileClause.do as ShNode[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    const callExpr = body[0].cmd as ShNode;
    expect(callExpr.type).toBe('CallExpr');
    expect(commandNameOf(callExpr)).toBe('echo');
  });

  it('populates an UntilClause\'s (mvdan/sh: WhileClause with Until=true) "do" body with the loop\'s CallExpr', () => {
    const file = parseSync('until false; do echo hi; done');
    // mvdan/sh v3.13.1 has no distinct `UntilClause` struct — `until` is a
    // `WhileClause` with `Until: true` (see the field audit in the PR
    // description); the normalized node type is still `WhileClause`.
    const whileClause = firstNodeOfType(file, 'WhileClause');
    const body = whileClause.do as ShNode[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    const callExpr = body[0].cmd as ShNode;
    expect(callExpr.type).toBe('CallExpr');
    expect(commandNameOf(callExpr)).toBe('echo');
  });

  it('reaches a doubly-nested loop body (for containing while)', () => {
    const file = parseSync('for x in a; do while true; do echo inner; done; done');
    const forClause = firstNodeOfType(file, 'ForClause');
    const outerBody = forClause.do as ShNode[];
    expect(outerBody.length).toBeGreaterThan(0);
    const innerWhile = outerBody[0].cmd as ShNode;
    expect(innerWhile.type).toBe('WhileClause');
    const innerBody = innerWhile.do as ShNode[];
    expect(innerBody.length).toBeGreaterThan(0);
    const innerCall = innerBody[0].cmd as ShNode;
    expect(innerCall.type).toBe('CallExpr');
    expect(commandNameOf(innerCall)).toBe('echo');
  });

  it('normalizes a minimal loop body (":" no-op command) without throwing', () => {
    // POSIX requires at least one statement between `do`/`done`; `:` is the
    // smallest realistic "empty" body.
    const file = parseSync('for x in a; do :; done');
    const forClause = firstNodeOfType(file, 'ForClause');
    const body = forClause.do as ShNode[];
    expect(body.length).toBe(1);
    const callExpr = body[0].cmd as ShNode;
    expect(callExpr.type).toBe('CallExpr');
    expect(commandNameOf(callExpr)).toBe(':');
  });
});

describe('parseSync — issue #2: multibyte loop body (criterion 4)', () => {
  // Loop body containing an emoji, CJK, and a combining-mark character (the
  // combining acute accent on "é" below, which in NFD form is "e" + U+0301
  // — String.raw doesn't normalize, so this stays whatever form the source
  // literal below actually is; the key requirement is multibyte content
  // whose UTF-16 length differs from its UTF-8 byte length).
  const code = sh`for x in 🎉 你好; do echo "café 🎉 你好"; done
`;

  it("slices the ForClause body's CallExpr command word exactly, across multibyte content", () => {
    const file = parseSync(code);
    const forClause = firstNodeOfType(file, 'ForClause');
    const body = forClause.do as ShNode[];
    expect(body.length).toBeGreaterThan(0);
    const callExpr = body[0].cmd as ShNode;
    expect(callExpr.type).toBe('CallExpr');
    expect(commandNameOf(callExpr)).toBe('echo');

    const [start, end] = callExpr.range;
    expect(code.slice(start, end)).toBe(sh`echo "café 🎉 你好"`);
  });

  it('reproduces the exact multibyte argument text (emoji + CJK) via range slicing', () => {
    const file = parseSync(code);
    const forClause = firstNodeOfType(file, 'ForClause');
    const body = forClause.do as ShNode[];
    const callExpr = body[0].cmd as ShNode;
    const args = callExpr.args as ShNode[];
    const dblQuotedArg = args[1];
    const [start, end] = dblQuotedArg.range;
    expect(code.slice(start, end)).toBe(sh`"café 🎉 你好"`);
  });

  it('walks every node inside the loop body and confirms slice-fidelity (range length matches slice length)', () => {
    const file = parseSync(code);
    const forClause = firstNodeOfType(file, 'ForClause');
    const body = forClause.do as ShNode[];
    let visitedInBody = 0;
    walk(body[0], (node) => {
      visitedInBody += 1;
      const [start, end] = node.range;
      const sliced = code.slice(start, end);
      expect(sliced.length).toBe(end - start);
      if (node.type === 'Lit') {
        expect(sliced).toBe(node.value);
      }
    });
    expect(visitedInBody).toBeGreaterThan(3);
  });
});
