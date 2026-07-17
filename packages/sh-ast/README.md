# sh-ast

A synchronous, fully-typed shell AST for JavaScript and TypeScript. `sh-ast` parses shell scripts
(bash, POSIX sh, mksh, zsh, and bats) using [mvdan/sh](https://github.com/mvdan/sh) — the Go
shell parser used by `shfmt` and `shellcheck`-adjacent tooling — via a small Go/WASM shim, and
normalizes the result into a plain-object AST with UTF-16-safe positions that's natural to
consume from JS/TS (linters, formatters, codemods, static analysis, or anything else that needs
to understand shell source structurally).

```ts
import { parseSync } from 'sh-ast';

const file = parseSync('echo hi');
file.stmts[0].cmd.type; // "CallExpr"
```

## Provenance

`sh-ast` was extracted from [`eslint-sh`](https://github.com/mike-north/eslint-sh) (as
`@eslint-sh/bridge`) at commit
[`bdd55b3`](https://github.com/mike-north/eslint-sh/commit/bdd55b3), where it was built as the
parser core underneath an ESLint plugin for shell scripts. The full commit history predating the
extraction lives in that repository. This package carries no ESLint dependency and exposes the
same public API `@eslint-sh/bridge` did.

## Status

The visitor-keys and child-type-schema tables, plus the `ShNodes.*` TypeScript typings, are
generated from mvdan/sh's `syntax` package struct definitions by `tools/gen-visitor-keys` — see
that tool's README for "The schema table is generated, not hand-written".

## Public API

- `parseSync(text, options?)` — synchronous parse; throws `ShParseError` (with `.line`,
  `.column`, `.filename`) on a shell syntax error.
- `ParseOptions` — `{ dialect?, filename? }`; `dialect` is one of `bash | posix | mksh | bats |
zsh`, mapped to mvdan/sh's `LangVariant` by string name.
- `ShNode` / `ShFile` — normalized node shape (`type`, `range`, `loc`, plus lowercased fields
  from mvdan/sh's tree).
- `ShNodes` — generated, strongly-typed `ShNode` subtypes for every mvdan/sh node type (e.g.
  `ShNodes.ShCallExprNode`, `ShNodes.ShDeclClauseNode`), plus union aliases (`ShAnyNode`,
  `ShCommandNode`, `ShWordPartNode`, …). Additive and optional — `ShNode`'s index signature
  remains the base contract.
- `visitorKeys` — generated node-type → child-field-name table.
- `walk(node, visit)` — visits every node in a normalized tree; discovers children structurally
  rather than depending on `visitorKeys`.

## Regenerating the schema tables

After bumping the pinned mvdan/sh version (`shim/go.mod` _and_ `../../tools/gen-visitor-keys/go.mod`
must move together):

```sh
pnpm run generate:sh-ast-schema
```

This regenerates `generated/visitor-keys.js(.d.ts)`, `generated/child-type-schema.js(.d.ts)`, and
`generated/node-types.d.ts`, then formats them with Prettier. CI
(`.github/workflows/gen-visitor-keys.yml`) reruns the same script and fails the build if the
committed artifacts don't come back byte-identical — the drift gate for future mvdan/sh bumps.
Re-run the kitchen-sink golden test (`test/kitchen-sink.test.ts`) afterward; it fails if the new
mvdan/sh version adds a node type the fixtures don't yet exercise.

## The WASM shim

`shim/main.go` parses with `mvdan.cc/sh/v3/syntax` and encodes the result with
`shim/internal/nodeencode` — a performance fork of `mvdan.cc/sh/v3/syntax/typedjson`'s encode
path (see that package's doc comment for why: typedjson's reflection-based encoder rebuilds an
identical synthetic struct type per node _instance_ rather than once per node _type_, which
dominated warm-parse latency — see "Performance" below) — so interface-typed nodes (`CallExpr`,
`BinaryCmd`, …) carry a `Type` discriminator, exactly as upstream typedjson does (verified
byte-identical in `shim/internal/nodeencode/encode_test.go`). The whole result envelope —
including any error message — is marshaled with Go's `encoding/json`, so JSON-significant bytes
in an error message (e.g. an unclosed-quote message containing `"`) survive the Go→JS boundary
intact.

The shim exposes a linear-memory ABI — `alloc`/`process`/`free` WASM exports plus the `mem`
memory export — instead of a `syscall/js` global function. `wasm-instance.ts` writes UTF-8 bytes
directly into WASM memory and reads the JSON result back with `TextDecoder`, avoiding
`syscall/js`'s much more expensive per-call JS↔Go value marshaling (see "Performance" below).

### Performance

Local measurement (700-line/~9k-node fixture, warm instance, Apple M-series):

| Stage                                 | Before (syscall/js + typedjson) | After (linear memory + nodeencode) |
| ------------------------------------- | ------------------------------: | ---------------------------------: |
| End-to-end warm `parseSync` (p50)     |                          ~97 ms |                             ~29 ms |
| wasm call (parse + encode + transfer) |                          ~91 ms |                           ~23.5 ms |
| `JSON.parse`                          |                           ~3 ms |                              ~3 ms |
| `normalize`                           |                         ~2.5 ms |                            ~2.7 ms |
| `sh-ast.wasm` size                    |                        ~4.10 MB |                           ~3.82 MB |

The dominant fix was **not** the transport switch alone — profiling found `typedjson.Encode`'s
`reflect.StructOf` call (rebuilding an identical synthetic struct type once per node _instance_)
responsible for ~80ms of the ~90ms wasm call; `nodeencode`'s per-_type_ cache cut that to ~14ms.
The linear-memory ABI switch and a hand-rolled envelope wrap (skipping a redundant
`encoding/json.Marshal` re-compaction of the already-encoded AST bytes) account for the rest.

**TinyGo**, evaluated for its ~4x smaller runtime, cannot run this shim: it compiles
`reflect.StructOf` calls without error but panics at runtime with `unimplemented:
reflect.StructOf()` the moment `nodeencode`/`typedjson`'s encoder runs (confirmed against
TinyGo 0.41.1). Standard Go + `wasm-opt -Oz` (binaryen, pinned in CI) is the fallback:
`sh-ast.wasm` is optimized after every build, for a ~7% size reduction (~4.09 MB → ~3.82 MB) with
no behavior change. Neither path reaches a 1.5 MB stretch target.

After editing `shim/main.go` or `shim/internal/nodeencode`, rebuild the committed
`shim/sh-ast.wasm`:

```sh
cd shim
GOOS=js GOARCH=wasm go build -buildvcs=false -trimpath -ldflags="-s -w -buildid=" -o sh-ast.wasm .
wasm-opt -Oz --enable-bulk-memory-opt --enable-nontrapping-float-to-int sh-ast.wasm -o sh-ast.wasm
```

`wasm-opt` ships with [binaryen](https://github.com/WebAssembly/binaryen/releases) — CI installs
a pinned release (see `.github/workflows/wasm-reproducibility.yml`'s `BINARYEN_VERSION`); install
the same version locally (`brew install binaryen`, or download the pinned release directly) so
your rebuild matches CI byte-for-byte. `--enable-bulk-memory-opt` and
`--enable-nontrapping-float-to-int` tell `wasm-opt` to accept the two WASM proposal features
Go's `js/wasm` target already emits (both broadly supported in Node and browsers since ~2020) —
without them, `wasm-opt` rejects the input as invalid.

The `-buildid=` flag blanks out Go's build-ID metadata (used only by the Go toolchain's own
build cache, never read at runtime); without it, `-trimpath` alone is not enough for a
byte-identical rebuild — the embedded build ID otherwise varies between build-cache states even
with identical source and dependencies.

`-buildvcs=false` is equally required: Go 1.18+ stamps binaries with `vcs.revision`/`vcs.time`/
`vcs.modified` by default (`-buildvcs=auto`), reading whatever commit and dirty-state the
checkout happens to be in at build time. That stamp isn't touched by `-s -w` (it lives outside
the symbol table/DWARF that those flags strip), so two builds of _identical source_ differ
whenever the checkout's commit or dirty-state differs — which is exactly what happens for a
`pull_request`-triggered CI run (GitHub synthesizes a fresh merge commit, with its own SHA and
timestamp, on every run) versus a `push`-triggered run (checks out the named branch commit
as-is), and equally for a local checkout with any uncommitted changes elsewhere in the working
tree. `-buildvcs=false` removes this source of non-determinism entirely; verified byte-for-byte
identical across a native macOS/arm64 build, a `linux/amd64` build under Docker/QEMU emulation,
and real `ubuntu-latest` CI runs triggered via `push`, `pull_request`, and `workflow_dispatch`.

`wasm-opt -Oz` is a deterministic, version-pinned transform: rebuilding twice (Go build +
wasm-opt) produces byte-identical output, verified locally and by CI's `rebuild-match` job.

CI rebuilds the shim with a pinned Go toolchain (`shim/go.mod`) and a pinned `wasm-opt`
(`.github/workflows/wasm-reproducibility.yml`), and fails if the output differs from the
committed artifact. It also runs `shim/internal/nodeencode`'s Go test suite, which asserts the
fork's output is byte-identical to upstream `typedjson.Encode`.
