# sh-ast

[![npm](https://img.shields.io/npm/v/sh-ast)](https://www.npmjs.com/package/sh-ast)
[![CI](https://github.com/mike-north/sh-ast/actions/workflows/ci.yml/badge.svg)](https://github.com/mike-north/sh-ast/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/sh-ast)](https://github.com/mike-north/sh-ast/blob/main/LICENSE)

Parse shell scripts into a typed syntax tree in Node.js, then walk it, edit it and print it back
to shell. Build linters, codemods and tools that need to know exactly what a script runs.

`sh-ast` is [mvdan/sh](https://github.com/mvdan/sh), the parser and printer behind `shfmt`,
compiled to WebAssembly. It is synchronous, needs no native addon, and understands the syntax of
Bash, POSIX sh, mksh, Bats and Zsh. Unlike regular expressions, it understands quoting, heredocs
and nesting. Unlike ShellCheck, it hands you the tree so you can write your own checks. Unlike
tree-sitter-bash, it covers more than Bash and prints edited trees back to shell.

## Install

```sh
npm install sh-ast
```

Requires Node.js 22.14 or newer on the 22 line, or Node.js 24 or newer. The package is an
ES module with TypeScript types included;
CommonJS code can load it with `require('sh-ast')`.

## Quickstart

List every command in a script with its position:

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

## Parse

`parseSync(source, options?)` takes a string or a `Uint8Array` of UTF-8 bytes and returns a
`File`. Every node has a `Type` field, so TypeScript narrows it for you. Field names match
mvdan/sh's Go `syntax` package (`Stmts`, `Cmd`, `Args`, `Parts`, ...).

Comments are dropped unless you ask for them. Syntax errors throw `ParseError` with a position;
syntax that the chosen dialect does not allow throws `LangError`.

```ts
import { LangError, LangPOSIX, ParseError, parseSync } from 'sh-ast';

const file = parseSync('# build\nmake all\n', { KeepComments: true });
console.log(JSON.stringify(file.Stmts?.[0]?.Comments?.[0]?.Text)); // " build"

try {
  parseSync('if true; then echo hi\n');
} catch (error) {
  if (error instanceof ParseError) console.log(error.message, error.Pos.Line);
  // 1:1: `if` statement must end with `fi` 1
}

try {
  parseSync('names=(a b c)\n', { Variant: LangPOSIX });
} catch (error) {
  if (error instanceof LangError) console.log(error.message);
  // 1:7: arrays are a bash/mksh/zsh feature; tried parsing as posix
}
```

The other options are `Filename` (used in error messages), `StopAt` and `RecoverErrors`. Need
the original source span of every node, even after you edit the tree? Use
`parseWithPositionsSync`; see the [guide](https://github.com/mike-north/sh-ast/blob/main/packages/sh-ast/GUIDE.md#positions).

## Walk

`walk(node, callback)` visits the tree depth first. The callback gets each node on the way in,
and `null` on the way out. Return `true` to keep going, or `false` to skip a node's children.

```ts
import { parseSync, printSync, walk } from 'sh-ast';

const file = parseSync('greet() { echo "hi $(whoami)"; }\ngreet\n');

walk(file, (node) => {
  if (node === null) return true; // leaving a node
  if (node.Type === 'FuncDecl') {
    console.log('function', node.Name?.Value);
    return false; // skip the function body
  }
  if (node.Type === 'CallExpr') console.log('call', printSync(node));
  return true;
});
// function greet
// call greet
```

The callback must return a boolean. You can edit nodes while walking; the
[guide](https://github.com/mike-north/sh-ast/blob/main/packages/sh-ast/GUIDE.md#editing-during-a-walk)
lists which edits are safe mid-walk.

## Edit

Nodes are plain mutable objects. Change a field, then print the tree:

```ts
import { parseSync, printSync, walk } from 'sh-ast';

const file = parseSync('curl -sSL http://example.com/install.sh | sh\n');

walk(file, (node) => {
  if (node?.Type === 'Lit' && typeof node.Value === 'string') {
    node.Value = node.Value.replace('http://', 'https://');
  }
  return true;
});

console.log(printSync(file));
// curl -sSL https://example.com/install.sh | sh
```

To keep the original, edit a copy made with the standard `structuredClone(file)` (or any
subtree). Editing does not move positions: a node keeps the offsets it had in the source.

## Print

`printSync(node, options?)` prints a `File`, `Stmt`, `Word`, `Assign`, command or word part back
to shell, using `shfmt`'s formatting rules. It formats the tree; it does not replay the original
text.

```ts
import { parseSync, printSync } from 'sh-ast';

const file = parseSync('if [ -f a ]; then\necho yes\nfi\n');

console.log(printSync(file, { Indent: 2 }));
// if [ -f a ]; then
//   echo yes
// fi
```

`Indent: 0` (the default) indents with tabs. Other options match `shfmt`'s flags:
`BinaryNextLine`, `SwitchCaseIndent`, `SpaceRedirects`, `FunctionNextLine`, `SingleLine` and
`Minify`.

## Dialects

Pass `Variant` to choose the shell. The default is `LangBash`.

```ts
import { LangPOSIX, parseSync } from 'sh-ast';

console.log(parseSync('[[ -n $x ]]\n').Stmts?.[0]?.Cmd?.Type); // TestClause
console.log(parseSync('[[ -n $x ]]\n', { Variant: LangPOSIX }).Stmts?.[0]?.Cmd?.Type); // CallExpr
```

| Constant         | Shell    |
| ---------------- | -------- |
| `LangBash`       | Bash     |
| `LangPOSIX`      | POSIX sh |
| `LangMirBSDKorn` | mksh     |
| `LangBats`       | Bats     |
| `LangZsh`        | Zsh      |

### Dialect enforcement

Most dialect-specific syntax is a parse error (`LangError`) in a dialect that does not allow it:

| Construct                  |    bash    |         posix          |    mksh    |    bats    |              zsh               |
| -------------------------- | :--------: | :--------------------: | :--------: | :--------: | :----------------------------: |
| Test clause `[[ ]]`        |   parses   | **parses** (see below) |   parses   |   parses   |             parses             |
| Regex test `[[ a =~ b ]]`  |   parses   |        parses\*        | **error**  |   parses   |             parses             |
| Array literal `a=(1 2 3)`  |   parses   |       **error**        |   parses   |   parses   |             parses             |
| Process substitution `<()` |   parses   |       **error**        | **error**  |   parses   |             parses             |
| Brace expansion `{a,b}`    | parses\*\* |       parses\*\*       | parses\*\* | parses\*\* |           parses\*\*           |
| `function` keyword         |   parses   |       **error**        |   parses   |   parses   |             parses             |
| C-style `for (( ; ; ))`    |   parses   |       **error**        | **error**  |   parses   |             parses             |
| Extended glob `@(a\|b)`    |   parses   |       **error**        |   parses   |   parses   | parses\*\*\* (no ExtGlob node) |
| Herestring `<<<`           |   parses   |       **error**        |   parses   |   parses   |             parses             |
| `let` clause               |   parses   | **parses** (see below) |   parses   |   parses   |             parses             |

Under POSIX sh, `[[` and `let` are not keywords, so they parse as ordinary commands, just as a
POSIX shell would read them. That is why the example above gives a `CallExpr` named `[[` under
`LangPOSIX`.

\* Under posix, `=~` is just another argument to the `[[` command.

\*\* `{a,b}` stays a plain `Lit` word part in every dialect. Call `splitBraces(word)` to turn it
into a `BraceExp`.

\*\*\* Zsh never treats `@(` as an extended glob, to avoid clashing with its glob qualifiers such as
`*(N)`. `ls @(a|b)` parses, but as plain `Lit` parts.

## Errors and limits

Every error extends `ShAstError` and has a stable `code`:

| Error                  | `code`                   | When                                                        |
| ---------------------- | ------------------------ | ----------------------------------------------------------- |
| `ParseError`           | `SH_AST_SYNTAX_PARSE`    | The script has a syntax error. `File` holds a partial tree. |
| `LangError`            | `SH_AST_SYNTAX_LANG`     | The syntax is not allowed in the chosen dialect.            |
| `ShParseMaxDepthError` | `SH_AST_PARSE_MAX_DEPTH` | The script nests too deeply (see below).                    |
| `InputError`           | `SH_AST_SYNTAX_INPUT`    | An argument cannot be used, for example an invalid option.  |

Printing and walking have their own errors (`PrintError`, `WalkPanicError`); the
[guide](https://github.com/mike-north/sh-ast/blob/main/packages/sh-ast/GUIDE.md#errors) lists them
all.

**Deep nesting.** To protect your process from stack exhaustion on hostile input, the parser
refuses scripts nested more than 128 levels deep and throws `ShParseMaxDepthError`, with no
partial tree. Later calls keep working. A level is something opened inside something else: a
subshell, a `$( )` substitution, a parameter expansion, arithmetic parentheses, a function or loop
body. In practice the limit is about 127 nested subshells, 63 nested `$( )` substitutions or 125
nested arithmetic parentheses.

Length is not depth. A list of commands joined by `&&`, `||` or `|`, or an arithmetic expression
such as `1 + 1 + … + 1`, parses, walks and prints however long it is, because nothing in it is
nested; only what its elements contain counts towards the limit.

```ts
import { ShParseMaxDepthError, parseSync } from 'sh-ast';

try {
  parseSync('('.repeat(200) + 'true' + ')'.repeat(200));
} catch (error) {
  if (error instanceof ShParseMaxDepthError) console.log(error.code, error.maxDepth);
  // SH_AST_PARSE_MAX_DEPTH 128
}
```

**Copying long chains.** `structuredClone` copies a tree by recursing inside the JavaScript
engine, so its limit is the host's stack, not sh-ast's. In a default Node.js 22 process it throws a
`RangeError` for a tree holding a single list of about 1,000 commands, or an arithmetic expression
of about 2,000 terms, and sooner when called from deep in your own code. `JSON.stringify` stops at
about three times those lengths. Parsing, `walk` and `printSync` do not have this limit.

**Invalid UTF-8.** Pass bytes as a `Uint8Array` and invalid UTF-8 becomes a `ParseError`
(`1:6: invalid UTF-8 encoding`). A JavaScript string with an unpaired surrogate is rejected with
`InputError` before parsing. Values that are not valid UTF-8 come back as `Uint8Array`, so string
fields are typed `string | Uint8Array`.

**Byte offsets.** `Offset` and `Col` count UTF-8 bytes, not JavaScript string characters. They
differ as soon as the script contains non-ASCII text. Convert like this:

```ts
import { nodePos, parseSync, walk } from 'sh-ast';

const source = 'echo "héllo" && ls\n';
const bytes = new TextEncoder().encode(source);
const toIndex = (offset: number) => new TextDecoder().decode(bytes.subarray(0, offset)).length;

walk(parseSync(source), (node) => {
  if (node?.Type === 'CallExpr') {
    const { Offset } = nodePos(node);
    console.log(Offset, toIndex(Offset));
  }
  return true;
});
// 0 0
// 17 16
```

`sh-ast` parses and prints. It does not run scripts, expand variables or resolve which program a
command runs; for that kind of analysis, see
[sh-analysis](https://github.com/mike-north/sh-analysis).

## API reference

- [API reference](https://github.com/mike-north/sh-ast/blob/main/docs/index.md): every export,
  generated from the type declarations.
- [Guide](https://github.com/mike-north/sh-ast/blob/main/packages/sh-ast/GUIDE.md): the data
  model, positions, editing during a walk, copying, printing and every error and limit in detail.

## How it is built

The parser and printer are the `syntax` package of [mvdan/sh](https://github.com/mvdan/sh), built
from a [maintained fork](https://github.com/mike-north/sh) and compiled to WebAssembly. The
TypeScript types are generated from the Go source, so every node and field matches upstream. The
WebAssembly binary is built in CI and checked byte for byte against a fresh rebuild.

## Contributing and security

- [Contributing guide](https://github.com/mike-north/sh-ast/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/mike-north/sh-ast/blob/main/SECURITY.md): report
  vulnerabilities privately, not in public issues.
- [Issues](https://github.com/mike-north/sh-ast/issues)

## License and credits

MIT, see [LICENSE](./LICENSE). `sh-ast` embeds [mvdan/sh](https://github.com/mvdan/sh) by Daniel
Martí (BSD-3-Clause), compiled to WebAssembly, and Go's `wasm_exec.js` (BSD-3-Clause). See
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
