# sh-ast

A synchronous TypeScript interface to the `syntax` package of
[mvdan/sh](https://github.com/mvdan/sh), using the maintained Go fork at
[`bbc7c4ace575`](https://github.com/mike-north/sh/tree/bbc7c4ace575d5de375726fdaa2a5c001c46564c),
based on **v3.14.1**. The [immutable source pin](../../tools/go-source.json) supplies
both the generated schema and the WASM bundle. Native corrections and their
upstream status live in the fork's
[maintenance record](https://github.com/mike-north/sh/blob/bbc7c4ace575d5de375726fdaa2a5c001c46564c/FORK-MAINTENANCE.md);
this binding applies no Go semantic patch stack. Parsing returns
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
All extend `ShAstError`. Parsing enforces a 128-unit native node-nesting budget.
The counter includes open statement, word, and expression work plus iterative
construction of deep operator trees; it is not a stack-frame count or a total
input-size limit. Exceeding it throws `ShParseMaxDepthError` with stable code
`SH_AST_PARSE_MAX_DEPTH`, no partial File or position sidecar, and permits later
parse calls on the same runtime. `maxDepth` is the native budget; the historical
field name `estimatedDepth` now carries the rejected native work counter.
Grammar errors found first retain their ordinary `ParseError` precedence.
Flat comment runs are scanned iteratively, with no separate comment-count limit.

This is an empirical binding resource constraint, not an upstream grammar rule
or a universal stack-safety guarantee. Repeated direct and ordinary ESLint calls
were tested on Node 22; arbitrary pre-existing JS recursion can consume the host
stack margin. Valid syntax can exceed this budget. The policy does not establish
safety for arbitrary constructed ASTs or other recursive operations
([tracked separately](https://github.com/mike-north/sh-ast/issues/71)).
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

Use ordinary `structuredClone(node)` to obtain an independent editable copy of a
parsed `File` or any `Node` subtree. Clone the syntax value itself, without a transfer
list; `ParsedFile` and `PositionSnapshot` contain the identity-based `get` function
and are not cloneable syntax records. No second parse or `copySyntax` helper is needed.

```ts
import { parseWithPositionsSync, printSync, walk } from 'sh-ast';

const parsed = parseWithPositionsSync("printf '%s\\n' 'old 🎉'\n");
const original = parsed.File.Stmts?.[0];
if (!original) throw new Error('Expected a statement');

const edited = structuredClone(original);
walk(edited, (node) => {
  if (node?.Type === 'SglQuoted' && node.Value === 'old 🎉') {
    node.Value = 'new 你好 e\u0301';
  }
  return true;
});
const output = printSync(edited); // A Stmt prints without a guaranteed final newline.
const originalSpan = parsed.Positions.get(original);
// parsed.Positions.get(edited) is undefined; original is unchanged.
```

The copy owns separate records, arrays, position values and `Uint8Array` byte buffers.
`GoString` bytes remain `Uint8Array`, and `TypedNil` tags retain their concrete kind.
Repeated references inside the reachable graph point to the same copied object;
external holders still point to the original objects. Editing the copy therefore
leaves the original syntax, byte values, printed output and live bounds unchanged.

Position fields retain their original values; copying does not relocate tokens or
rebase offsets. For an unedited copy, live `nodePos` and `nodeEnd` produce the same
outcomes as for the original. After edits they compute from the copied current
fields, while the original `PositionSnapshot` stays tied to the original source.
Every copied node is a new identity and has no entry in that snapshot. Keep the
original node when a consumer needs an original source span for a printed fix.

Copies remain valid inputs to `walk`, `nodePos`, `nodeEnd` and `printSync`
under each operation's existing input and failure rules. In
particular, printable roots remain File, Stmt, Word, Assign, Command and WordPart;
other Nodes are not made printable by copying. Preserving a `TypedNil` tag does not
promise that traversing, observing or printing that nil value succeeds.

Printing applies upstream formatting to the edited tree. It does not preserve
original source bytes, re-indent a subtree to its original column, or guarantee
that parsing printed output reconstructs every represented value such as a
`TypedNil` tag. The [copying decision](../../design/STRUCTURED-CLONE-DECISION.md)
records this boundary and its tests.

`splitBraces(word)` explicitly applies the selected Go `syntax.SplitBraces`
transformation to a mutable Word and returns its exact boolean. Parsing itself
continues to leave brace text as literal parts. For an isolated observation,
copy the Word first:

```ts
import { splitBraces, type Word } from 'sh-ast';

function rewrittenBraces(input: Word): Word {
  const copy = structuredClone(input);
  splitBraces(copy);
  return copy;
}
```

The boolean is not a brace-expansion classifier: `{a}`, `{}`, and malformed
brace text can return `true` without producing a `BraceExp`. The Word keeps its
identity. `false` leaves its Parts array and children untouched; `true` replaces
Parts while retaining input WordPart objects that Go reuses, including inside
new brace elements. Old array aliases retain the original array. New literal
records retain Go's copied position values and have no entry in an original
position snapshot. Selected Go Walk rejects BraceExp nodes; inspect the
transformed records directly rather than assuming traversal is extended.
The operation does not expand fields, repair escaping, or
assert which dialect or shell options will expand a word.

A shallow literal can produce a deeply nested brace graph. The binding checks
input iteratively before recursive validation, encoding or native entry, and
checks the native result after rewriting and before recursive transport. Either
side refuses more than 256 nested Go struct records with `ShInternalError`. Struct values, including
positions, count as records; slices and interface/pointer wrappers add no units.
This is an empirical bridge transport constraint on valid Go data, separate
from parser work or grammar. JavaScript input/output stack exhaustion is also
adapted to `ShInternalError`, with the original `RangeError` retained as `cause`.
Refusals leave the supplied Word unchanged. No fixed depth acceptance or arbitrary
caller-stack guarantee is made; catching an unexpected native engine trap alone
does not establish native runtime health.

## Responsibility boundary

The root entry point exports syntax records, constants, parsing, traversal,
printing and position operations. Word resolution, command inventory, wrapper
resolution and interpreter-invocation observations belong in the independent
[`mike-north/sh-analysis`](https://github.com/mike-north/sh-analysis) repository,
with selected npm package name `sh-analysis`. Extraction and publication status
are tracked there. This package exposes no `sh-ast/analyze` subpath or analysis
error classes, and has no dependency on analysis or ESLint.

Whole-file parsing, collected printing and the live walker with the mutation
limits above form this package's scope. Stateful/incremental parser protocols
and full syntax-package parity are deferred. Consumers such as ESLint own their
source-coordinate and traversal views.

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
not a `BraceExp`, in every dialect. Brace splitting is a separate operation
owned by Go's syntax package; parsing alone does not perform shell expansion.

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
`shim/internal/syntaxbridge` invokes the selected Go parsing, printing, and
position operations. Reconstructed edited trees retain the information those
operations observe.

Before either build, `node tools/verify-go-source.mjs` verifies both effective Go
module graphs against the recorded original requirement version, the full fork
Git revision and review-owned source and `go.mod` checksum pins. Go's standard
checksum algorithm checks the actual downloaded archive, expanded source and
cached `go.mod` bytes against those fixed pins. Coupled cache and consumer
`go.sum` changes cannot silently redefine the expected source identity; updates
to the pins require a separately verified download and review. This consistency
anchor does not protect against arbitrary repository changes. A local replacement or external
Go workspace cannot substitute a different implementation. The generator records
the resolved fork module path and immutable version in its output headers.
The `upstream.version` metadata is the required original module label; it does not
prove Git ancestry. The fork's maintenance record documents the historical baseline.

The canonical binary is built by Linux/amd64 CI with the Go toolchain pinned in
`shim/go.mod` and the checksum-pinned Binaryen version in
`.github/workflows/wasm-reproducibility.yml`. Go build flags are
`-buildvcs=false -trimpath -ldflags="-s -w -buildid="`; optimization uses
`wasm-opt -Oz --enable-bulk-memory-opt --enable-nontrapping-float-to-int`.
Use local builds for experiments. Commit the CI-produced artifact, then require
CI to compare a fresh rebuild byte-for-byte with the committed binary. Historical
normalized-parser benchmarks do not describe this interface's performance.
