# sh-ast

A synchronous TypeScript interface to the `syntax` package of
[mvdan/sh](https://github.com/mvdan/sh), pinned to **v3.13.1**. Parsing returns
mutable records preserving upstream fields, defaults, nulls, numeric operators,
byte strings, and token positions. First use initializes WebAssembly synchronously
in Node.js; no initialization promise is required.

Traversal uses ordinary TypeScript arrays with explicit mutation limits. The
[accepted representation decision](../../design/WALK-MUTATION-DECISION.md) records
which live edits are supported and why this interface does not model Go storage
capacity, reslicing, or value-slot addresses.

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
- `walk(node, callback)` calls the callback synchronously on entry and with `null`
  on exit. Return `false` on entry to prune that occurrence, including its exit;
  exit boolean values do not control traversal. Every callback result must be a
  boolean; Promises and other values throw `InputError`. Child reads happen live, and
  nested calls keep independent state. Specialized statement/item comment loops
  visit value copies; ordinary comment lists visit their stored objects. The
  array reference and initial length are captured when each list starts. Future
  existing slots are read live; indices added beyond the captured extent are
  ignored by that active traversal. Replacing the owner's array field does not retarget an active list.
  See the mutation limits below.
- `printSync(node, options?)` reconstructs the current edited tree and collects a
  fresh upstream printer's output as `GoString`. Supported roots are File, Stmt,
  Word, Assign, Command and WordPart alternatives. Only File gets a guaranteed
  final newline. Printing applies upstream formatting; it does not replay the
  original source or promise source-byte identity.
- `PrintOptions` exposes `Indent`, `BinaryNextLine`, `SwitchCaseIndent`,
  `SpaceRedirects`, `KeepPadding`, `Minify`, `SingleLine`, and `FunctionNextLine`.
  Indent accepts an exact uint64 as a safe number or bigint, with zero selecting
  tabs. Boolean defaults are false. KeepPadding is upstream's best-effort,
  deprecated option; Minify and SingleLine together return an upstream error.

`ParseError` and `LangError` preserve upstream fields, exact `Message` bytes, and
any partial `File`. Their ordinary `Error.message` is a display string.
`InputError` reports invalid binding inputs, upstream option constraints, or
unsupported constructed nodes whose requested bound panics upstream.
`ShInternalError` reports transport failures or unexpected upstream panics.
`PrintError` retains ordinary upstream printer failures, and `PrintPanicError`
retains panics from printing representable inputs. `WalkPanicError` represents
upstream-equivalent traversal panics; callback exceptions retain their identity.
All extend `ShAstError`. The conservative structural-depth guard throws
`ShParseMaxDepthError` before potentially exhausting the WASM stack. It is a
binding resource constraint and can reject deeply nested quoted or commented text.
Printing collects complete output; large trees or indentation widths can consume
substantial memory and time. The parse guard does not bound arbitrary constructed
printing inputs. No arbitrary writer, partial-output, or reusable-printer protocol
is exposed.

## Traversal mutation limits

Supported edits preserve a node's kind and shape: change syntax fields, replace
pointer children before their read, replace future existing list slots, append
beyond an active list's captured extent, or assign a new array to the owner field.
Changes before a list starts are included in its captured reference and length.
Pruning and synchronous nested walks retain their control behavior; nested walks
see the tree at their own entry, while edits to shared objects remain live.

Keep every index in an active list's captured extent present. Removing one,
leaving a hole there, or shrinking below that extent is outside the supported
contract, including through aliases. Truncation, `delete`, `pop`, `shift`, or a
length-reducing `splice` can do this; removing appended indices beyond the captured
extent does not affect the active list. No mutation detector or specific
error/result is promised for those edits. Assign a new owner array
instead; the active list keeps its original array and later walks see the new one.
Length-preserving replacement or reordering, including `sort` and `reverse`,
follows live slot reads and may revisit an object moved into a later slot. Walk
does not promise to visit each object only once. An appended object moved into an
original future slot is visited through that slot.

Stored Comment callbacks receive JavaScript objects. Replacing a Comment slot
leaves a retained callback object unchanged; it does not behave as a pointer to a
Go value slot. Specialized Stmt/CaseItem/ArrayElem comment callbacks receive
copies, so editing those callback values does not edit the original comments.
Ordinary JavaScript aliases remain live; this interface does not clone shared
arrays or objects. It does not model Go slice capacity, distinct slice headers
sharing backing stores, or reslicing. These limits preclude unrestricted Go
storage mutation parity while preserving live field edits and upstream traversal control.

## Editing and printing

```ts
import { parseSync, printSync, walk } from 'sh-ast';

const file = parseSync("printf '%s\\n' 'old 🎉'\n", { KeepComments: true });
walk(file, (node) => {
  if (node?.Type === 'SglQuoted' && node.Value === 'old 🎉') {
    node.Value = 'new 🎉';
  }
  return true;
});
const output = printSync(file);
```

This edits a field without replacing array storage. Node positions still describe
their upstream token values; live `nodePos` and `nodeEnd` compute from current
fields, while a separately captured parse snapshot remains tied to original
source. Consumers such as ESLint can edit a separate tree and use printed output
as a fix without mutating their original lint view or traversal cache.

`sh-ast/analyze` remains a separate syntactic interpretation layer. Its word,
command, and wrapper analysis consumes the faithful records; it does not define
parser behavior or the core tree representation.

`resolveArgv0` follows only documented wrapper grammars. The default `env` and
`sudo` entries accept assignment names beyond shell identifiers, such as `A-B`
or `名`. `env` recognizes assignments after `--` and ends option scanning at its
first assignment; `sudo` permits options between assignments, excludes names
beginning with `/` or `=`, and stops recognizing assignments after `--`. An empty
`env` assignment name (`=value`) reports `ambiguous-assignment`, since supported
implementations differ. These are syntactic facts, not execution guarantees.
Custom tables can choose `WrapperSpec.assignmentOperands` (`'shell-identifier'`,
`'env'`, or `'sudo'`); this explicit grammar overrides `skipAssignmentOperands`.
Existing `skipAssignmentOperands: true` tables retain their ASCII shell-identifier
rule before `--`. Wrapper assignment operands do not change `assignmentsSkipped`,
which counts only shell-level prefixes.

## Migration from 0.3

Fields now use upstream spelling (`Type`, `Stmts`, `Cmd`, `Value`) and explicit
null/default values. Replace dialect strings with numeric `Variant` constants,
request comments explicitly, and handle structured errors and byte positions.
The root no longer exports normalized `ShNode`/`ShNodes`, `range`/`loc`, or
`visitorKeys`. The new walker uses entry/null-exit callbacks rather than the former
structural helper's protocol. Consumers such as ESLint own their source-coordinate
and traversal views. Whole-file parsing, collected printing and the live walker
with the mutation limits above form this candidate's scope. Stateful/incremental parser protocols
and full syntax-package parity are deferred.

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

\*\* Parsing preserves upstream output: `{a,b}` remains an ordinary `Lit` word part,
not a `BraceExp`, in every dialect. The analysis layer separately asks mvdan/sh v3.13.1's
`syntax.SplitBraces` to recognize potential expansions on a private copy. `resolveWord`,
`enumerateCommands`, and `resolveArgv0` report `static: false, reason: 'brace'` when actual
brace-expansion parts are found, without changing the caller's tree. A bare Word carries no
dialect or shell-option state, so this conservative observation also applies to POSIX-parsed
records; it does not assert that POSIX sh performs brace expansion.

Quoted or fully escaped opening braces within one literal part remain literal. Brace candidates containing other
backslashes report `unsupported`: pinned upstream's escape handling differs from Bash, and
analysis does not guess through that discrepancy. For example, `\{a,b\}` remains static,
while `a{b\,c}` is conservatively unsupported. Any unquoted backslash escape crossing word-part boundaries in a constructed
word is also unsupported, including boundaries into quoted parts: such a split
can expose otherwise quoted syntax, and analysis does not reconstruct shell
tokenization to infer a literal value. Malformed or singleton unescaped forms such as
`a{b` and `{a}` remain static. See [the brace-classification decision](../../design/BRACE-CLASSIFICATION-DECISION.md).

\*\*\* zsh's lexer never tokenizes `@(` as an extended-glob opener at all — deliberately, to avoid
ambiguity with zsh's own glob qualifiers like `*(N)`. So `ls @(a|b)` parses without error under
`Variant: LangZsh`, but produces plain `Lit` word parts rather than an `ExtGlob` node; the
`checkLang` gate that rejects extended globs under posix is never reached for zsh.

Reason descriptions do not promise universal precedence. Whole-word `unsupported`
preflight still applies when a constructed word already contains a `BraceExp`.
Independently quoted or fully protected literal siblings preserve `brace`; an
escape crossing parts or an escape-uncertain brace candidate remains unsupported.
Existing tilde/glob resolution order also remains applicable.

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
