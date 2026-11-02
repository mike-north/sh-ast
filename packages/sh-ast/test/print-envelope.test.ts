/** Printing boundary failures must never become successful text or ordinary upstream errors. */
import { expect, it, vi } from 'vitest';
import type { File } from '../generated/syntax-types.js';
import { InputError } from '../src/syntax-errors.js';
import { ShInternalError } from '../src/errors.js';
import { printSync } from '../src/syntax-print.js';
import { PrintError, PrintPanicError } from '../src/syntax-print-errors.js';

const callSyntax = vi.hoisted(() => vi.fn<(...args: unknown[]) => string>());
vi.mock('../src/wasm-instance.js', () => ({ callSyntax }));
const empty: File = { Type: 'File', Name: '', Stmts: null, Last: null };

it.each([
  '[]',
  'null',
  '42',
  '{',
  '{}',
  '{"Output":null}',
  '{"Output":42}',
  '{"Output":{"Bytes":"!"}}',
  '{"Error":null}',
  '{"Error":{}}',
  '{"Error":{"Kind":"PrintError","Message":0}}',
  '{"Error":{"Kind":"Unknown","Message":"bad"}}',
])('rejects malformed response %s', (response) => {
  callSyntax.mockReturnValueOnce(response);
  expect(() => printSync(empty)).toThrow(ShInternalError);
});
it.each([
  ['PrintError', PrintError],
  ['PrintPanicError', PrintPanicError],
  ['InputError', InputError],
  ['InternalError', ShInternalError],
] as const)('retains the %s failure family', (Kind, Failure) => {
  callSyntax.mockReturnValueOnce(JSON.stringify({ Error: { Kind, Message: { Bytes: '/g==' } } }));
  expect(() => printSync(empty)).toThrow(Failure);
});
it('encodes bigint without rounding and keeps malformed-byte output', () => {
  callSyntax.mockReturnValueOnce('{"Output":{"Bytes":"eP4="}}');
  expect(printSync(empty, { Indent: 9007199254740993n })).toEqual(new Uint8Array([0x78, 0xfe]));
  expect(callSyntax).toHaveBeenLastCalledWith(
    'print',
    expect.any(Uint8Array),
    '{"Indent":{"Int":"9007199254740993"}}',
  );
});
it.each([
  null,
  [],
  { Unknown: true },
  { Minify: 'yes' },
  { KeepPadding: null },
  { Indent: undefined },
])('rejects malformed options before transport: %j', (options) => {
  callSyntax.mockClear();
  // Runtime callers are not constrained by TypeScript's option declaration.
  expect(() => {
    Reflect.apply(printSync, undefined, [empty, options]);
  }).toThrow(InputError);
  expect(callSyntax).not.toHaveBeenCalled();
});
it.each([
  null,
  [],
  { Type: 'File' },
  { Type: 'Slice', Offset: null, Length: null },
  { Type: 'TypedNil', Kind: 'Missing' },
])('rejects malformed node before transport: %j', (node) => {
  callSyntax.mockClear();
  expect(() => {
    Reflect.apply(printSync, undefined, [node]);
  }).toThrow(InputError);
  expect(callSyntax).not.toHaveBeenCalled();
});
it('rejects cycles and unpaired surrogates without transporting partial data', () => {
  const cyclic: File = { ...empty };
  Object.assign(cyclic, { Stmts: [cyclic] });
  callSyntax.mockClear();
  expect(() => printSync(cyclic)).toThrow(InputError);
  expect(() => printSync({ ...empty, Name: '\ud800' })).toThrow(InputError);
  expect(callSyntax).not.toHaveBeenCalled();
});
