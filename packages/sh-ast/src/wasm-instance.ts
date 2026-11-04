/** Synchronous singleton WASM ownership and byte-exact syntax protocol transport. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../shim/wasm_exec.js';
// Type-only side-effect import: pulls `wasm-globals.d.ts`'s `declare global`
// augmentation (the `Go` constructor) into any program that includes this
// file, even for tools (e.g. tsd) that compute their own root-file set from
// import graphs rather than directory globbing.
import type {} from './wasm-globals.js';
import { ShInternalError } from './errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// `shim/` is a sibling of both `src/` (test-time) and `dist/` (build-time).
const wasmPath = path.join(here, '..', 'shim', 'sh-ast.wasm');

/**
 * Shared linear-memory primitives and the faithful syntax operation entry point.
 * Each operation owns its input/output buffers until free releases them. The Go
 * wasm/js runtime exports its memory as mem, rather than memory.
 * @internal
 */
interface ShimExports {
  mem: WebAssembly.Memory;
  alloc: (size: number) => number;
  free: (ptr: number) => void;
  /** The lossless syntax protocol uses the same pointer/length calling convention. */
  syntaxProcess?: (
    operationPtr: number,
    operationLen: number,
    payloadPtr: number,
    payloadLen: number,
    optionsPtr: number,
    optionsLen: number,
  ) => number;
}

/** Validates shared memory ownership primitives before any buffer crosses the bridge. */
function isShimExports(value: WebAssembly.Exports): value is WebAssembly.Exports & ShimExports {
  const candidate = value as Partial<ShimExports>;
  return (
    candidate.mem instanceof WebAssembly.Memory &&
    typeof candidate.alloc === 'function' &&
    typeof candidate.free === 'function'
  );
}

let wasmModule: WebAssembly.Module | undefined;
let shimExports: ShimExports | undefined;

/**
 * Instantiates the WASM shim synchronously in Node, exactly once, and
 * reuses the instance across parses and position operations. Node imposes no size limit
 * on synchronous `WebAssembly.Module` compilation — that restriction is
 * browser-main-thread-only.
 */
function ensureInstance(): ShimExports {
  if (shimExports) return shimExports;
  wasmModule ??= new WebAssembly.Module(fs.readFileSync(wasmPath));
  const go = new Go();
  const instance = new WebAssembly.Instance(wasmModule, go.importObject);
  void go.run(instance);
  if (!isShimExports(instance.exports)) {
    throw new ShInternalError(
      'bridge: WASM shim did not export the expected alloc/free/mem linear-memory ABI',
    );
  }
  shimExports = instance.exports;
  return shimExports;
}

/**
 * Reinterprets a raw i32 returned by a WASM export as the unsigned 32-bit
 * linear-memory address it denotes. WebAssembly hands i32 results to JS as
 * signed numbers, so any address at or above 2 GiB would otherwise read as
 * negative and be rejected by typed-array views.
 * @internal
 */
export function toAddress(raw: number): number {
  return raw >>> 0;
}

/**
 * Creates a byte view over linear memory, converting the engine's RangeError
 * for an unusable range into the package's typed internal failure so callers
 * never see a buffer-view error from the bridge.
 */
function viewMemory(memory: WebAssembly.Memory, ptr: number, len?: number): Uint8Array {
  try {
    return len === undefined
      ? new Uint8Array(memory.buffer)
      : new Uint8Array(memory.buffer, ptr, len);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ShInternalError(
        `The syntax bridge could not address WASM linear memory (address ${String(ptr)}, ${String(len ?? 'whole buffer')} bytes); memory may be exhausted: ${error.message}`,
      );
    }
    throw error;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Calls the lossless syntax protocol synchronously with byte-exact payloads.
 * Every returned allocation is released even when a later allocation, exported
 * operation, or response validation fails. Views are recreated after each call
 * because Go allocation can grow and detach linear memory.
 * @internal
 */
export function callSyntax(operation: string, payload: Uint8Array, options = '{}'): string {
  const exports = ensureInstance();
  const process = exports.syntaxProcess;
  if (typeof process !== 'function') {
    throw new ShInternalError(
      'The installed WASM asset does not export the lossless syntax protocol',
    );
  }
  const allocations: number[] = [];
  const write = (bytes: Uint8Array): { ptr: number; len: number } => {
    const ptr = toAddress(exports.alloc(bytes.length));
    allocations.push(ptr);
    if (ptr === 0) throw new ShInternalError('The syntax bridge returned a null input allocation');
    viewMemory(exports.mem, ptr, bytes.length).set(bytes);
    return { ptr, len: bytes.length };
  };
  try {
    const op = write(encoder.encode(operation));
    const input = write(payload);
    const opts = write(encoder.encode(options));
    const result = toAddress(process(op.ptr, op.len, input.ptr, input.len, opts.ptr, opts.len));
    if (result === 0) throw new ShInternalError('The syntax bridge returned a null result');
    allocations.push(result);
    const memory = viewMemory(exports.mem, result);
    if (result >= memory.length)
      throw new ShInternalError('The syntax bridge returned an out-of-bounds result');
    // The native search finds the first NUL exactly as a byte loop would, without
    // interpreting each byte of a megabyte-scale response in JavaScript.
    const end = memory.indexOf(0, result);
    if (end === -1) throw new ShInternalError('The syntax bridge result has no terminator');
    return decoder.decode(memory.subarray(result, end));
  } finally {
    for (const ptr of allocations) exports.free(ptr);
  }
}
