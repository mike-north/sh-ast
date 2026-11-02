/** Error families distinguish caller input, source grammar, dialect gates and bridge defects. */
import { describe, expect, it } from 'vitest';
import {
  InputError,
  LangError,
  LangPOSIX,
  ParseError,
  ShAstError,
  ShInternalError,
  parseSync,
} from '../src/index.js';

/** Returns a thrown error so every taxonomy assertion examines the same failure. */
function failure(source: string, options: Parameters<typeof parseSync>[1]): unknown {
  try {
    parseSync(source, options);
  } catch (error) {
    return error;
  }
  throw new Error('Fixture unexpectedly parsed');
}

describe('error taxonomy', () => {
  it('invalid numeric variants are input errors with no source position', () => {
    const error = failure('echo hi', { Variant: -1 });
    expect(error).toBeInstanceOf(InputError);
    expect(error).toBeInstanceOf(ShAstError);
    expect(error).toMatchObject({ code: 'SH_AST_SYNTAX_INPUT', name: 'InputError' });
    expect(error).not.toBeInstanceOf(ParseError);
    expect(error).not.toBeInstanceOf(LangError);
    expect(error).not.toBeInstanceOf(ShInternalError);
    expect(error).not.toHaveProperty('Pos');
  });
  it('grammar errors preserve structured upstream data and a stable discriminator', () => {
    const error = failure('if true; then\n', { Filename: 'b.sh' });
    expect(error).toBeInstanceOf(ParseError);
    expect(error).toBeInstanceOf(ShAstError);
    expect(error).toMatchObject({
      code: 'SH_AST_SYNTAX_PARSE',
      Filename: 'b.sh',
      Pos: { Line: 1, Col: 10, Offset: 9 },
      Incomplete: true,
    });
    expect(error).not.toBeInstanceOf(InputError);
    expect(error).not.toBeInstanceOf(ShInternalError);
    expect(error).not.toBeInstanceOf(LangError);
  });
  it('dialect rejection preserves the rejected feature and selected variant', () => {
    const error = failure('a=(1 2 3)', { Variant: LangPOSIX });
    expect(error).toBeInstanceOf(LangError);
    expect(error).toBeInstanceOf(ShAstError);
    expect(error).toMatchObject({
      code: 'SH_AST_SYNTAX_LANG',
      Feature: 'arrays',
      LangUsed: LangPOSIX,
    });
    expect(error).not.toBeInstanceOf(ParseError);
    expect(error).not.toBeInstanceOf(InputError);
    expect(error).not.toBeInstanceOf(ShInternalError);
  });
  it('internal bridge errors retain their own family', () => {
    const error = new ShInternalError('Malformed bridge response');
    expect(error).toBeInstanceOf(ShAstError);
    expect(error).toMatchObject({ code: 'SH_AST_INTERNAL', name: 'ShInternalError' });
    expect(error).not.toBeInstanceOf(ParseError);
    expect(error).not.toBeInstanceOf(LangError);
    expect(error).not.toBeInstanceOf(InputError);
  });
});
