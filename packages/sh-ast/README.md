# sh-ast

A synchronous TypeScript interface to the `syntax` package of
[mvdan/sh](https://github.com/mvdan/sh), pinned to **v3.13.1**. Parsing returns
mutable records preserving upstream fields, defaults, nulls, numeric operators,
byte strings, and token positions. First use initializes WebAssembly synchronously
in Node.js; no initialization promise is required.

```ts
import { LangBash, nodeEnd, parseSync } from 'sh-ast';

const file = parseSync('echo hi', { Variant: LangBash, KeepComments: true });
const command = file.Stmts?.[0]?.Cmd;
if (command?.Type === 'CallExpr') {
  console.log(command.Args?.[0]?.Parts); // upstream WordPart alternatives
  console.log(nodeEnd(command).Offset); // exclusive byte offset
}
```

## Public contract

- `parseSync(source, options?)` accepts a well-formed Unicode string or exact
  `Uint8Array` bytes. Invalid UTF-8 reaches upstream and produces its parse error;
  lone JavaScript surrogates are rejected before encoding.
- `ParseOptions` contains `Filename`, `KeepComments`, `Variant`, `StopAt`, and
  `RecoverErrors`. Defaults match upstream, including `KeepComments: false`.
  `Variant` uses exported constants such as `LangBash` and `LangPOSIX`.
- `File`, `Node`, and concrete records retain upstream spelling and a `Type`
  discriminator. Every field is present; nil slices/pointers use `null`, while an
  allocated empty slice is `[]`. `Slice`, `Replace`, and `Expansion` are auxiliary
  records, not Nodes. Interface unions also admit `TypedNil<Kind>` with
  `{ Type: 'TypedNil', Kind: 'Word' }` spelling: this preserves a Go interface
  holding a nil pointer of a concrete type, distinct from an ordinary `null`
  interface. A tag is allowed only where that concrete type implements the
  declared interface; concrete pointer fields continue to use `null`.
- `GoString` is `string | Uint8Array`: valid UTF-8 is text; other Go string bytes
  remain bytes. Consumers must explicitly handle both representations.
- `SyntaxPos` preserves `Offset`, `Line`, `Col`, `IsValid`, `IsRecovered`, and
  `OffsetOverflow`. Offsets and columns count bytes; lines/columns are one-based.
  Invalid, recovered, and overflow states remain distinct. No UTF-16 projection is
  performed by this package.
- `nodePos(node)` and `nodeEnd(node)` independently compute upstream bounds from
  the current fields, including after edits. They do not return cached parse-time
  bounds. Incomplete constructed nodes can support one bound but fail the other.
- `parseWithPositionsSync(source, options?)` parses once and returns `{ File,
Positions }`. `Positions.get(node)` reads immutable original bounds by node
  identity without additional WASM calls. Editing `File` leaves these observations
  unchanged; copied or foreign nodes have no entry. Use this separate snapshot for
  source-location adapters, and live `nodePos`/`nodeEnd` for edited syntax. A
  captured upstream bounds failure is thrown when its pair is requested; it does
  not discard a successful parse. Parser failures retain the same structured
  error and partial File as `parseSync`.
- `newPos(offset, line, column)` preserves upstream clamping/overflow semantics.
  Its uint64 inputs and the parser's Go int options accept safe integers or exact
  `bigint`; stored position components and operator values are numbers.
- Operator families have named numeric constants and a distinct raw uint32 path,
  `rawOperator('RedirOperator', value)`, for unnamed upstream values. Representing
  a value does not promise every upstream operation accepts it.
- `SYNTAX_SCHEMA` and `SYNTAX_INTERFACES` are deeply frozen field/interface
  metadata. Their order is not upstream Walk order.

`ParseError` and `LangError` preserve upstream fields, exact `Message` bytes, and
any partial `File`. Their ordinary `Error.message` is a display string.
`InputError` reports invalid binding inputs, upstream option constraints, or
unsupported constructed nodes whose requested bound panics upstream.
`ShInternalError` reports transport failures or unexpected upstream panics.
All extend `ShAstError`. The conservative structural-depth guard throws
`ShParseMaxDepthError` before potentially exhausting the WASM stack. It is a
binding resource constraint and can reject deeply nested quoted or commented text.

`sh-ast/analyze` remains a separate syntactic interpretation layer. Its word,
command, and wrapper analysis consumes the faithful records; it does not define
parser behavior or the core tree representation.

## Migration from 0.3

Fields now use upstream spelling (`Type`, `Stmts`, `Cmd`, `Value`) and explicit
null/default values. Replace dialect strings with numeric `Variant` constants,
request comments explicitly, and handle structured errors and byte positions.
The root no longer exports normalized `ShNode`/`ShNodes`, `range`/`loc`, `walk`, or
`visitorKeys`. Consumers such as ESLint own their source-coordinate and traversal
views. Whole-file parsing is the present scope; public upstream traversal and
printing belong to the following minor release. Stateful/incremental parser
protocols and full syntax-package parity are deferred.

The [design collection](../../design/ARCHITECTURE.md) and
[implementation evidence](../../design/IMPLEMENTATION.md) describe the release
boundaries, concrete choices, and validation status. This package has no ESLint
runtime dependency. It originated in
[`eslint-sh`](https://github.com/mike-north/eslint-sh) at commit `bdd55b3`.

## Dialect enforcement

`Variant` accepts mvdan/sh's `LangVariant` (`LangBash`, `LangPOSIX`, `LangMirBSDKorn`,
`LangBats`, `LangZsh`). mvdan/sh gates most dialect-specific syntax with a hard parse error
(`checkLang` in its `syntax/parser.go`) when the requested dialect isn't in that construct's
allowed set — but two dialect-specific keywords (`[[` test clauses and `let`) have **no such gate**:
outside the dialects that recognize them, they silently fall through to ordinary word/command
parsing instead of erroring. The table below is derived by hand from that source, not from
guessing at current behavior, and is pinned by `test/dialect-matrix.test.ts`.

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

\* Under posix, `[[` is already an ordinary command word (see below), so `[[ a =~ b ]]` never
reaches the regex-test parser at all — `=~` is just another literal argument to a command named
`[[`.

\*\* Brace expansion is never split into a `BraceExp` node by this bridge, in any dialect — mvdan/sh
only produces `BraceExp` nodes when the caller explicitly runs its `syntax.SplitBraces()`
post-processing pass, which `shim/main.go` does not invoke. `{a,b}` always parses as an ordinary
`Lit` word part, identically in every dialect.

\*\*\* zsh's lexer never tokenizes `@(` as an extended-glob opener at all — deliberately, to avoid
ambiguity with zsh's own glob qualifiers like `*(N)`. So `ls @(a|b)` parses without error under
`Variant: LangZsh`, but produces plain `Lit` word parts rather than an `ExtGlob` node; the
`checkLang` gate that rejects extended globs under posix is never reached for zsh.

### `[[ ... ]]` and `let` under posix: accepted by design

`Variant: LangPOSIX` accepting `[[ a == b ]]` and `let x=1` is **intentional upstream behavior, not
a bridge bug**. POSIX sh has no `[[` test clause or `let` builtin as syntax — so mvdan/sh's parser
doesn't special-case those keywords at all outside bash-like/mksh/zsh; it falls through to
ordinary word/command parsing, exactly as a real POSIX-mode shell would tokenize `[[` as a command
name. By contrast, dialect-specific constructs that cannot be read as ordinary commands—arrays,
C-style `for`, `<()`, `<<<`, extended globs, and the `function` form—are rejected in POSIX mode,
either by an explicit `checkLang` gate or, for process substitution, after lexer fallback. A regex
operator inside `[[ a =~ b ]]` remains ordinary command text because POSIX mode never enters the
test-clause parser.

Concretely, under `Variant: LangPOSIX`:

```ts
import { LangPOSIX, parseSync } from 'sh-ast';

const file = parseSync('[[ a == b ]]', { Variant: LangPOSIX });
file.Stmts?.[0]?.Cmd?.Type; // "CallExpr" — a command literally named "[[", not "TestClause"
```

Evidence: mvdan/sh's own test suite (`syntax/filetests_test.go`) asserts this exact shape for
`LangPOSIX`, and the syntax bridge passes the requested numeric variant to mvdan/sh's
`Variant` control — the bridge does not special-case or mis-map `[[`.

## Generated model

The generator reads the pinned upstream struct definitions. Run
`pnpm run generate:sh-ast-schema` after changing the matching pins in
`shim/go.mod` and `../../tools/gen-visitor-keys/go.mod`. Faithful declarations,
constants, and complete field metadata live in `generated/syntax-*`.
Independent Go reflection tests, manually derived type assertions, and runtime
fixtures check fidelity; regeneration alone checks only drift.

## The WASM shim

The `syntaxProcess` linear-memory ABI transports exact byte payloads and a
reversible record encoding. `shim/internal/syntaxwire` preserves all exported
fields, nil/default values, arbitrary strings, and observable position behavior.
`shim/internal/syntaxbridge` invokes upstream parsing and position operations.
Private Go printing tests verify that reconstructed edited trees retain the
information needed for the future public printer.

The canonical binary is built by Linux/amd64 CI with the Go toolchain pinned in
`shim/go.mod` and the checksum-pinned Binaryen version in
`.github/workflows/wasm-reproducibility.yml`. Go build flags are
`-buildvcs=false -trimpath -ldflags="-s -w -buildid="`; optimization uses
`wasm-opt -Oz --enable-bulk-memory-opt --enable-nontrapping-float-to-int`.
Use local builds for experiments. Commit the CI-produced artifact, then require
CI to compare a fresh rebuild byte-for-byte with the committed binary. Historical
normalized-parser benchmarks do not describe this interface's performance.
