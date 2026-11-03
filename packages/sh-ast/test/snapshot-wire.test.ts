/** Transport observations must exactly cover the already validated tree, with no silent fallback calls. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWithPositionsSync, InputError, ShInternalError } from '../src/index.js';
import { callSyntax } from '../src/wasm-instance.js';

vi.mock('../src/wasm-instance.js', () => ({ callSyntax: vi.fn() }));
/** An empty upstream File still owns a pair of invalid source observations. */
const file = { Type: 'File', Name: '', Stmts: null, Last: null };
const observation = [0, 0, 0, 0, 0, 0, 0, 0];

beforeEach(() => vi.resetAllMocks());

describe('position snapshot boundary', () => {
  it('performs one parse operation and no per-node position transfers', () => {
    vi.mocked(callSyntax).mockReturnValue(
      JSON.stringify({ File: file, Positions: observation, PositionErrors: [] }),
    );
    const parsed = parseWithPositionsSync('');
    expect(parsed.Positions.get(parsed.File)?.End.Offset).toBe(0);
    expect(parsed.Positions.get(parsed.File)?.Pos.Offset).toBe(0);
    expect(vi.mocked(callSyntax).mock.calls.map((call) => call[0])).toEqual([
      'parse-with-positions',
    ]);
  });

  it.each([
    undefined,
    [],
    [observation, observation],
    [{ Path: ['Last', 0] }],
    [{ Pos: null }],
    [{ PosError: 'failure' }],
    [{ Extra: true }],
  ])('rejects incomplete, duplicated or contradictory snapshot metadata %#', (Positions) => {
    vi.mocked(callSyntax).mockReturnValue(
      JSON.stringify({ File: file, Positions, PositionErrors: [] }),
    );
    expect(() => parseWithPositionsSync('')).toThrow(ShInternalError);
  });

  it('retains a successful File when a captured bound fails and replays the failure without WASM', () => {
    vi.mocked(callSyntax).mockReturnValue(
      JSON.stringify({
        File: file,
        Positions: observation,
        PositionErrors: [[0, null, 'upstream node position: test failure']],
      }),
    );
    const parsed = parseWithPositionsSync('');
    expect(parsed.File).toEqual(file);
    expect(() => parsed.Positions.get(parsed.File)).toThrow(InputError);
    expect(callSyntax).toHaveBeenCalledTimes(1);
  });
});
