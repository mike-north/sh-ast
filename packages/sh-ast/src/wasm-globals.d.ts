// Ambient declarations for the vendored Go WASM runtime glue at
// `../shim/wasm_exec.js` (copied verbatim from `go env GOROOT`/lib/wasm/).
// It is a plain script with no ES module exports: importing it for its side
// effects attaches `globalThis.Go`. `packages/bridge/shim/main.go` exposes
// its parse entry point as linear-memory WASM exports (`alloc`/`process`/
// `free`/`mem`) read off `instance.exports` directly — see
// `wasm-instance.ts`'s `ShimExports` — rather than a `globalThis` global.

declare module '*/shim/wasm_exec.js';

declare global {
  /** Minimal shape of the runtime instance created by `new Go()`. */
  interface GoWasmRuntime {
    importObject: WebAssembly.Imports;
    run: (instance: WebAssembly.Instance) => Promise<void>;
    exited: boolean;
  }

  /** Constructor for the vendored runtime, attached as `globalThis.Go`. */
  type GoConstructor = new () => GoWasmRuntime;

  var Go: GoConstructor;
}

export {};
