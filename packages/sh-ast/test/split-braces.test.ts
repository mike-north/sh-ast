/**
 * Public SplitBraces preserves the selected Go operation's boolean, transformed
 * records, and reused input WordPart identities. It does not classify expansion
 * possibility or change parser output before a caller explicitly invokes it.
 */
import { describe, expect, it } from 'vitest';
import {
  InputError,
  ShInternalError,
  parseSync,
  parseWithPositionsSync,
  splitBraces,
  walk,
} from '../src/index.js';
import type { Lit, Node, SyntaxPos, Word } from '../src/index.js';

/** Invalid zero positions are faithful values for caller-constructed records. */
const zero: SyntaxPos = {
  Offset: 0,
  Line: 0,
  Col: 0,
  IsValid: false,
  IsRecovered: false,
  OffsetOverflow: false,
};

/** Source text and positions remain separate values even after literal splitting. */
function literal(Value: string | Uint8Array): Lit {
  return { Type: 'Lit', Value, ValuePos: { ...zero }, ValueEnd: { ...zero } };
}

/** Parse only the Word input; the parser must leave literal braces unsplit. */
function word(source: string): Word {
  const command = parseSync(`echo ${source}`).Stmts?.[0]?.Cmd;
  if (
    command?.Type !== 'CallExpr' ||
    command.Args?.[1] === null ||
    command.Args?.[1] === undefined
  ) {
    throw new Error('Expected one parsed argument Word');
  }
  return command.Args[1];
}

/** Enumerates represented nodes without treating null-exit events as nodes. */
function nodes(root: Node): Node[] {
  const result: Node[] = [];
  walk(root, (node) => {
    if (node !== null) {
      result.push(node);
    }
    return true;
  });
  return result;
}

describe('faithful splitBraces', () => {
  it.each(['ordinary', "'{a,b}'", '"{a,b}"'])(
    'false leaves %s and all caller identities untouched',
    (source) => {
      const input = word(source);
      const parts = input.Parts;
      const first = parts?.[0];
      expect(splitBraces(input)).toBe(false);
      expect(input.Parts).toBe(parts);
      expect(input.Parts?.[0]).toBe(first);
    },
  );

  it.each(['{a}', '{}', 'a{b', '{a,b', '{1..z}'])(
    'returns upstream true for %s even without a BraceExp',
    (source) => {
      const input = word(source);
      const originalParts = input.Parts;
      expect(splitBraces(input)).toBe(true);
      expect(input.Parts).not.toBe(originalParts);
      expect(input.Parts?.some((part) => part?.Type === 'BraceExp')).toBe(false);
    },
  );

  it('retains the Word root and Go-reused parts inside newly created elements', () => {
    const keep = literal('keep');
    const quote = {
      Type: 'SglQuoted',
      Left: { ...zero },
      Right: { ...zero },
      Dollar: false,
      Value: '中',
    } satisfies import('../src/index.js').SglQuoted;
    const tail = literal('end');
    const input: Word = {
      Type: 'Word',
      Parts: [keep, literal('{a,'), quote, literal('}tail'), tail],
    };
    const alias = input;
    const previousParts = input.Parts;
    const before = structuredClone(previousParts);
    expect(splitBraces(input)).toBe(true);
    expect(input).toBe(alias);
    expect(input.Parts).not.toBe(previousParts);
    expect(previousParts).toEqual(before);
    expect(input.Parts?.[0]).toBe(keep);
    expect(input.Parts?.[3]).toBe(tail);
    const brace = input.Parts?.[1];
    if (brace?.Type !== 'BraceExp') {
      throw new Error('Expected a new BraceExp');
    }
    expect(brace.Elems?.[1]?.Parts?.[1]).toBe(quote);
    expect(brace.Elems?.[0]?.Parts?.[0]).not.toBe(previousParts?.[1]);
  });

  it('preserves repeated input aliases instead of matching parts by value', () => {
    const shared = literal('same');
    const separate = literal('same');
    const input: Word = { Type: 'Word', Parts: [shared, literal('{a,b}'), shared, separate] };
    expect(splitBraces(input)).toBe(true);
    expect(input.Parts?.[0]).toBe(shared);
    expect(input.Parts?.at(-2)).toBe(shared);
    expect(input.Parts?.at(-1)).toBe(separate);
  });

  it('retains parsed byte positions, reused snapshot identities, and unrelated syntax', () => {
    const parsed = parseWithPositionsSync('echo é{a,"中"}tail');
    const command = parsed.File.Stmts?.[0]?.Cmd;
    if (command?.Type !== 'CallExpr') {
      throw new Error('Expected CallExpr');
    }
    const input = command.Args?.[1];
    const quoted = input?.Parts?.find((part) => part?.Type === 'DblQuoted');
    if (!input || quoted?.Type !== 'DblQuoted') {
      throw new Error('Expected mixed argument');
    }
    const oldQuotePositions = parsed.Positions.get(quoted);
    expect(nodes(input).some((node) => node.Type === 'BraceExp')).toBe(false);
    expect(splitBraces(input)).toBe(true);
    const brace = input.Parts?.find((part) => part?.Type === 'BraceExp');
    if (brace?.Type !== 'BraceExp') {
      throw new Error('Expected a new BraceExp');
    }
    // Selected Go Walk itself rejects BraceExp; inspect the faithful records
    // directly rather than silently extending traversal in the binding.
    expect(
      brace.Elems?.flatMap((element) => element?.Parts ?? []).find(
        (part) => part?.Type === 'DblQuoted',
      ),
    ).toBe(quoted);
    expect(parsed.Positions.get(quoted)).toBe(oldQuotePositions);
    const prefix = input.Parts?.[0];
    if (prefix?.Type !== 'Lit') {
      throw new Error('Expected split prefix');
    }
    expect(prefix.Value).toBe('é');
    // Go copies the original literal positions while splitting its Value. The
    // binding does not manufacture new source positions for the smaller text.
    expect(prefix.ValuePos.Offset).toBe(5);
    expect(prefix.ValueEnd.Offset).toBe(10);
    expect(parsed.Positions.get(prefix)).toBeUndefined();
    expect(command.Args?.[0]?.Parts?.[0]).toMatchObject({ Type: 'Lit', Value: 'echo' });
  });

  it('preserves byte strings and explicit nil data', () => {
    const nilWord: Word = { Type: 'Word', Parts: null };
    expect(splitBraces(nilWord)).toBe(false);
    expect(nilWord.Parts).toBeNull();
    const tag = {
      Type: 'TypedNil',
      Kind: 'SglQuoted',
    } satisfies import('../src/index.js').TypedNil<'SglQuoted'>;
    const input: Word = {
      Type: 'Word',
      Parts: [null, tag, literal(new Uint8Array([123, 97, 44, 254, 125]))],
    };
    expect(splitBraces(input)).toBe(true);
    expect(input.Parts?.[0]).toBeNull();
    expect(input.Parts?.[1]).toBe(tag);
    const brace = input.Parts?.[2];
    if (brace?.Type !== 'BraceExp') {
      throw new Error('Expected byte-bearing BraceExp');
    }
    expect(brace.Elems?.[1]?.Parts?.[0]).toMatchObject({
      Type: 'Lit',
      Value: new Uint8Array([254]),
      ValuePos: zero,
      ValueEnd: zero,
    });
  });

  it('distinguishes invalid input from a representable upstream panic and permits reuse', () => {
    for (const invalid of [null, {}, { Type: 'TypedNil', Kind: 'Word' }]) {
      expect(() => {
        Reflect.apply(splitBraces, undefined, [invalid]);
      }).toThrow(InputError);
    }
    const input: Word = { Type: 'Word', Parts: [{ Type: 'TypedNil', Kind: 'Lit' }] };
    const originalParts = input.Parts;
    expect(() => splitBraces(input)).toThrow(ShInternalError);
    expect(input.Parts).toBe(originalParts);
    expect(splitBraces(word('{a,b}'))).toBe(true);
  });
});
