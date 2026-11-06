/** Syntax consumers can name faithful operators and construct unnamed family values. */
import { describe, expect, it } from 'vitest';
import {
  Add,
  AndStmt,
  Break,
  CmdIn,
  DefaultUnset,
  GlobOne,
  InputError,
  NamesPrefix,
  Not,
  Pipe,
  rawOperator,
  RdrOut,
  TsExists,
  TsReMatch,
} from '../src/index.js';

describe('syntax operator exports', () => {
  it('exposes named values from every referenced upstream operator family', () => {
    // These pinned mvdan/sh values are independent of the binding's export list.
    expect({
      Add,
      AndStmt,
      Break,
      CmdIn,
      DefaultUnset,
      GlobOne,
      NamesPrefix,
      Not,
      Pipe,
      RdrOut,
      TsExists,
      TsReMatch,
    }).toEqual({
      Add: 81,
      AndStmt: 11,
      Break: 35,
      CmdIn: 78,
      DefaultUnset: 83,
      GlobOne: 142,
      NamesPrefix: 43,
      Not: 39,
      Pipe: 13,
      RdrOut: 63,
      TsExists: 105,
      TsReMatch: 129,
    });
  });

  it('preserves unnamed uint32 values exactly', () => {
    expect(rawOperator('BinCmdOperator', 0)).toBe(0);
    expect(rawOperator('BinCmdOperator', 0xffff_ffff)).toBe(0xffff_ffff);
    expect(rawOperator('RedirOperator', 500)).toBe(500);
  });

  it.each([-1, 0.5, 0x1_0000_0000, NaN, Infinity])(
    'rejects non-uint32 operator value %s through the syntax entry',
    (value) => {
      expect(() => rawOperator('BinCmdOperator', value)).toThrow(InputError);
    },
  );

  it('rejects a runtime family outside the faithful operator domains', () => {
    expect(() => {
      Reflect.apply(rawOperator, undefined, ['UnknownFamily', 1]);
    }).toThrow(InputError);
  });
});
