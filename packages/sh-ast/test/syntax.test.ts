/**
 * Behavioral contracts for the faithful binding, derived from upstream parser
 * and position semantics rather than from the serialization implementation.
 */
import { describe, expect, it } from 'vitest';
import {
  InputError,
  LangError,
  ParseError,
  newPos,
  nodeEnd,
  nodePos,
  parseSync,
  rawOperator,
} from '../src/syntax.js';

/** Extracts a call's arguments while preserving discriminant-based type narrowing. */
function argsOf(source: string) {
  const command = parseSync(source).Stmts?.[0]?.Cmd;
  if (command?.Type !== 'CallExpr' || command.Args === null) throw new Error('Expected a call');
  return command.Args;
}

describe('upstream inputs and structured results', () => {
  it('retains comments only when requested, including comment-only source', () => {
    const file = parseSync('# only\n', { KeepComments: true });
    expect(file.Stmts).toBeNull();
    expect(file.Last).toMatchObject([{ Type: 'Comment', Text: ' only' }]);
    expect(nodePos(file)).toMatchObject({
      Offset: 0,
      Line: 1,
      Col: 1,
      IsValid: true,
      IsRecovered: false,
    });
  });

  it('retains token positions and raw byte positions without a UTF-16 replacement', () => {
    const args = argsOf('echo "🎉" 你好\n');
    const word = args.at(2);
    if (word === null || word === undefined) throw new Error('Expected CJK argument');
    expect(nodePos(word)).toEqual({
      Offset: 12,
      Line: 1,
      Col: 13,
      IsValid: true,
      IsRecovered: false,
    });
    expect(nodeEnd(word)).toEqual({
      Offset: 18,
      Line: 1,
      Col: 19,
      IsValid: true,
      IsRecovered: false,
    });
    const stmt = parseSync('echo hi;').Stmts?.[0];
    expect(stmt?.Semicolon).toMatchObject({ Offset: 7, IsValid: true });
  });

  it('preserves invalid UTF-8 as an upstream error rather than replacing source bytes', () => {
    try {
      parseSync(new Uint8Array([0x65, 0x63, 0x68, 0x6f, 0x20, 0xff]));
      throw new Error('Expected upstream rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      if (!(error instanceof ParseError)) throw error;
      expect(error.Text).toBe('invalid UTF-8 encoding');
      expect(error.File?.Type).toBe('File');
    }
  });

  it('preserves partial files, error distinctions, and arbitrary filename bytes', () => {
    const filename = new Uint8Array([0xff, 0x2e, 0x73, 0x68]);
    try {
      parseSync('echo ok; (', { Filename: filename });
      throw new Error('Expected syntax error');
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      if (!(error instanceof ParseError)) throw error;
      expect(error.Filename).toEqual(filename);
      expect(error.File?.Stmts?.[0]?.Cmd?.Type).toBe('CallExpr');
      expect(error.Incomplete).toBe(true);
      expect(error.Pos.IsValid).toBe(true);
      expect(error.Message).toBeInstanceOf(Uint8Array);
    }
    expect(() => parseSync('[[ a =~ b ]]', { Variant: 4 })).toThrow(LangError);
    expect(parseSync('echo after').Type).toBe('File');
  });

  it('preserves recovered positions and computes bounds from edited fields', () => {
    const file = parseSync('(foo |', { RecoverErrors: 2 });
    const command = file.Stmts?.[0]?.Cmd;
    if (command?.Type !== 'Subshell') throw new Error('Expected recovered subshell');
    expect(command.Rparen).toMatchObject({ IsRecovered: true, IsValid: false });
    expect(nodeEnd(command).IsRecovered).toBe(true);
    const comments = parseSync('#x', { KeepComments: true }).Last;
    const comment = comments?.[0];
    if (comment === undefined) throw new Error('Expected comment');
    expect(nodeEnd(comment).Offset).toBe(2);
    comment.Text = 'longer';
    expect(nodeEnd(comment).Offset).toBe(7);
  });

  it('matches byte-based StopAt constraints and preserves upstream Variant rejection', () => {
    expect(parseSync('echo ok éé ignored', { StopAt: 'éé' }).Stmts).toHaveLength(1);
    expect(() => parseSync('echo', { StopAt: 'ééé' })).toThrow(InputError);
    expect(() => parseSync('echo', { StopAt: 'a b' })).toThrow(InputError);
    expect(() => parseSync('echo', { Variant: 32 })).toThrow(InputError);
    expect(parseSync('echo', { Variant: 0 }).Type).toBe('File');
  });

  it('does not invoke an unrelated node-bound method on partial edited nodes', () => {
    const command = parseSync('echo a && echo b').Stmts?.[0]?.Cmd;
    if (command?.Type !== 'BinaryCmd') throw new Error('Expected binary command');
    const originalX = command.X;
    const originalY = command.Y;
    command.Y = null;
    expect(nodePos(command).Offset).toBe(0);
    expect(() => nodeEnd(command)).toThrow(InputError);
    command.X = null;
    command.Y = originalY;
    expect(nodeEnd(command).Offset).toBe(16);
    expect(() => nodePos(command)).toThrow(InputError);
    command.X = originalX;
  });

  it('rejects lossy JS strings and unsafe numbers before transport', () => {
    expect(() => parseSync('\ud800')).toThrow(InputError);
    expect(() => parseSync('echo', { Filename: '\udc00' })).toThrow(InputError);
    expect(() => parseSync('echo', { RecoverErrors: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      InputError,
    );
  });
});

describe('precise upstream numeric domains', () => {
  it('retains uint32 operators including zero and unnamed values', () => {
    expect(rawOperator('BinCmdOperator', 0)).toBe(0);
    expect(rawOperator('BinCmdOperator', 0xffff_ffff)).toBe(0xffff_ffff);
    for (const value of [-1, 1.5, NaN, Infinity, 0x1_0000_0000]) {
      expect(() => rawOperator('BinCmdOperator', value)).toThrow(InputError);
    }
  });

  it('uses actual uint64 constructor inputs with upstream saturation and overflow', () => {
    expect(newPos(7, 0, 0)).toEqual({
      Offset: 7,
      Line: 0,
      Col: 0,
      IsValid: false,
      IsRecovered: false,
    });
    expect(newPos(2n ** 64n - 1n, 2n ** 18n, 2n ** 14n)).toEqual({
      Offset: 0xffff_ffff - 11,
      Line: 0,
      Col: 0,
      IsValid: false,
      IsRecovered: false,
    });
    expect(() => newPos(2n ** 64n, 1, 1)).toThrow(InputError);
    expect(() => newPos(-1, 1, 1)).toThrow(InputError);
    expect(parseSync('echo', { RecoverErrors: 2n ** 63n - 1n }).Type).toBe('File');
    expect(() => parseSync('echo', { RecoverErrors: 2n ** 63n })).toThrow(InputError);
  });
});
