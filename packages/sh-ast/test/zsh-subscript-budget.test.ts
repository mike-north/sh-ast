/**
 * Repeated reverse-subscript flags must use the existing 128-unit native policy.
 * This one bounded parse-only input exercises both actual WASM protocols and
 * public error translation; no mocked transport or shell execution is involved.
 */
import { describe, expect, it } from 'vitest';
import { LangZsh, ShParseMaxDepthError, parseSync, parseWithPositionsSync } from '../src/index.js';
import { callSyntax } from '../src/wasm-instance.js';

/** A fixed 614-byte expression reproduces the missing recursive work charge. */
const repeatedFlags = 'echo ${a[' + '(r)'.repeat(200) + 'foo]}';

/** Raw bridge records must be inspected before public exception translation. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe.each([0, 100000])('repeated flags with RecoverErrors=%i', (RecoverErrors) => {
  it.each(['parse', 'parse-with-positions'])(
    '%s returns only the terminal native resource error and remains reusable',
    (operation) => {
      expect(Buffer.byteLength(repeatedFlags)).toBe(614);
      const options = JSON.stringify({ Variant: LangZsh, RecoverErrors });
      const result: unknown = JSON.parse(
        callSyntax(operation, new TextEncoder().encode(repeatedFlags), options),
      );
      expect(isRecord(result)).toBe(true);
      if (!isRecord(result)) throw new Error('Expected native response record');
      // Exact keys exclude File, Positions and PositionErrors, including nulls.
      expect(Object.keys(result)).toEqual(['Error']);
      expect(result.Error).toMatchObject({
        Kind: 'ParseDepthError',
        MaxDepth: 128,
        Depth: 129,
      });
      if (!isRecord(result.Error)) throw new Error('Expected native error record');
      expect(typeof result.Error.Message).toBe('string');
      const reused: unknown = JSON.parse(
        callSyntax(operation, new TextEncoder().encode('echo alive'), options),
      );
      expect(reused).toMatchObject({ File: { Type: 'File' } });
      expect(reused).not.toHaveProperty('Error');
    },
  );

  it.each([parseSync, parseWithPositionsSync])(
    '%s throws the typed 129/128-unit refusal and remains reusable',
    (parse) => {
      const options = { Variant: LangZsh, RecoverErrors };
      expect(() => parse(repeatedFlags, options)).toThrow(ShParseMaxDepthError);
      try {
        parse(repeatedFlags, options);
      } catch (error) {
        expect(error).toMatchObject({
          code: 'SH_AST_PARSE_MAX_DEPTH',
          maxDepth: 128,
          estimatedDepth: 129,
        });
      }
      expect(() => parse('echo alive', options)).not.toThrow();
    },
  );
});
