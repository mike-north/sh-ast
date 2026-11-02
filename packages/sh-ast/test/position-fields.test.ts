/**
 * Position names must never erase equally named data. Expectations below are
 * hand-derived from mvdan/sh v3.13.1 syntax/nodes.go, preserving issue #8 cases.
 */
import { describe, expect, it } from 'vitest';
import { LangMirBSDKorn, SYNTAX_SCHEMA, parseSync } from '../src/index.js';
import { firstNode } from './regression-helpers.js';

describe('upstream position-field classification', () => {
  it.each([
    ['Stmt', ['Position', 'Semicolon']],
    ['Lit', ['ValuePos', 'ValueEnd']],
    ['SglQuoted', ['Left', 'Right']],
    ['DblQuoted', ['Left', 'Right']],
    ['ParamExp', ['Dollar', 'Rbrace']],
    ['ForClause', ['ForPos', 'DoPos', 'DonePos']],
    ['WhileClause', ['WhilePos', 'DoPos', 'DonePos']],
    ['ArithmExp', ['Left', 'Right']],
    ['ArithmCmd', ['Left', 'Right']],
    ['CaseClause', ['Case', 'In', 'Esac']],
    ['File', []],
    ['Assign', []],
  ] as const)('%s retains exactly its declared position fields', (type, fields) => {
    const actual = Object.entries(SYNTAX_SCHEMA[type].fields)
      .filter(([, field]) => field.kind === 'position')
      .map(([name]) => name);
    expect(actual.sort()).toEqual([...fields].sort());
  });
});

describe('position/data name collision regressions', () => {
  it.each([
    ['select opt in a b; do echo "$opt"; break; done', true],
    ['for i in a b; do echo "$i"; done', false],
  ] as const)('retains Select including false defaults: %s', (source, expected) => {
    const loop = firstNode(parseSync(source), 'ForClause');
    expect(loop.Select).toBe(expected);
    expect(loop.DoPos.IsValid).toBe(true);
    expect(loop.Do?.length).toBeGreaterThan(0);
  });
  it.each([
    ['until false; do echo hi; done', true],
    ['while true; do echo hi; done', false],
  ] as const)('retains Until including false defaults: %s', (source, expected) => {
    const loop = firstNode(parseSync(source), 'WhileClause');
    expect(loop.Until).toBe(expected);
    expect(loop.WhilePos).toMatchObject({ Offset: 0, IsValid: true });
  });
  it.each([
    ['echo $((# 1 + 2))\n', 'ArithmExp', true],
    ['((# 1 + 2))\n', 'ArithmCmd', true],
    ['echo $((1 + 2))\n', 'ArithmExp', false],
    ['((3 + 4))\n', 'ArithmCmd', false],
  ] as const)('retains Unsigned including false defaults: %s', (source, type, expected) => {
    const arithmetic = firstNode(parseSync(source, { Variant: LangMirBSDKorn }), type);
    expect(arithmetic.Unsigned).toBe(expected);
    expect(arithmetic.Left.IsValid).toBe(true);
    expect(arithmetic.Right.IsValid).toBe(true);
  });
  it('retains ordinary invalid token positions rather than omitting the field', () => {
    const statement = parseSync('echo hi').Stmts?.[0];
    expect(statement?.Semicolon).toEqual({
      Offset: 0,
      Line: 0,
      Col: 0,
      IsValid: false,
      IsRecovered: false,
      OffsetOverflow: false,
    });
    expect(statement?.Background).toBe(false);
    expect(statement?.Negated).toBe(false);
  });
});
