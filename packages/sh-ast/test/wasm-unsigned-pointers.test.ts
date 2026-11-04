/**
 * WebAssembly i32 results reach JS as signed numbers; addresses at or above
 * 2 GiB must be read back as unsigned. The first group pins the conversion with
 * hand-computed values; the second drives callSyntax end to end against real
 * linear memory larger than 2 GiB with exports that return signed i32 values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({ default: { readFileSync: () => new Uint8Array() } }));
vi.mock('../shim/wasm_exec.js', () => ({}));

const NativeMemory = WebAssembly.Memory;
const PAGE = 65536;
const TWO_GIB = 0x80000000;

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toAddress', () => {
  it.each([
    [0, 0],
    [64, 64],
    [0x7fffffff, 0x7fffffff],
    [-2147483648, 0x80000000],
    [-1459617792, 2835349504],
    [-1, 0xffffffff],
  ])('reads signed i32 %i as unsigned %i', async (raw, expected) => {
    const { toAddress } = await import('../src/wasm-instance.js');
    expect(toAddress(raw)).toBe(expected);
  });
});

/** Installs exports whose pointers sit above 2 GiB, returned as signed i32 like a real engine. */
function highShim(options: { memoryPages: number; resultAt: number }) {
  const mem = new NativeMemory({ initial: options.memoryPages });
  const bytes = new Uint8Array(mem.buffer);
  const freed: number[] = [];
  let next = TWO_GIB + 4096;
  const response = '{"ok":"é"}';
  const alloc = vi.fn(() => {
    const ptr = next;
    next += 64;
    return ptr | 0;
  });
  const free = vi.fn((ptr: number) => {
    freed.push(ptr >>> 0);
  });
  const syntaxProcess = vi.fn(
    (opPtr: number, opLen: number, _pp: number, payloadLen: number): number => {
      expect(opPtr).toBe(TWO_GIB + 4096);
      expect(opLen).toBe(5);
      expect(payloadLen).toBe(3);
      const encoded = new TextEncoder().encode(response);
      bytes.set(encoded, options.resultAt);
      bytes[options.resultAt + encoded.length] = 0;
      return options.resultAt | 0;
    },
  );
  /** Compilation is irrelevant: the instance supplies the exports directly. */
  class ControlledModule {
    readonly compiled = true;
  }
  class ControlledInstance {
    readonly exports = { mem, alloc, free, syntaxProcess };
  }
  class ControlledGo {
    readonly importObject = {};
    readonly run = () => Promise.resolve();
  }
  vi.stubGlobal('WebAssembly', {
    Memory: NativeMemory,
    Module: ControlledModule,
    Instance: ControlledInstance,
  });
  vi.stubGlobal('Go', ControlledGo);
  return { freed, response, alloc };
}

describe('callSyntax with linear memory above 2 GiB', () => {
  it('writes inputs, reads the result, and frees every pointer as an unsigned address', async () => {
    const shim = highShim({ memoryPages: (TWO_GIB + 65536 * 4) / PAGE, resultAt: TWO_GIB + 8192 });
    const { callSyntax } = await import('../src/wasm-instance.js');
    expect(callSyntax('parse', new Uint8Array([1, 2, 3]), '{}')).toBe(shim.response);
    expect(shim.freed.sort((a, b) => a - b)).toEqual([
      TWO_GIB + 4096,
      TWO_GIB + 4160,
      TWO_GIB + 4224,
      TWO_GIB + 8192,
    ]);
  });

  it('reports an address beyond memory as a typed internal error, not a RangeError', async () => {
    highShim({ memoryPages: 1, resultAt: 0 });
    const { callSyntax } = await import('../src/wasm-instance.js');
    const { ShInternalError } = await import('../src/errors.js');
    let caught: unknown;
    try {
      callSyntax('parse', new Uint8Array([1, 2, 3]), '{}');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ShInternalError);
    expect(caught).not.toBeInstanceOf(RangeError);
  });
});
