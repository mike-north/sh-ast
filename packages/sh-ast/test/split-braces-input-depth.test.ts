/**
 * Input transport must refuse structural depth before native decoding, including
 * warmed JS validation paths. Mocking native entry makes red probes safe and
 * proves refusal does not depend on a later decoder trap or output check.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { InputError } from '../src/syntax-errors.js';
import { ShInternalError } from '../src/errors.js';
import { splitBraces } from '../src/syntax-braces.js';
import type { Lit, SyntaxPos, Word, WordPart } from '../src/index.js';

const callSyntax = vi.hoisted(() => vi.fn<(...args: unknown[]) => string>());
vi.mock('../src/wasm-instance.js', () => ({ callSyntax }));
const zero: SyntaxPos = {
  Offset: 0,
  Line: 0,
  Col: 0,
  IsValid: false,
  IsRecovered: false,
  OffsetOverflow: false,
};

/** Each wrapper adds a Word and BraceExp record; arrays add no record depth. */
function wrap(word: Word, depth: number): Word {
  for (let index = 0; index < depth; index++) {
    word = { Type: 'Word', Parts: [{ Type: 'BraceExp', Sequence: false, Elems: [word] }] };
  }
  return word;
}

/** Quoting adds one structural record above the literal and its position value. */
function input(depth: number, quoted = false): Word {
  const literal: Lit = { Type: 'Lit', Value: 'leaf', ValuePos: zero, ValueEnd: zero };
  const part: WordPart = quoted
    ? { Type: 'DblQuoted', Left: zero, Right: zero, Dollar: false, Parts: [literal] }
    : literal;
  return wrap({ Type: 'Word', Parts: [part] }, depth);
}

/** Capture a thrown value without assuming an error family before asserting it. */
function caught(word: Word): unknown {
  try {
    splitBraces(word);
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Refusal precedes encoding/native entry and does not fabricate an engine trap. */
function refused(word: Word): void {
  const parts = word.Parts;
  const first = parts?.[0];
  const error = caught(word);
  expect(error).toBeInstanceOf(ShInternalError);
  if (!(error instanceof ShInternalError)) {
    throw new Error('Expected an input transport refusal');
  }
  expect(error.message).toBe(
    'SplitBraces input record depth 257 exceeds the bridge transport limit 256',
  );
  expect(error.cause).toBeUndefined();
  expect(word.Parts).toBe(parts);
  expect(word.Parts?.[0]).toBe(first);
  expect(callSyntax).not.toHaveBeenCalled();
}

beforeEach(() => {
  callSyntax.mockReset();
  callSyntax.mockReturnValue('{"Changed":false}');
});

it('accepts an exact 256-record false-only Word and refuses 257 records before native entry', () => {
  // max plain depth = 2*wrappers + Word + Lit + Pos; quoting adds one.
  const boundary = input(126, true);
  const parts = boundary.Parts;
  expect(splitBraces(boundary)).toBe(false);
  expect(boundary.Parts).toBe(parts);
  expect(callSyntax).toHaveBeenCalledTimes(1);
  callSyntax.mockClear();
  refused(input(127));
});

it('refuses a cold 1600-wrapper input before recursive validation and decoding', () => {
  refused(input(1600));
});

it('refuses the same input after warming accepted false-only validation/encoding paths', () => {
  for (const depth of [30, 100]) {
    for (let attempt = 0; attempt < 40; attempt++) expect(splitBraces(input(depth))).toBe(false);
  }
  callSyntax.mockClear();
  refused(input(1600));
});

it('revisits a shared record at its deeper path instead of pruning by global identity', () => {
  const shared = input(75);
  const word: Word = {
    Type: 'Word',
    Parts: [
      { Type: 'BraceExp', Sequence: false, Elems: [shared] },
      { Type: 'BraceExp', Sequence: false, Elems: [wrap(shared, 75)] },
    ],
  };
  refused(word);
});

it('retains valid shared aliases and byte values below the structural limit', () => {
  const part: Lit = {
    Type: 'Lit',
    Value: new Uint8Array(1024).fill(0xfe),
    ValuePos: zero,
    ValueEnd: zero,
  };
  const word: Word = { Type: 'Word', Parts: [part, part] };
  expect(splitBraces(word)).toBe(false);
  expect(word.Parts?.[0]).toBe(word.Parts?.[1]);
  expect(word.Parts?.[0]).toBe(part);
});

it('keeps record cycles as InputError and never enters native code', () => {
  const word: Word = { Type: 'Word', Parts: null };
  word.Parts = [{ Type: 'BraceExp', Sequence: false, Elems: [word] }];
  expect(() => splitBraces(word)).toThrow(InputError);
  expect(callSyntax).not.toHaveBeenCalled();
});
