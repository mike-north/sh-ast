/** Faithful analysis preserves caller-owned records and never invents Unicode text for bytes. */
import { describe, expect, it } from 'vitest';
import type { CallExpr, Lit, SyntaxPos, Word } from '../generated/syntax-types.js';
import { syntheticNode } from './analyze-fixtures.js';
import { enumerateCommands, resolveArgv0, resolveWord } from '../src/analyze/index.js';

/** Invalid upstream positions are legal data even when no source document exists. */
const zero: SyntaxPos = {
  Offset: 0,
  Line: 0,
  Col: 0,
  IsValid: false,
  IsRecovered: false,
  OffsetOverflow: false,
};
/** A literal built by a consumer must resolve without parsing or projection first. */
function literal(Value: Lit['Value']): Word {
  return { Type: 'Word', Parts: [{ Type: 'Lit', ValuePos: zero, ValueEnd: zero, Value }] };
}

describe('analysis of faithful syntax records', () => {
  it('resolves a caller-built raw Word and nil default parts', () => {
    expect(resolveWord(literal('hello'))).toEqual({ static: true, text: 'hello' });
    expect(resolveWord({ Type: 'Word', Parts: null })).toEqual({ static: true, text: '' });
  });

  it('preserves CallExpr identity and observes subsequent caller edits', () => {
    const call: CallExpr = {
      Type: 'CallExpr',
      Assigns: null,
      Args: [literal('env'), literal('rm')],
    };
    const first = enumerateCommands(call)[0];
    expect(first.node).toBe(call);
    expect(resolveArgv0(first).effective).toEqual({ static: true, text: 'rm' });
    call.Args = [literal('pwd')];
    expect(enumerateCommands(call)[0].argv0).toEqual({ static: true, text: 'pwd' });
  });

  it('reports byte strings as unsupported rather than silently treating them as empty', () => {
    expect(resolveWord(literal(new Uint8Array([0xff])))).toEqual({
      static: false,
      reason: 'unsupported',
    });
  });

  it('does not invent text for nil word-part pointers', () => {
    expect(resolveWord({ Type: 'Word', Parts: [null] })).toEqual({
      static: false,
      reason: 'unsupported',
    });
    expect(
      resolveWord({ Type: 'Word', Parts: [syntheticNode('DblQuoted', { Parts: [null] })] }),
    ).toEqual({ static: false, reason: 'unsupported' });
  });

  it('preserves byte-valued function names in command contexts', () => {
    const name = new Uint8Array([0xff]);
    const root = syntheticNode('FuncDecl', {
      Name: syntheticNode('Lit', { Value: name }),
      Body: syntheticNode('Stmt', { Cmd: syntheticNode('CallExpr', { Args: [literal('pwd')] }) }),
    });
    expect(enumerateCommands(root)[0].context).toEqual([{ kind: 'function', name }]);
  });

  it('does not drop a byte-valued quoted fragment during concatenation', () => {
    const word: Word = {
      Type: 'Word',
      Parts: [
        syntheticNode('SglQuoted', { Value: new Uint8Array([0xff]) }),
        syntheticNode('Lit', { Value: 'suffix' }),
      ],
    };
    expect(resolveWord(word)).toEqual({ static: false, reason: 'unsupported' });
  });
});
