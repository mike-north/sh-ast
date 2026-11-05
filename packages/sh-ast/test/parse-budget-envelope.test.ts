/** Native resource refusals have a separate, strictly validated error-only protocol. */
import { beforeEach, expect, it, vi } from 'vitest';
import { ShInternalError, ShParseMaxDepthError } from '../src/errors.js';
import { InputError } from '../src/syntax-errors.js';
import { parseSync, parseWithPositionsSync } from '../src/syntax.js';

/** Mock transport isolates protocol validation from native parser behavior. */
const callSyntax = vi.hoisted(() => vi.fn<(...args: unknown[]) => string>());
vi.mock('../src/wasm-instance.js', () => ({ callSyntax }));

/** The native counter reports the first rejected entry, without a partial File. */
const refusal = {
  Kind: 'ParseDepthError',
  Message: 'native resource refusal',
  MaxDepth: 128,
  Depth: 129,
};

beforeEach(() => callSyntax.mockReset());

it.each([parseSync, parseWithPositionsSync])(
  'retains the resource error identity for %s',
  (parse) => {
    callSyntax.mockReturnValue(JSON.stringify({ Error: refusal }));
    expect(() => parse('echo ok')).toThrow(ShParseMaxDepthError);
    try {
      parse('echo ok');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'ShParseMaxDepthError',
        code: 'SH_AST_PARSE_MAX_DEPTH',
        maxDepth: 128,
        estimatedDepth: 129,
      });
    }
  },
);

it.each([
  { MaxDepth: undefined },
  { MaxDepth: null },
  { MaxDepth: '128' },
  { MaxDepth: 0 },
  { MaxDepth: -1 },
  { MaxDepth: 1.5 },
  { MaxDepth: Number.MAX_SAFE_INTEGER + 1 },
  { Depth: undefined },
  { Depth: null },
  { Depth: '129' },
  { Depth: 0 },
  { Depth: -1 },
  { Depth: 129.5 },
  { Depth: Number.MAX_SAFE_INTEGER + 1 },
  { Depth: 128 },
  { Depth: 127 },
  { Message: undefined },
  { Message: 42 },
  { Message: null },
  { Message: {} },
])('rejects malformed resource fields %j', (change) => {
  callSyntax.mockReturnValue(JSON.stringify({ Error: { ...refusal, ...change } }));
  expect(() => parseSync('echo ok')).toThrow(ShInternalError);
});

it.each([{ File: null }, { Positions: [] }, { PositionErrors: [] }])(
  'rejects a resource response carrying partial-result fields %j',
  (extra) => {
    callSyntax.mockReturnValue(JSON.stringify({ Error: refusal, ...extra }));
    expect(() => parseWithPositionsSync('echo ok')).toThrow(ShInternalError);
  },
);

it('accepts the shared byte-string message representation', () => {
  callSyntax.mockReturnValue(JSON.stringify({ Error: { ...refusal, Message: { Bytes: '/g==' } } }));
  expect(() => parseSync('echo ok')).toThrow(ShParseMaxDepthError);
});

it('does not add protocol restrictions to the existing public constructor', () => {
  const error = new ShParseMaxDepthError(-1, 0);
  expect(error.maxDepth).toBe(-1);
  expect(error.estimatedDepth).toBe(0);
});

it('validates malformed options before native work, even for a deeply nested source', () => {
  const source = 'echo $('.repeat(400) + 'echo ok' + ')'.repeat(400);
  // JavaScript callers can supply values outside the TypeScript option shape.
  expect(() => {
    Reflect.apply(parseSync, undefined, [source, { KeepComments: 'yes' }]);
  }).toThrow(InputError);
  expect(callSyntax).not.toHaveBeenCalled();
});

it('retains source validation before malformed options and native work', () => {
  const invokeInvalid = (): void => {
    Reflect.apply(parseSync, undefined, ['\ud800', { KeepComments: 'yes' }]);
  };
  expect(invokeInvalid).toThrow(InputError);
  expect(invokeInvalid).toThrow('unpaired UTF-16 surrogate');
  expect(callSyntax).not.toHaveBeenCalled();
});
