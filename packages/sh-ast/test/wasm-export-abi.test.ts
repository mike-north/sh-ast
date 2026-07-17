/**
 * Regression test for the WASM shim's exported ABI, covering the same
 * concern the old (pre-linear-memory-ABI) arity guard covered, under the
 * ABI that replaced it.
 *
 * Before the linear-memory ABI switch (see design/ARCHITECTURE.md's
 * "Performance"), `shim/main.go` registered a single variadic `js.FuncOf`
 * global (`__eslint_sh_parse`) that indexed `args[0]`/`args[1]`/`args[2]`
 * unchecked. A wrong-arity call panicked inside Go's WASM scheduler — a
 * panic `wasm_exec.js`'s `Go._resume()` has no matching try/catch for —
 * which permanently wedged the shared, lazily-instantiated WASM instance.
 *
 * The linear-memory ABI (`alloc`/`process`/`free`, each a real WASM export
 * with a fixed i32 signature) structurally eliminates that failure mode:
 * WebAssembly's JS API coerces a missing trailing argument to `0` rather
 * than letting Go index past the end of an arguments array (there is no
 * arguments array — the signature is fixed at the type level), so a
 * wrong-arity call can never reach the args-indexing panic the old guard
 * exists for. This file instead pins the exported ABI shape (catching
 * accidental drift, e.g. a rename or a dropped export on a future shim
 * change) and confirms the analogous robustness property still holds: a
 * malformed call — including one that could only happen via the *old*
 * bug's calling convention, wrong argument count — does not corrupt the
 * instance for later, well-formed calls.
 *
 * This talks to a real, independently instantiated WASM instance (no
 * mocking) because the property under test lives in the compiled Go shim's
 * exported functions, not in TypeScript.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import '../shim/wasm_exec.js';
import type {} from '../src/wasm-globals.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(here, '..', 'shim', 'sh-ast.wasm');

interface RawShimExports {
  mem: WebAssembly.Memory;
  alloc: (size: number) => number;
  free: (ptr: number) => void;
  process: (...args: number[]) => number;
}

function instantiate(): RawShimExports {
  const module = new WebAssembly.Module(fs.readFileSync(wasmPath));
  const go = new Go();
  const instance = new WebAssembly.Instance(module, go.importObject);
  void go.run(instance);
  return instance.exports as unknown as RawShimExports;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeString(exports: RawShimExports, text: string): { ptr: number; len: number } {
  const bytes = encoder.encode(text);
  const ptr = exports.alloc(bytes.length);
  new Uint8Array(exports.mem.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

function readResult(exports: RawShimExports, resultPtr: number): string {
  const memory = new Uint8Array(exports.mem.buffer);
  let end = resultPtr;
  while (memory[end] !== 0) end++;
  const json = decoder.decode(memory.subarray(resultPtr, end));
  exports.free(resultPtr);
  return json;
}

function callProcess(
  exports: RawShimExports,
  text: string,
  dialect: string,
  filename: string,
): string {
  const t = writeString(exports, text);
  const d = writeString(exports, dialect);
  const f = writeString(exports, filename);
  const resultPtr = exports.process(t.ptr, t.len, d.ptr, d.len, f.ptr, f.len);
  exports.free(t.ptr);
  exports.free(d.ptr);
  exports.free(f.ptr);
  return readResult(exports, resultPtr);
}

describe('WASM shim linear-memory ABI', () => {
  it('exports exactly the alloc/process/free/mem contract wasm-instance.ts depends on', () => {
    const exports = instantiate();
    expect(typeof exports.alloc).toBe('function');
    expect(typeof exports.free).toBe('function');
    expect(typeof exports.process).toBe('function');
    expect(exports.mem).toBeInstanceOf(WebAssembly.Memory);
  });

  it('parses successfully through the raw exported ABI end to end', () => {
    const exports = instantiate();
    const raw = callProcess(exports, 'echo hi', 'bash', 'input.sh');
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toMatchObject({ file: { Type: 'File' } });
  });

  it(
    'a wrong-arity process() call (fewer args than the ABI expects) does not throw and does not ' +
      'corrupt the instance for a later, well-formed call — the regression the old arity guard covered',
    () => {
      const exports = instantiate();

      // Deliberately call with only 2 of the 6 expected i32 arguments — the
      // scenario the pre-ABI-switch guard existed for. WebAssembly's JS API
      // coerces the 4 missing trailing arguments to 0 rather than Go
      // indexing past an arguments array (there is no such array anymore),
      // so this must not throw.
      expect(() => exports.process(0, 0)).not.toThrow();

      // The actual regression being guarded against: the instance must not
      // be wedged by the malformed call above.
      const raw = callProcess(exports, 'echo hi', 'bash', 'input.sh');
      const parsed: unknown = JSON.parse(raw);
      expect(parsed).toMatchObject({ file: { Type: 'File' } });
    },
  );

  it('a zero-argument process() call parses an empty/empty/empty triple as a clean error, not a panic', () => {
    const exports = instantiate();

    // All six arguments coerce to 0: text="" (pointer/length both 0,
    // Go interprets as an empty string, never dereferenced), same for
    // dialect and filename. An empty dialect is not a recognized
    // LangVariant name, so this must surface as a clean error envelope.
    const resultPtr = exports.process();
    const raw = readResult(exports, resultPtr);
    // Shape-checked directly against the JSON string (rather than parsed and
    // matched against an `expect.any(String)` pattern) to avoid asserting on
    // more of the envelope's shape than this test cares about.
    expect(raw).toContain('"error"');
    expect(raw).not.toContain('"file"');
    expect(raw).not.toContain('"parseError"');

    // Confirm the instance still works afterward.
    const after = callProcess(exports, 'echo hi', 'bash', 'input.sh');
    expect(JSON.parse(after)).toMatchObject({ file: { Type: 'File' } });
  });
});
