/**
 * Allocation ownership is tested through the production callSyntax helper.
 * Controlled exports supply failures at the WASM boundary; the test ledger is
 * independent of the helper's bookkeeping and rejects duplicate releases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Reading/instantiating a real module would prevent precise allocation fault injection. */
vi.mock('node:fs', () => ({ default: { readFileSync: () => new Uint8Array() } }));
vi.mock('../shim/wasm_exec.js', () => ({}));

/** Real linear memory preserves view detachment behavior when a WASM allocation grows it. */
const NativeMemory = WebAssembly.Memory;
/** Fault sites represent independent ownership obligations, not parser grammar failures. */
type Outcome =
  'allocation-throws' | 'process-throws' | 'null' | 'out-of-bounds' | 'unterminated' | 'normal';
/** A response and payload with non-ASCII/non-Unicode bytes expose accidental string transport. */
const response = '{"Value":"🎉"}';
const payload = new Uint8Array([0xff, 0x00, 0x61]);
const options = '{"KeepComments":true}';

/**
 * Supplies instrumented ABI exports while leaving callSyntax itself untouched.
 * Each returned nonzero handle enters the ownership ledger, including malformed
 * result addresses; free must remove each handle exactly once before reuse.
 */
function controlledShim(initialOutcome: Outcome) {
  let outcome = initialOutcome;
  let nextInput = 64;
  const mem = new NativeMemory({ initial: 1 });
  const outstanding = new Set<number>();
  const allocated: number[] = [];
  const released: number[] = [];
  const requests: { operation: string; payload: Uint8Array; options: string }[] = [];
  const allocationFailure = new Error('controlled allocation failure');
  const processFailure = new Error('controlled process failure');
  const moduleCreated = vi.fn();
  const instanceCreated = vi.fn();
  const run = vi.fn(() => Promise.resolve());

  /** Records ownership only after the simulated export has successfully returned a handle. */
  function own(pointer: number): number {
    if (outstanding.has(pointer)) throw new Error('fixture reused an outstanding allocation');
    outstanding.add(pointer);
    allocated.push(pointer);
    return pointer;
  }

  const alloc = vi.fn((_size: number): number => {
    if (outcome === 'allocation-throws' && allocated.length === 1) throw allocationFailure;
    // Detach the first input view, so the next input write must use current memory.
    if (allocated.length === 1) mem.grow(1);
    const pointer = nextInput;
    nextInput += 64;
    return own(pointer);
  });
  const free = vi.fn((pointer: number): void => {
    // The Go shim permits free(0); it does not release an owned allocation.
    if (pointer === 0) return;
    if (!outstanding.delete(pointer))
      throw new Error(`released unowned pointer ${String(pointer)}`);
    released.push(pointer);
  });
  const syntaxProcess = vi.fn(
    (
      operationPtr: number,
      operationLen: number,
      payloadPtr: number,
      payloadLen: number,
      optionsPtr: number,
      optionsLen: number,
    ): number => {
      const decoder = new TextDecoder();
      requests.push({
        operation: decoder.decode(new Uint8Array(mem.buffer, operationPtr, operationLen)),
        payload: new Uint8Array(mem.buffer, payloadPtr, payloadLen).slice(),
        options: decoder.decode(new Uint8Array(mem.buffer, optionsPtr, optionsLen)),
      });
      if (outcome === 'process-throws') throw processFailure;
      if (outcome === 'null') return 0;
      if (outcome === 'out-of-bounds') return own(mem.buffer.byteLength + 64);
      // Detach all input views before the helper reads the result allocation.
      mem.grow(1);
      const pointer = own(4096);
      const bytes = new Uint8Array(mem.buffer);
      if (outcome === 'unterminated') {
        bytes.fill(0x78, pointer);
      } else {
        const encoded = new TextEncoder().encode(response);
        bytes.set(encoded, pointer);
        bytes[pointer + encoded.length] = 0;
      }
      return pointer;
    },
  );
  const exports = { mem, alloc, free, syntaxProcess };

  /** Constructor stand-ins expose only the boundary consumed by the production helper. */
  class ControlledModule {
    constructor(readonly bytes: Uint8Array) {
      moduleCreated(bytes);
    }
  }
  /** Exposes the controlled ABI without executing an actual module. */
  class ControlledInstance {
    readonly exports = exports;
    constructor(module: unknown, imports: unknown) {
      instanceCreated(module, imports);
    }
  }
  /** Keeps runtime startup observable without a Go scheduler or event loop. */
  class ControlledGo {
    readonly importObject = {};
    readonly run = run;
  }
  vi.stubGlobal('WebAssembly', {
    Memory: NativeMemory,
    Module: ControlledModule,
    Instance: ControlledInstance,
  });
  vi.stubGlobal('Go', ControlledGo);

  return {
    allocated,
    released,
    outstanding,
    requests,
    alloc,
    free,
    syntaxProcess,
    allocationFailure,
    processFailure,
    moduleCreated,
    instanceCreated,
    run,
    /** Lets the next request exercise healthy reuse of the same initialized instance. */
    recover(): void {
      outcome = 'normal';
    },
  };
}

/** Verifies exact release counts without imposing an irrelevant deallocation order. */
function expectReleased(shim: ReturnType<typeof controlledShim>): void {
  expect(shim.outstanding.size).toBe(0);
  expect([...shim.released].sort((a, b) => a - b)).toEqual(
    [...shim.allocated].sort((a, b) => a - b),
  );
  expect(shim.released).toHaveLength(shim.allocated.length);
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callSyntax allocation ownership', () => {
  it.each([
    ['allocation-throws', 'controlled allocation failure', 1],
    ['process-throws', 'controlled process failure', 3],
    ['null', 'null result', 3],
    ['out-of-bounds', 'out-of-bounds result', 4],
    ['unterminated', 'no terminator', 4],
  ] as const)(
    'releases owned buffers after %s and remains usable',
    async (outcome, message, count) => {
      const shim = controlledShim(outcome);
      const { callSyntax } = await import('../src/wasm-instance.js');
      expect(() => callSyntax('parse', payload, options)).toThrow(message);
      expect(shim.allocated).toHaveLength(count);
      expectReleased(shim);
      if (outcome === 'allocation-throws') expect(shim.syntaxProcess).not.toHaveBeenCalled();

      shim.recover();
      expect(callSyntax('parse', payload, options)).toBe(response);
      expect(shim.allocated).toHaveLength(count + 4);
      expectReleased(shim);
      expect(shim.requests.at(-1)).toEqual({ operation: 'parse', payload, options });
      expect(shim.moduleCreated).toHaveBeenCalledTimes(1);
      expect(shim.instanceCreated).toHaveBeenCalledTimes(1);
      expect(shim.run).toHaveBeenCalledTimes(1);
    },
  );

  it('copies exact input/result bytes across memory growth and releases a successful response once', async () => {
    const shim = controlledShim('normal');
    const { callSyntax } = await import('../src/wasm-instance.js');
    expect(callSyntax('parse', payload, options)).toBe(response);
    expect(shim.requests).toEqual([{ operation: 'parse', payload, options }]);
    expect(shim.allocated).toHaveLength(4);
    expectReleased(shim);
    expect(callSyntax('parse', payload, options)).toBe(response);
    expect(shim.allocated).toHaveLength(8);
    expectReleased(shim);
    expect(shim.instanceCreated).toHaveBeenCalledTimes(1);
  });
});
