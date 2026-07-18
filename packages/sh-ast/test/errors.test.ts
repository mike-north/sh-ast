/**
 * Tests for the error taxonomy introduced by
 * https://github.com/mike-north/eslint-sh/issues/12 (criteria 1, 3, 5).
 * Criterion 2 (malformed shim envelope -> `ShInternalError`) lives in
 * `test/parse-envelope-guard.test.ts`, reusing that file's `vi.mock`
 * scaffolding for the WASM shim boundary.
 *
 * @see design/ARCHITECTURE.md — serialization contract, parse errors and dialects
 * @see design/PACKAGES.md §`sh-ast` — the public API under test
 */
import { describe, expect, it } from 'vitest';
import {
  ShAstError,
  ShInternalError,
  ShInvalidDialectError,
  ShParseError,
  parseSync,
} from '../src/index.js';

describe('ShInvalidDialectError — criterion 1: unrecognized dialect', () => {
  it('throws ShInvalidDialectError with code "SH_AST_INVALID_DIALECT" and .dialect === "fish"', () => {
    expect.assertions(4);
    try {
      parseSync('echo hi', { dialect: 'fish' as never });
    } catch (error) {
      expect(error).toBeInstanceOf(ShInvalidDialectError);
      const invalidDialectError = error as ShInvalidDialectError;
      expect(invalidDialectError.code).toBe('SH_AST_INVALID_DIALECT');
      expect(invalidDialectError.dialect).toBe('fish');
      // The design decision requires the supported dialects to be listed in
      // the message; spot-check a couple rather than asserting the exact
      // wording.
      expect(invalidDialectError.message).toContain('bash');
    }
  });

  it('is an instance of the common ShAstError base (instanceof + code both work)', () => {
    expect.assertions(1);
    try {
      parseSync('echo hi', { dialect: 'fish' as never });
    } catch (error) {
      expect(error).toBeInstanceOf(ShAstError);
    }
  });

  it('criterion 5 (negative): ShInvalidDialectError is NOT an instance of ShParseError', () => {
    expect.assertions(1);
    try {
      parseSync('echo hi', { dialect: 'fish' as never });
    } catch (error) {
      expect(error).not.toBeInstanceOf(ShParseError);
    }
  });

  it('criterion 5 (negative): ShInvalidDialectError is NOT an instance of ShInternalError', () => {
    expect.assertions(1);
    try {
      parseSync('echo hi', { dialect: 'fish' as never });
    } catch (error) {
      expect(error).not.toBeInstanceOf(ShInternalError);
    }
  });
});

describe('ShParseError — criterion 3: stable code discriminator', () => {
  it('exposes code === "SH_AST_PARSE_ERROR" alongside the existing .line/.column/.filename fields', () => {
    expect.assertions(5);
    try {
      parseSync('if true; then\n', { filename: 'b.sh' });
    } catch (error) {
      expect(error).toBeInstanceOf(ShParseError);
      const parseError = error as ShParseError;
      expect(parseError.code).toBe('SH_AST_PARSE_ERROR');
      // The existing fields (design decision: "without breaking its existing
      // fields") must still be present and correctly populated.
      expect(parseError.line).toBe(1);
      expect(parseError.column).toBe(10);
      expect(parseError.filename).toBe('b.sh');
    }
  });

  it('criterion 5 (negative): ShParseError is NOT an instance of ShInvalidDialectError or ShInternalError', () => {
    expect.assertions(2);
    try {
      parseSync('if true; then\n', { filename: 'b.sh' });
    } catch (error) {
      expect(error).not.toBeInstanceOf(ShInvalidDialectError);
      expect(error).not.toBeInstanceOf(ShInternalError);
    }
  });

  it('is an instance of the common ShAstError base', () => {
    expect.assertions(1);
    try {
      parseSync('if true; then\n', { filename: 'b.sh' });
    } catch (error) {
      expect(error).toBeInstanceOf(ShAstError);
    }
  });
});

describe('ShInternalError — criterion 5 (negative): wrong-type checks', () => {
  it('a directly constructed ShInternalError is not an instance of ShParseError or ShInvalidDialectError', () => {
    const internalError = new ShInternalError('bridge: something unexpected happened');
    expect(internalError).not.toBeInstanceOf(ShParseError);
    expect(internalError).not.toBeInstanceOf(ShInvalidDialectError);
    expect(internalError).toBeInstanceOf(ShAstError);
    expect(internalError.code).toBe('SH_AST_INTERNAL');
    expect(internalError.name).toBe('ShInternalError');
  });
});
