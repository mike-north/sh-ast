# sh-ast

[![npm](https://img.shields.io/npm/v/sh-ast)](https://www.npmjs.com/package/sh-ast)
[![CI](https://github.com/mike-north/sh-ast/actions/workflows/ci.yml/badge.svg)](https://github.com/mike-north/sh-ast/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/sh-ast)](./LICENSE)

Parse Bash, POSIX sh, mksh, Bats and Zsh scripts into a typed syntax tree in Node.js, then walk
it, edit it and print it back to shell. `sh-ast` is [mvdan/sh](https://github.com/mvdan/sh), the
parser and printer behind `shfmt`, compiled to WebAssembly: synchronous, with no native addon.

## Install

```sh
npm install sh-ast
```

Requires Node.js 22.14 or newer on the 22 line, or Node.js 24 or newer. ES module, TypeScript types included.

## Quickstart

```ts
import { nodePos, parseSync, printSync, walk } from 'sh-ast';

const file = parseSync('cd /tmp && rm -rf "$DIR"/*.log\n');

walk(file, (node) => {
  if (node?.Type === 'CallExpr') {
    const { Line, Col } = nodePos(node);
    console.log(`${Line}:${Col}`, printSync(node));
  }
  return true; // keep walking
});
// 1:1 cd /tmp
// 1:12 rm -rf "$DIR"/*.log
```

**[Full documentation](./packages/sh-ast/README.md)** covers parsing, walking, editing, printing,
dialects, errors and limits. The [guide](./packages/sh-ast/GUIDE.md) has the detailed contract, and
the [API reference](./docs/index.md) lists every export.

## Repository layout

- [`packages/sh-ast`](./packages/sh-ast): the `sh-ast` npm package (TypeScript).
- [`packages/sh-ast/shim`](./packages/sh-ast/shim): the Go code compiled to WebAssembly.
- [`docs`](./docs): the generated API reference.
- [`design`](./design): design records behind the public behaviour.

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md) to build and test the project. Report vulnerabilities
privately as described in [SECURITY.md](./SECURITY.md), not in public issues.

## License and credits

MIT, see [LICENSE](./LICENSE). `sh-ast` embeds [mvdan/sh](https://github.com/mvdan/sh) by Daniel
Martí (BSD-3-Clause), compiled to WebAssembly, and Go's `wasm_exec.js` (BSD-3-Clause). See
[THIRD_PARTY_NOTICES.md](./packages/sh-ast/THIRD_PARTY_NOTICES.md).
