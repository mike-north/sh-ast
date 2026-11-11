# Contributing to sh-ast

Thank you for helping. `sh-ast` is a faithful, synchronous TypeScript binding, through
WebAssembly, of the shell syntax package in a maintained Go fork of
[mvdan/sh](https://github.com/mvdan/sh). It parses, traverses, and prints shell syntax; it
does not interpret what a script does. [AGENTS.md](AGENTS.md) describes what this package
is and is not responsible for, and applies to human and automated contributors alike.
Report security vulnerabilities as described in [SECURITY.md](SECURITY.md), not in a
public issue.

## Propose a change

Open an issue before starting anything non-trivial (new API, behavior change, a fix that
touches the Go shim or fork). Small fixes, documentation corrections, and tests can go
straight to a pull request. If the fix belongs in the grammar or lexer, it lands in the Go
fork and reaches this repository through a pinned revision; see
[AGENTS.md](AGENTS.md#fixing-go-behavior-belongs-in-the-go-fork).

## Set up

You need Node 22.14 or later, or Node 24 or later (`.nvmrc` pins the development version), pnpm 11 (`corepack enable` picks the pinned version), and
the Go version pinned in `packages/sh-ast/shim/go.mod`.

```sh
pnpm install
pnpm build
pnpm check   # format, lint, types, API report and docs, release checks
pnpm test    # runtime and type tests
```

Run all four before pushing. `pnpm run fix:format` repairs formatting, and
`pnpm run clean` removes build outputs.

## The committed WASM binary

`packages/sh-ast/shim/sh-ast.wasm` is the linux/amd64 build produced by CI. A WASM built on
macOS or arm64 will not match it byte for byte, which is expected. Do not commit a locally
built binary. Local builds are fine for experiments.

## Rebuilding the WASM shim

The canonical binary is built by Linux/amd64 CI with the Go toolchain pinned in
`packages/sh-ast/shim/go.mod` and the checksum-pinned Binaryen version in
`.github/workflows/wasm-reproducibility.yml`. Pinning matters: a different `wasm-opt`
version can produce a different, still-correct optimization, which would break the
byte-for-byte comparison.

From `packages/sh-ast/shim`:

```sh
GOOS=js GOARCH=wasm go build -buildvcs=false -trimpath -ldflags="-s -w -buildid=" -o /tmp/sh-ast.rebuilt.wasm .
wasm-opt -Oz --enable-bulk-memory-opt --enable-nontrapping-float-to-int /tmp/sh-ast.rebuilt.wasm -o sh-ast.wasm
```

To update the committed binary after a shim or Go-source change:

1. Push the change. The `wasm-reproducibility` workflow rebuilds on Linux and uploads the
   result as the `sh-ast-linux-amd64-wasm` artifact, even when the committed binary is
   stale (the comparison step then fails, which is expected).
2. A maintainer downloads that artifact, commits it as `packages/sh-ast/shim/sh-ast.wasm`,
   and pushes. The workflow reruns and must find a fresh rebuild byte-identical to the
   committed file.

Before either build, `node tools/verify-go-source.mjs` verifies both effective Go module
graphs (the shim and the schema generator) against the recorded fork revision and
checksum pins; a local `replace` or external Go workspace cannot substitute a different
implementation. Changing a pin requires a separately downloaded and reviewed source.

## Regenerating the syntax schema

Faithful declarations, constants, and field metadata live in
`packages/sh-ast/generated/syntax-*` and are produced from the pinned Go struct
definitions. After changing the matching pins in `packages/sh-ast/shim/go.mod` and
`tools/gen-visitor-keys/go.mod`, run:

```sh
pnpm run generate:sh-ast-schema
```

Regeneration alone only detects drift. Fidelity is checked by independent Go reflection
tests, hand-derived type assertions, and runtime fixtures.

## Public API and generated docs

If you change the public surface, regenerate and commit the API report
(`pnpm --filter sh-ast run fix:api-report`) and the generated docs (`pnpm build:docs`). CI
fails when either is out of date.

## Tests

Write the test first, and derive its expected value from something independent of the code
under test: the pinned Go revision, real shell behavior, or a hand-derived value. Bug fixes
include a regression test that fails without the fix. Anything touching positions or ranges
needs multibyte fixtures.

## Changesets and releases

A change to the published package's behavior or types needs a changeset:

```sh
pnpm changeset
```

Pick `patch` for fixes and `minor` for observable syntax or binding changes. The project
stays on 0.x until the maintainer declares the shape stable. Releases are cut by the
release workflow; do not edit the generated "Version Packages" pull request.

## Pull requests

- Describe what changed and why, and link the issue with `Refs #N`.
- List the acceptance criteria and the test that covers each.
- Every pull request needs an approving code review before it can be merged. Reply to each
  review comment; the reviewer resolves the thread.
- Keep generated documentation changes in their own commit when they are large.
