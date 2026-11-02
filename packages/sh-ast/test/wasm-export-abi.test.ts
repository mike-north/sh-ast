/**
 * The faithful linear-memory ABI uses fixed pointer/length pairs for operation,
 * payload and options. Incorrect argument counts must return a bounded failure
 * without wedging the instance. A separately instantiated real WASM module
 * supplies the evidence, independent of the TypeScript wrapper.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import '../shim/wasm_exec.js';
import type {} from '../src/wasm-globals.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(here, '..', 'shim', 'sh-ast.wasm');

/** The ABI subset exercised directly, with variadic arguments to test missing pairs. */
interface RawShimExports {
  mem: WebAssembly.Memory;
  alloc: (size: number) => number;
  free: (ptr: number) => void;
  syntaxProcess: (...args: number[]) => number;
}

/** Starts an independent Go runtime so shared wrapper state cannot hide ABI failures. */
function instantiate(): RawShimExports {
  const module = new WebAssembly.Module(fs.readFileSync(wasmPath));
  const go = new Go();
  const instance = new WebAssembly.Instance(module, go.importObject);
  void go.run(instance);
  return instance.exports as unknown as RawShimExports;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Pins exact UTF-8 argument bytes until the caller releases their allocation. */
function writeString(exports: RawShimExports, text: string): { ptr: number; len: number } {
  const bytes = encoder.encode(text);
  const ptr = exports.alloc(bytes.length);
  new Uint8Array(exports.mem.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

/** Copies a NUL-terminated response before releasing the Go allocation. */
function readResult(exports: RawShimExports, resultPtr: number): string {
  const memory = new Uint8Array(exports.mem.buffer);
  let end = resultPtr;
  while (memory[end] !== 0) end++;
  const json = decoder.decode(memory.subarray(resultPtr, end));
  exports.free(resultPtr);
  return json;
}

/** Invokes operation/source/options as three ABI pointer-length pairs. */
function callSyntaxProcess(
  exports: RawShimExports,
  text: string,
  operation: string,
  options: string,
): string {
  const t = writeString(exports, text);
  const d = writeString(exports, operation);
  const f = writeString(exports, options);
  const resultPtr = exports.syntaxProcess(d.ptr, d.len, t.ptr, t.len, f.ptr, f.len);
  exports.free(t.ptr);
  exports.free(d.ptr);
  exports.free(f.ptr);
  return readResult(exports, resultPtr);
}

describe('WASM shim linear-memory ABI', () => {
  it('exports the alloc/syntaxProcess/free/mem contract wasm-instance.ts depends on', () => {
    const exports = instantiate();
    expect(typeof exports.alloc).toBe('function');
    expect(typeof exports.free).toBe('function');
    expect(typeof exports.syntaxProcess).toBe('function');
    expect(exports.mem).toBeInstanceOf(WebAssembly.Memory);
  });

  it('parses successfully through the raw exported ABI end to end', () => {
    const exports = instantiate();
    const raw = callSyntaxProcess(exports, 'echo hi', 'parse', '{"Filename":"input.sh"}');
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toMatchObject({ File: { Type: 'File' } });
  });

  it(
    'a wrong-arity syntaxProcess() call (fewer args than the ABI expects) does not throw and does not ' +
      'corrupt the instance for a later, well-formed call — the regression the old arity guard covered',
    () => {
      const exports = instantiate();

      // Deliberately call with only 2 of the 6 expected i32 arguments — the
      // scenario the pre-ABI-switch guard existed for. WebAssembly's JS API
      // coerces the 4 missing trailing arguments to 0 rather than Go
      // indexing past an arguments array (there is no such array anymore),
      // so this must not throw.
      expect(() => {
        const result = exports.syntaxProcess(0, 0);
        readResult(exports, result);
      }).not.toThrow();

      // The actual regression being guarded against: the instance must not
      // be wedged by the malformed call above.
      const raw = callSyntaxProcess(exports, 'echo hi', 'parse', '{"Filename":"input.sh"}');
      const parsed: unknown = JSON.parse(raw);
      expect(parsed).toMatchObject({ File: { Type: 'File' } });
    },
  );

  it('a zero-argument syntaxProcess() call parses an empty/empty/empty triple as a clean error, not a panic', () => {
    const exports = instantiate();

    // All six arguments coerce to 0: text="" (pointer/length both 0,
    // Go interprets as an empty string, never dereferenced), same for
    // operation and options. An empty operation is unsupported, so it must
    // surface as a clean error envelope.
    const resultPtr = exports.syntaxProcess();
    const raw = readResult(exports, resultPtr);
    // Shape-checked directly against the JSON string (rather than parsed and
    // matched against an `expect.any(String)` pattern) to avoid asserting on
    // more of the envelope's shape than this test cares about.
    expect(raw).toContain('"Error"');
    expect(raw).not.toContain('"File"');
    expect(raw).not.toContain('"ParseError"');

    // Confirm the instance still works afterward.
    const after = callSyntaxProcess(exports, 'echo hi', 'parse', '{"Filename":"input.sh"}');
    expect(JSON.parse(after)).toMatchObject({ File: { Type: 'File' } });
  });
});
