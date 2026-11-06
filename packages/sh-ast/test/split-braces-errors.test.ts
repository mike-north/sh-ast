/** Resource adaptation must not absorb unrelated engine failures or native error families. */
import { beforeEach, expect, it, vi } from 'vitest';
import { ShInternalError } from '../src/errors.js';
import { InputError } from '../src/syntax-errors.js';
import { splitBraces } from '../src/syntax-braces.js';
import type { Word } from '../src/index.js';

const callSyntax = vi.hoisted(() => vi.fn<(...args: unknown[]) => string>());
vi.mock('../src/wasm-instance.js', () => ({ callSyntax }));
const input: Word = { Type: 'Word', Parts: null };

beforeEach(() => {
  callSyntax.mockReset();
});

it('preserves unknown-native-operation InputError rather than calling it stack exhaustion', () => {
  const message = 'unknown syntax operation "split-braces"';
  callSyntax.mockReturnValue(JSON.stringify({ Error: { Kind: 'InputError', Message: message } }));
  expect(() => splitBraces(input)).toThrow(new InputError(message));
});

it('preserves an actual upstream panic response without a fabricated stack cause', () => {
  callSyntax.mockReturnValue(
    JSON.stringify({ Error: { Kind: 'InternalError', Message: 'native panic marker' } }),
  );
  let caught: unknown;
  try {
    splitBraces(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShInternalError);
  if (!(caught instanceof ShInternalError)) {
    throw new Error('Expected native internal failure');
  }
  expect(caught.message).toBe('native panic marker');
  expect(caught.cause).toBeUndefined();
});

it('does not translate an unrelated runtime RangeError from the native call', () => {
  const original = new RangeError('unrelated native memory failure');
  callSyntax.mockImplementation(() => {
    throw original;
  });
  let caught: unknown;
  try {
    splitBraces(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(original);
});

it('does not translate an unrelated RangeError while reading caller data', () => {
  const original = new RangeError('unrelated caller range failure');
  const value: Word = {
    Type: 'Word',
    get Parts(): Word['Parts'] {
      throw original;
    },
  };
  let caught: unknown;
  try {
    splitBraces(value);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(original);
  expect(callSyntax).not.toHaveBeenCalled();
});

it('adapts only actual native transport stack exhaustion and retains its origin', () => {
  const original = new RangeError('Maximum call stack size exceeded');
  callSyntax.mockImplementationOnce(() => {
    throw original;
  });
  let caught: unknown;
  try {
    splitBraces(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShInternalError);
  if (!(caught instanceof ShInternalError)) {
    throw new Error('Expected bridge resource failure');
  }
  expect(caught.message).toContain('native transport');
  expect(caught.cause).toBe(original);
  expect(input.Parts).toBeNull();
  // The adapter preserves failure identity; it does not repair or claim the
  // health of a native VM after an unexpected engine stack trap.
});
