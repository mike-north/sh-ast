/**
 * Malformed bridge responses must fail as internal defects before callers see
 * partial or falsely typed records. Complete nil-bearing files are valid.
 */
import { describe, expect, it, vi } from 'vitest';
import { ParseError, ShInternalError, parseSync } from '../src/index.js';

/** Replaces only the transport, so public response validation remains under test. */
const callSyntax = vi.hoisted(() => vi.fn<(...args: unknown[]) => string>());
vi.mock('../src/wasm-instance.js', () => ({ callSyntax }));

describe('syntax response guard', () => {
  it.each(['[]', '[1,2,3]', '"just a string"', 'null', '42', 'true', '{'])(
    'rejects malformed or non-record JSON: %s',
    (response) => {
      callSyntax.mockReturnValueOnce(response);
      expect(() => parseSync('echo hi')).toThrow(ShInternalError);
    },
  );
  it.each([
    {},
    { File: { Type: 'File' } },
    { File: { Type: 'File', Name: '', Stmts: [{}], Last: null } },
    { File: { Type: 'File', Name: '', Stmts: 'not-an-array', Last: null } },
    { File: { Type: 'NotFile', Name: '', Stmts: null, Last: null } },
    { Error: {} },
    { Error: { Kind: 'ParseError', Message: 'bad' }, File: null },
    { Error: { Kind: 'NotAnError', Message: 'bad' }, File: null },
  ])('rejects incomplete or wrong records: %j', (response) => {
    callSyntax.mockReturnValueOnce(JSON.stringify(response));
    let failure: unknown;
    try {
      parseSync('echo hi');
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ShInternalError);
    expect(failure).toMatchObject({ code: 'SH_AST_INTERNAL' });
    expect(failure).not.toBeInstanceOf(ParseError);
  });
  it('accepts a complete empty file with nil statement/comment slices', () => {
    const File = { Type: 'File', Name: '', Stmts: null, Last: null };
    callSyntax.mockReturnValueOnce(JSON.stringify({ File }));
    expect(parseSync('')).toEqual(File);
  });
});
