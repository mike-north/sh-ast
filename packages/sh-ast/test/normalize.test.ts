/**
 * Former normalization regressions now assert the faithful boundary: complete
 * positions/defaults and auxiliary data survive without synthetic ranges.
 * The old UTF-16 conversion helper is a consumer-adapter responsibility.
 */
import { describe, expect, it } from 'vitest';
import { DefaultUnsetOrNull, InputError, nodePos, parseSync } from '../src/index.js';
import { firstNode, nodes, sourceText } from './regression-helpers.js';

describe('faithful records replace lossy normalization', () => {
  it.each([
    ['echo hi', 'hi', 5],
    ['echo é x', 'x', 8],
    ['echo 🎉 x', 'x', 10],
    ['echo e\u0301 x', 'x', 9],
  ] as const)('retains upstream byte offsets in %s', (source, text, offset) => {
    const literal = nodes(parseSync(source)).find(
      (node) => node.Type === 'Lit' && node.Value === text,
    );
    if (!literal) throw new Error('Missing positioned literal');
    expect(nodePos(literal).Offset).toBe(offset);
    expect(sourceText(source, literal)).toBe(text);
  });
  it('rejects unpaired surrogates before they can be silently replaced', () => {
    expect(() => parseSync('echo \ud800')).toThrow(InputError);
  });
  it.each(['', ' \n\t'])('represents an empty program without invented bounds: %j', (source) => {
    const file = parseSync(source);
    expect(file.Stmts).toBeNull();
    expect(nodePos(file).IsValid).toBe(false);
    expect(file).not.toHaveProperty('range');
  });
  it('preserves an empty parameter default as a real auxiliary with nil Word', () => {
    const param = firstNode(parseSync('echo ${a:-}'), 'ParamExp');
    expect(param.Exp).toEqual({ Type: 'Expansion', Op: DefaultUnsetOrNull, Word: null });
    expect(param.Exp).not.toHaveProperty('range');
    expect(param.Exp).not.toHaveProperty('loc');
  });
  it('preserves a nonempty default through its actual Word child', () => {
    const source = 'echo ${a:-x}';
    const param = firstNode(parseSync(source), 'ParamExp');
    if (!param.Exp?.Word) throw new Error('Missing default operand');
    expect(sourceText(source, param.Exp.Word)).toBe('x');
    expect(param.Exp).not.toHaveProperty('Pos');
  });
  it.each([
    ["echo $'\\t'", 'SglQuoted', true],
    ["echo 'rm'", 'SglQuoted', false],
    ['echo $""', 'DblQuoted', true],
    ['echo ""', 'DblQuoted', false],
  ] as const)('preserves quote Dollar boolean: %s', (source, type, expected) => {
    expect(firstNode(parseSync(source), type).Dollar).toBe(expected);
  });
  it('preserves ParamExp.Dollar as a position without confusing it with quote booleans', () => {
    expect(firstNode(parseSync('echo $x'), 'ParamExp').Dollar).toMatchObject({
      Offset: 5,
      Line: 1,
      Col: 6,
      IsValid: true,
    });
  });
});
