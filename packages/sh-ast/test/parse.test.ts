/**
 * Parser regressions preserve independently specified commands, comments, error
 * positions and escaping. The root contract retains upstream spelling and byte
 * coordinates; consumer source views are outside this interface.
 */
import { describe, expect, it } from 'vitest';
import {
  InputError,
  LangBash,
  LangBats,
  LangMirBSDKorn,
  LangPOSIX,
  LangZsh,
  ParseError,
  nodePos,
  parseSync,
} from '../src/index.js';
import { firstNode, nodes } from './regression-helpers.js';

/** Captures a required grammar error without weakening the error-kind assertion. */
function parseError(source: string, filename: string): ParseError {
  try {
    parseSync(source, { Filename: filename });
  } catch (error) {
    if (error instanceof ParseError) return error;
    throw error;
  }
  throw new Error('Expected a ParseError');
}

describe('parseSync — upstream tree shape', () => {
  it('preserves CallExpr and Lit echo through concrete and interface children', () => {
    const file = parseSync('echo hi');
    expect(file.Type).toBe('File');
    const cmd = firstNode(file, 'CallExpr');
    expect(cmd.Args?.[0]?.Parts?.[0]).toMatchObject({ Type: 'Lit', Value: 'echo' });
    expect(file).not.toHaveProperty('range');
    expect(file).not.toHaveProperty('loc');
    expect(file).not.toHaveProperty('stmts');
  });

  it.each([
    'if true; then\n  echo hi\n# trailing comment\nfi\n',
    'if false; then\n  echo a\n# trailing comment\nelif true; then\n  echo b\nfi\n',
  ])('preserves comments immediately before fi/elif: %s', (source) => {
    const file = parseSync(source, { KeepComments: true });
    expect(
      nodes(file)
        .filter((node) => node.Type === 'Comment')
        .map((node) => node.Text),
    ).toContain(' trailing comment');
  });
});

describe('parseSync — error positions and message escaping', () => {
  it('reports then at its actual byte position and carries the partial file', () => {
    const error = parseError('if true; then\n', 'b.sh');
    expect(error.Pos).toMatchObject({ Offset: 9, Line: 1, Col: 10, IsValid: true });
    expect(error.Filename).toBe('b.sh');
    expect(error.message).toContain('must be followed by a statement list');
    expect(error.File?.Type).toBe('File');
  });

  it('reports the actual later line, not a placeholder', () => {
    const error = parseError('echo one\necho two\nif true; then\n', 'c.sh');
    expect(error.Pos).toMatchObject({ Offset: 27, Line: 3, Col: 10 });
  });

  it('retains byte column 13 after emoji in both successful and failing parses', () => {
    const prefix = 'echo "🎉" ';
    const lit = nodes(parseSync(prefix + 'x\n')).find(
      (node) => node.Type === 'Lit' && node.Value === 'x',
    );
    if (!lit) throw new Error('Missing independently positioned x fixture');
    expect(nodePos(lit)).toMatchObject({ Offset: 12, Line: 1, Col: 13 });
    const error = parseError(prefix + '"unterminated', 'q2.sh');
    expect(error.Pos).toMatchObject({ Offset: 12, Line: 1, Col: 13 });
    expect(error.message).toBe('q2.sh:1:13: reached EOF without closing quote `"`');
  });

  it('preserves literal quote characters in the Go diagnostic', () => {
    const error = parseError('echo "unterminated', 'q.sh');
    expect(error.Message).toBe('q.sh:1:6: reached EOF without closing quote `"`');
    expect(error.Text).toBe('reached EOF without closing quote `"`');
    expect(error.message.includes(String.fromCharCode(0x22))).toBe(true);
  });
});

describe('parseSync — numeric upstream language variants', () => {
  it.each([LangBash, LangPOSIX, LangMirBSDKorn, LangBats, LangZsh])(
    'accepts variant %s',
    (Variant) => {
      expect(parseSync('echo hi', { Variant }).Type).toBe('File');
    },
  );
  it('rejects an unsupported variant as input rather than a source grammar error', () => {
    expect(() => parseSync('echo hi', { Variant: -1 })).toThrow(InputError);
    expect(() => parseSync('echo hi', { Variant: -1 })).not.toThrow(ParseError);
  });
  it('accepts declare -A m under POSIX as ordinary command words', () => {
    expect(parseSync('declare -A m', { Variant: LangPOSIX }).Stmts).toHaveLength(1);
  });
});
