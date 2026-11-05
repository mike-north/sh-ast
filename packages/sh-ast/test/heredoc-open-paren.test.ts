/**
 * A subshell shares pending here-documents with its surrounding statement list.
 * Command substitutions keep their own scope. Expectations come from the source
 * text and real-shell behavior, independently of the parser and its encoder.
 */
import { describe, expect, it } from 'vitest';
import { ParseError, parseSync } from '../src/index.js';
import type { File } from '../src/index.js';

/** Requires the document to belong to cat, leaving exactly one later statement. */
function expectCatDocument(file: File): void {
  expect(file.Stmts).toHaveLength(2);
  expect(file.Stmts?.[0]).toMatchObject({
    Cmd: {
      Type: 'CallExpr',
      Args: [{ Parts: [{ Type: 'Lit', Value: 'cat' }] }],
    },
    Redirs: [
      {
        Word: { Parts: [{ Type: 'Lit', Value: 'X' }] },
        Hdoc: { Parts: [{ Type: 'Lit', Value: 'body\n' }] },
      },
    ],
  });
}

/** The remaining command must survive document consumption with both arguments. */
const echoIn = {
  Type: 'CallExpr',
  Args: [{ Parts: [{ Type: 'Lit', Value: 'echo' }] }, { Parts: [{ Type: 'Lit', Value: 'in' }] }],
};

describe('pending here-documents across subshell openers', () => {
  it('reads the document after a line ending in ( and attaches it to cat', () => {
    const file = parseSync('cat <<X; (\nbody\nX\necho in\n)\n');
    expectCatDocument(file);
    expect(file.Stmts?.[1]).toMatchObject({
      Redirs: null,
      Cmd: { Type: 'Subshell', Stmts: [{ Redirs: null, Cmd: echoIn }] },
    });
  });

  it('reads the document after a line ending in ( : and retains the colon command', () => {
    const file = parseSync('cat <<X; ( :\nbody\nX\necho in\n)\n');
    expectCatDocument(file);
    expect(file.Stmts?.[1]).toMatchObject({
      Redirs: null,
      Cmd: {
        Type: 'Subshell',
        Stmts: [
          {
            Redirs: null,
            Cmd: { Type: 'CallExpr', Args: [{ Parts: [{ Type: 'Lit', Value: ':' }] }] },
          },
          { Redirs: null, Cmd: echoIn },
        ],
      },
    });
  });

  it('keeps the document attached to cat when the line ends in {', () => {
    const file = parseSync('cat <<X; {\nbody\nX\necho in\n}\n');
    expectCatDocument(file);
    expect(file.Stmts?.[1]?.Cmd).toMatchObject({
      Type: 'Block',
      Stmts: [{ Redirs: null, Cmd: echoIn }],
    });
  });

  it('keeps the document attached to cat when the line ends in then', () => {
    const file = parseSync('cat <<X; if true; then\nbody\nX\necho in\nfi\n');
    expectCatDocument(file);
    expect(file.Stmts?.[1]?.Cmd).toMatchObject({
      Type: 'IfClause',
      Cond: [{ Cmd: { Type: 'CallExpr', Args: [{ Parts: [{ Type: 'Lit', Value: 'true' }] }] } }],
      Then: [{ Redirs: null, Cmd: echoIn }],
    });
  });

  it('reads an outer document after the closing command-substitution parenthesis', () => {
    const file = parseSync('cat <<X; y=$(\necho in\n)\nbody\nX\n');
    expectCatDocument(file);
    expect(file.Stmts?.[1]).toMatchObject({
      Redirs: null,
      Cmd: {
        Type: 'CallExpr',
        Args: null,
        Assigns: [
          {
            Name: { Value: 'y' },
            Value: { Parts: [{ Type: 'CmdSubst', Stmts: [{ Cmd: echoIn }] }] },
          },
        ],
      },
    });
  });

  it('preserves the unclosed outer document error when those lines are inside $(', () => {
    const parse = (): File => parseSync('cat <<X; y=$(\nbody\nX\necho in\n)\n');
    expect(parse).toThrow(ParseError);
    expect(parse).toThrow('1:5: unclosed here-document `X`');
  });
});
