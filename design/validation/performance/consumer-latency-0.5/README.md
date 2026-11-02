# sh-ast 0.5 consumer lint-latency reproduction kit

Measurement scripts and prototype diffs behind the sh-ast 0.5 performance issues
(streaming wire encoder, compact position sidecar, in-place wire decode). Nothing here is
built, tested or shipped; the prototypes are evidence for those issues, not merged code.

## What was measured

sh-ast 0.5.0 (`origin/main` `1301d55`) as consumed by
[eslint-sh](https://github.com/mike-north/eslint-sh) at commit
[`6747c0c`](https://github.com/mike-north/eslint-sh/tree/6747c0c) (`@eslint-sh/eslint-plugin`
0.5.0, which calls `parseWithPositionsSync`). Node 24.14.0, ESLint 10.7.0, darwin/arm64.

Fixture: the eslint-sh M2 benchmark, a generated 701-line, 11,270-byte bash script with 5,801
syntax nodes, linted with `Linter.verify` and no rules. Numbers are medians of 30 warm runs after
5 warm-ups unless stated otherwise.

Headline findings:

- Warm `Linter.verify` regressed from ~44 ms (sh-ast 0.3.1) to ~136–176 ms (0.5.0). About 90% of
  that is the sh-ast bridge, not parsing: mvdan/sh `Parser.Parse` takes ~0.9 ms inside WASM.
- Inside the 0.5.0 `parse-with-positions` WASM call (93.8 ms): `json.Marshal` of the generic
  `map[string]any` envelope 48.6 ms, `positionSnapshots` 24.7 ms, `syntaxwire.Value` 12.5 ms.
  The response is 2.9 MB for an 11 KB script.
- On the JS side: `decodeWire` deep rebuild 25.6 ms (on top of `JSON.parse` 6.6 ms),
  `createPositionSnapshot` 13.0 ms, `isSyntaxFile` 1.8 ms.
- Prototypes, each checked for equivalence against published 0.5.0:

  | Stage                                             | `parseWithPositionsSync` ms | eslint-sh M2 warm median ms |
  | ------------------------------------------------- | --------------------------: | --------------------------- |
  | Published 0.5.0                                   |                     113–145 | 136, 150, 136               |
  | Streaming Go encoder (byte-identical wire output) |                       46–53 | 64, 73, 73                  |
  | + in-place `decodeWire`, path-resolving snapshot  |                       39–48 | 57, 51, 54                  |
  | + fused compact position sidecar                  |             20.3 (min 16.2) | 36, 38, 38                  |

  For reference, 0.3.1 `parseSync` on the same fixture is ~31 ms. A further ~5 ms comes from
  eslint-sh adapter changes tracked in the eslint-sh repository; that prototype is not part of
  this kit.

## Setup

1. eslint-sh at `6747c0c`: `pnpm install --frozen-lockfile`, then
   `NX_SKIP_NX_CACHE=true pnpm --filter @eslint-sh/eslint-plugin run build`.
2. Comparison directory: copy `js/package.json` into an empty directory, then
   `npm install sh-ast-03@npm:sh-ast@0.3.1 sh-ast-05@npm:sh-ast@0.5.0`.
3. Go-side prototypes: export `packages/sh-ast/shim` from this repository at `1301d55`, then either
   apply `go/timing-instrumentation.diff` (phase timers, op `timings`) or add `go/stream.go` and
   apply `go/process.go.stream.diff` (streaming encoder, `legacy-*` ops for byte comparison,
   `parse-with-positions-compact`). Build with
   `GOOS=js GOARCH=wasm go build -buildvcs=false -trimpath -ldflags="-s -w -buildid=" -o sh-ast.wasm .`
   The measurements used Go 1.26.3 with the shim's `go.mod` directive relaxed from `go 1.26.5` to
   `go 1.26`; any real change must use the pinned toolchain and a CI-built WASM.
   Copy the published package with that wasm (and the toolchain's `lib/wasm/wasm_exec.js`) to
   `node_modules/sh-ast-{instr,stream,fast,compact}` in the comparison directory. Apply
   `js/*.dist.diff` to the `-fast` and `-compact` copies.

A local darwin build of the unmodified shim matched the shipped WASM (91.3 vs 91.1 ms), so
comparisons against local builds are fair.

## Files

Run from eslint-sh's `packages/eslint-plugin` unless noted.

- `bench.mjs`: the M2 benchmark (`node --input-type=module < bench.mjs`).
- `attr.mjs`: stage attribution (parse / adapt / `SourceCoordinates` / traverse / verify).
- `inner.mjs`: `parseWithPositionsSync` internals (WASM call, `decodeWire`, validation, snapshot).
- `js/cmp.mjs` (comparison directory): 0.3.1 vs 0.5.0 parser only.
- `js/gosplit.mjs sh-ast-instr` (comparison directory): Go-side phase split.
- `js/bytes.mjs`: wire payload composition and sidecar order.
- `js/stream-check.mjs`: byte identity of the streaming encoder against the `legacy-*` ops, plus
  timing.
- `js/fast-check.mjs`, `js/compact-check.mjs`: semantic equivalence against published 0.5.0, plus
  timing.
- `js/compact.mjs`: decoder for the compact position sidecar.
- `go/stream.go`, `go/process.go.stream.diff`: streaming encoder prototype
  (`streamParseCompact` and `observe` produce the compact sidecar).
- `go/timing-instrumentation.diff`: Go phase timers.
- `js/in-place-decode-and-path-resolve.dist.diff`, `js/compact-sidecar.dist.diff`: JS prototypes,
  applied to the 0.5.0 `dist/`.
- Full pipeline with a prototype parser:
  `SH_AST_OVERRIDE=<prototype package dir> node --import ./register.mjs --input-type=module < bench.mjs`
  (`register.mjs` / `loader.mjs` redirect the `sh-ast` specifier).
- `diff-adapter.mjs`, `register2.mjs`, `loader2.mjs`: differential check of eslint-sh's adapter
  against a modified adapter. Copy the baseline `src/language/*.ts` into `<dir>/oldsrc/`, build
  the modified adapter, then run
  `ADAPTER_BASELINE_DIR=<dir> SH_AST_DIR=$PWD/node_modules/sh-ast node --import ./register2.mjs --experimental-strip-types diff-adapter.mjs`.
- `profsum.mjs <file.cpuprofile> [N]`: self-time summary of a `node --cpu-prof` run.
