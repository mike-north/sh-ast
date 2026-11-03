/** Hand-derived compact tuples exercise the public boundary independently of the Go producer. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InputError, parseWithPositionsSync, ShInternalError } from '../src/index.js';
import { callSyntax } from '../src/wasm-instance.js';

vi.mock('../src/wasm-instance.js', () => ({ callSyntax: vi.fn() }));

/** An empty File owns one occurrence with successful invalid-zero bounds. */
const file = { Type: 'File', Name: '', Stmts: null, Last: null };
/** Four coordinate/flag lanes per bound, Pos before End, for the root occurrence. */
const zeroTuple = [0, 0, 0, 0, 0, 0, 0, 0];

beforeEach(() => vi.resetAllMocks());

/** Feed a protocol response without deriving expected tuples from production helpers. */
function respond(Positions: unknown, PositionErrors: unknown): void {
  vi.mocked(callSyntax).mockReturnValue(JSON.stringify({ File: file, Positions, PositionErrors }));
}

describe('compact position snapshot boundary', () => {
  it('correlates the root without extra transfers and preserves frozen observations', () => {
    respond(zeroTuple, []);
    const parsed = parseWithPositionsSync('');
    const captured = parsed.Positions.get(parsed.File);
    expect(captured).toEqual({
      Pos: {
        Offset: 0,
        Line: 0,
        Col: 0,
        IsValid: false,
        IsRecovered: false,
        OffsetOverflow: false,
      },
      End: {
        Offset: 0,
        Line: 0,
        Col: 0,
        IsValid: false,
        IsRecovered: false,
        OffsetOverflow: false,
      },
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.Positions)).toBe(true);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured?.Pos)).toBe(true);
    expect(Object.isFrozen(captured?.End)).toBe(true);
    expect(Object.isFrozen(parsed.File)).toBe(false);
    expect(parsed.Positions.get({ ...parsed.File })).toBeUndefined();
    expect(vi.mocked(callSyntax).mock.calls.map(([operation]) => operation)).toEqual([
      'parse-with-positions',
    ]);
  });

  it.each(
    [
      undefined,
      null,
      {},
      [],
      zeroTuple.slice(1),
      [...zeroTuple, 0],
      [...zeroTuple, ...zeroTuple],
      ['0', 0, 0, 0, 0, 0, 0, 0],
      [-1, 0, 0, 0, 0, 0, 0, 0],
      [0.5, 0, 0, 0, 0, 0, 0, 0],
      [0xffff_ffff, 0, 0, 0, 0, 0, 0, 0],
      [0xffff_fff5, 1, 1, 1, 0, 0, 0, 0],
      [0, 0x4_0000, 0, 0, 0, 0, 0, 0],
      [0, 0, 0x4000, 0, 0, 0, 0, 0],
      [0, 0, 0, -1, 0, 0, 0, 0],
      [0, 0, 0, 8, 0, 0, 0, 0],
      [0, 0, 0, 0.5, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0, 0],
      [0, 1, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 2, 0, 0, 0, 0],
      [1, 0, 0, 4, 0, 0, 0, 0],
      [0, 1, 0, 6, 0, 0, 0, 0],
    ].map((positions) => ({ positions })),
  )('rejects malformed or contradictory numeric metadata %#', ({ positions }) => {
    respond(positions, []);
    expect(() => parseWithPositionsSync('')).toThrow(ShInternalError);
  });

  it.each(
    [
      undefined,
      null,
      {},
      [null],
      [[]],
      [[0]],
      [[0, 'failure']],
      [[0, 'failure', null, 'extra']],
      [[0, null, null]],
      [[-1, 'failure', null]],
      [[1, 'failure', null]],
      [[0.5, 'failure', null]],
      [['0', 'failure', null]],
      [[0, {}, null]],
      [[0, true, null]],
      [
        [0, 'first', null],
        [0, null, 'second'],
      ],
    ].map((errors) => ({ errors })),
  )('rejects malformed, duplicate or out-of-range sparse errors %#', ({ errors }) => {
    respond(zeroTuple, errors);
    expect(() => parseWithPositionsSync('')).toThrow(ShInternalError);
  });

  it('requires failed-bound placeholders to be zero while checking the opposite bound', () => {
    respond([1, 1, 2, 1, 0, 0, 0, 0], [[0, 'failed Pos', null]]);
    expect(() => parseWithPositionsSync('')).toThrow(ShInternalError);
    respond([0, 0, 0, 0, 0, 0, 0, 8], [[0, 'failed Pos', null]]);
    expect(() => parseWithPositionsSync('')).toThrow(ShInternalError);
  });

  it('preserves recovered and overflow flags as full public position objects', () => {
    respond([0, 0, 0, 6, 0, 2, 3, 4], []);
    const parsed = parseWithPositionsSync('');
    expect(parsed.Positions.get(parsed.File)).toEqual({
      Pos: { Offset: 0, Line: 0, Col: 0, IsValid: false, IsRecovered: true, OffsetOverflow: true },
      End: { Offset: 0, Line: 2, Col: 3, IsValid: false, IsRecovered: false, OffsetOverflow: true },
    });
  });

  it('accepts the exact maximum coordinate domains', () => {
    respond([0xffff_fff4, 0x3_ffff, 0x3fff, 1, 0xffff_fff4, 0x3_ffff, 0x3fff, 1], []);
    const parsed = parseWithPositionsSync('');
    expect(parsed.Positions.get(parsed.File)?.Pos).toEqual({
      Offset: 0xffff_fff4,
      Line: 0x3_ffff,
      Col: 0x3fff,
      IsValid: true,
      IsRecovered: false,
      OffsetOverflow: false,
    });
  });

  it('correlates distinct bounds in schema preorder rather than declaration order', () => {
    const position = {
      Offset: 2,
      Line: 1,
      Col: 3,
      IsValid: true,
      IsRecovered: false,
      OffsetOverflow: false,
    };
    const comment = { Type: 'Comment', Hash: position, Text: 'a' };
    const statement = {
      Type: 'Stmt',
      Background: false,
      Cmd: null,
      Comments: null,
      Coprocess: false,
      Disown: false,
      Negated: false,
      Position: position,
      Redirs: null,
      Semicolon: position,
    };
    vi.mocked(callSyntax).mockReturnValue(
      JSON.stringify({
        File: { ...file, Last: [comment], Stmts: [statement] },
        Positions: [0, 1, 1, 1, 22, 1, 23, 1, 2, 1, 3, 1, 4, 1, 5, 1, 20, 1, 21, 1, 22, 1, 23, 1],
        PositionErrors: [],
      }),
    );
    const parsed = parseWithPositionsSync('');
    const actualComment = parsed.File.Last?.[0];
    const actualStatement = parsed.File.Stmts?.[0];
    if (!actualComment || !actualStatement) throw new Error('Expected comment and statement');
    expect(parsed.Positions.get(parsed.File)?.Pos.Offset).toBe(0);
    expect(parsed.Positions.get(actualComment)?.Pos.Offset).toBe(2);
    expect(parsed.Positions.get(actualStatement)?.Pos.Offset).toBe(20);
  });

  it('throws independent byte-preserving errors without hiding the parsed File', () => {
    respond(zeroTuple, [[0, { Bytes: '/w==' }, 'end failure']]);
    const parsed = parseWithPositionsSync('');
    expect(parsed.File).toEqual(file);
    const failures: unknown[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        parsed.Positions.get(parsed.File);
      } catch (error) {
        failures.push(error);
        if (attempt === 0) {
          if (!(error instanceof InputError) || !(error.Message instanceof Uint8Array)) {
            throw new Error('Expected byte-bearing Pos failure');
          }
          expect(error.Message).toEqual(new Uint8Array([255]));
          error.Message[0] = 0;
        }
      }
    }
    expect(failures).toHaveLength(2);
    expect(failures[0]).toBeInstanceOf(InputError);
    expect(failures[1]).toBeInstanceOf(InputError);
    expect(failures[0]).not.toBe(failures[1]);
    const [first, second] = failures;
    if (!(first instanceof InputError) || !(second instanceof InputError)) {
      throw new Error('Expected captured InputErrors');
    }
    expect(first.Message).toEqual(new Uint8Array([0]));
    expect(second.Message).toEqual(new Uint8Array([255]));
    if (!(first.Message instanceof Uint8Array)) throw new Error('Expected byte-bearing failure');
    first.Message[0] = 0;
    expect(second.Message).toEqual(new Uint8Array([255]));
    expect(callSyntax).toHaveBeenCalledTimes(1);
  });

  it.each(
    [
      [0, '', null],
      [0, null, 'end failure'],
    ].map((errorRow) => ({ errorRow })),
  )('retains empty-string and End-only failures %#', ({ errorRow }) => {
    respond(zeroTuple, [errorRow]);
    const parsed = parseWithPositionsSync('');
    expect(() => parsed.Positions.get(parsed.File)).toThrow(InputError);
  });
});
