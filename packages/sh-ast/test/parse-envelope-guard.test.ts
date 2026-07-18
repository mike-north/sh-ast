/**
 * Regression test for the `isResultEnvelope` type guard in `src/parse.ts`.
 *
 * The guard originally only checked `typeof value === 'object' && value !==
 * null`, which accepts arrays (`typeof [] === 'object'` in JS) as a valid
 * result envelope. A shim payload of `[]` or `[1, 2]` would then pass
 * through `isResultEnvelope` unrejected and fail later with a confusing
 * "neither a file nor an error" message (or worse, silently read `undefined`
 * off array indices) instead of the clear "unexpected payload shape" error.
 * The guard now also rejects arrays and non-plain objects up front.
 *
 * The last `describe` block below also covers criterion 2 of
 * https://github.com/mike-north/eslint-sh/issues/12: a malformed envelope
 * must throw `ShInternalError` (not a bare `Error`), reusing this
 * file's `vi.mock` scaffolding for the WASM shim boundary.
 *
 * @see design/ARCHITECTURE.md — serialization contract between the WASM
 *   shim and `parseSync`
 */
import { describe, expect, it, vi } from 'vitest';

const callParse = vi.fn<(text: string, dialect: string, filename: string) => string>();

vi.mock('../src/wasm-instance.js', () => ({
  callParse: (text: string, dialect: string, filename: string) =>
    callParse(text, dialect, filename),
}));

describe('parseSync — regression: isResultEnvelope must reject arrays', () => {
  it('throws the payload-shape error when the shim returns a JSON array', async () => {
    callParse.mockReturnValueOnce('[]');
    const { parseSync } = await import('../src/index.js');
    expect(() => parseSync('echo hi')).toThrow(
      'bridge: WASM shim returned an unexpected payload shape',
    );
  });

  it('throws the payload-shape error when the shim returns a JSON array with elements', async () => {
    callParse.mockReturnValueOnce('[1,2,3]');
    const { parseSync } = await import('../src/index.js');
    expect(() => parseSync('echo hi')).toThrow(
      'bridge: WASM shim returned an unexpected payload shape',
    );
  });

  it('throws the payload-shape error when the shim returns a non-object JSON value', async () => {
    callParse.mockReturnValueOnce('"just a string"');
    const { parseSync } = await import('../src/index.js');
    expect(() => parseSync('echo hi')).toThrow(
      'bridge: WASM shim returned an unexpected payload shape',
    );
  });

  it('throws the payload-shape error when the shim returns null', async () => {
    callParse.mockReturnValueOnce('null');
    const { parseSync } = await import('../src/index.js');
    expect(() => parseSync('echo hi')).toThrow(
      'bridge: WASM shim returned an unexpected payload shape',
    );
  });
});

describe('parseSync — regression: an envelope with neither file, parseError, nor error', () => {
  it('throws the "neither a file nor an error" error for an empty envelope', async () => {
    // `isResultEnvelope({})` is true — every envelope field is optional —
    // so `{}` reaches the dedicated "neither a file nor an error" branch
    // rather than the "unexpected payload shape" one above.
    callParse.mockReturnValueOnce('{}');
    const { parseSync } = await import('../src/index.js');
    expect(() => parseSync('echo hi')).toThrow(
      'bridge: WASM shim returned neither a file nor an error',
    );
  });
});

describe('parseSync — regression: asShFile validates the normalized root, not just node.type', () => {
  // A minimal raw node shape that satisfies `normalize`'s `isRawNode` check
  // (a JsonValue object with well-formed Pos/End fields); each test tweaks
  // just the field the guard under test cares about.
  const pos = { Offset: 0, Line: 1, Col: 1 };

  it('throws when the root node has type "File" but no "stmts" field at all', async () => {
    callParse.mockReturnValueOnce(
      JSON.stringify({
        file: { Pos: pos, End: pos },
      }),
    );
    const { parseSync } = await import('../src/index.js');
    expect(() => parseSync('echo hi')).toThrow(
      'bridge: expected root node to have an array "stmts" field',
    );
  });

  it('throws when the root node\'s "stmts" field is present but not an array', async () => {
    callParse.mockReturnValueOnce(
      JSON.stringify({
        file: { Pos: pos, End: pos, Stmts: 'not-an-array' },
      }),
    );
    const { parseSync } = await import('../src/index.js');
    expect(() => parseSync('echo hi')).toThrow(
      'bridge: expected root node to have an array "stmts" field',
    );
  });

  it('throws when the root node has a type other than "File" (previously untested branch)', async () => {
    callParse.mockReturnValueOnce(
      JSON.stringify({
        file: { Type: 'NotFile', Pos: pos, End: pos },
      }),
    );
    const { parseSync } = await import('../src/index.js');
    expect(() => parseSync('echo hi')).toThrow(
      'bridge: expected root node of type "File", got "NotFile"',
    );
  });
});

describe('parseSync — criterion 2: malformed shim envelope throws ShInternalError', () => {
  it('throws ShInternalError (code "SH_AST_INTERNAL") when the shim returns a JSON array', async () => {
    expect.assertions(3);
    callParse.mockReturnValueOnce('[]');
    const { parseSync, ShInternalError } = await import('../src/index.js');
    try {
      parseSync('echo hi');
    } catch (error) {
      expect(error).toBeInstanceOf(ShInternalError);
      expect((error as InstanceType<typeof ShInternalError>).code).toBe('SH_AST_INTERNAL');
      // criterion 5 (negative): a malformed-envelope error is not a parse error
      const { ShParseError } = await import('../src/index.js');
      expect(error).not.toBeInstanceOf(ShParseError);
    }
  });
});
