# sh-ast guide

The [README](./README.md) covers the everyday tasks. This guide is the full contract: how the tree
is shaped, what positions mean, which edits are safe during a walk, and every error and limit.

- [The tree](#the-tree)
- [Positions](#positions)
- [Walking](#walking)
- [Editing during a walk](#editing-during-a-walk)
- [Copying](#copying)
- [Printing](#printing)
- [Brace expansion](#brace-expansion)
- [Operators and metadata](#operators-and-metadata)
- [Errors](#errors)
- [Resource limits](#resource-limits)

## The tree

`parseSync` returns plain, mutable JavaScript objects that mirror the Go structs in mvdan/sh's
[`syntax` package](https://pkg.go.dev/mvdan.cc/sh/v3/syntax). Field names keep their Go spelling,
and every record has a `Type` field naming its struct, so a `switch (node.Type)` narrows the type.

- **Every field is present.** A Go nil slice or pointer is `null`; an allocated empty slice is
  `[]`. Entries of a list of pointers, such as `CallExpr.Args`, can be `null` too. Check with
  `?.` and `??`, not `in`.
- **`Slice`, `Replace` and `Expansion` are auxiliary records, not nodes.** They hang off
  `ParamExp` and are never passed to a walk callback on their own.
- **Typed nil.** A Go interface field can hold a nil pointer of a concrete type, which is
  different from an empty interface. `sh-ast` keeps that difference as
  `{ Type: 'TypedNil', Kind: 'Word' }`. You will rarely see one in parsed output, but code that
  handles every union member should allow for it. Plain pointer fields still use `null`.
- **Strings or bytes.** Shell source can contain bytes that are not valid UTF-8. Fields that hold
  Go strings are typed `GoString`, which is `string | Uint8Array`: valid UTF-8 is a string, and
  anything else stays as bytes. Handle both.

`parseSync(source, options?)` accepts a string or a `Uint8Array`. Strings are encoded as UTF-8;
a string with an unpaired surrogate throws `InputError`, so pass bytes when you have them. Invalid
UTF-8 in bytes reaches the parser and produces its `ParseError`.

| Option          | Default    | Meaning                                                                    |
| --------------- | ---------- | -------------------------------------------------------------------------- |
| `Variant`       | `LangBash` | Dialect: `LangBash`, `LangPOSIX`, `LangMirBSDKorn`, `LangBats`, `LangZsh`. |
| `KeepComments`  | `false`    | Keep `Comment` nodes in the tree.                                          |
| `Filename`      | `''`       | Name shown in error messages and stored on `File`. No file is opened.      |
| `StopAt`        | none       | Stop parsing at this word, as mvdan/sh's `StopAt` does.                    |
| `RecoverErrors` | `0`        | Recover from up to this many missing tokens instead of failing.            |

Integer options accept a safe-integer `number` or an exact `bigint`.

## Positions

Every position is a `SyntaxPos`:

| Field            | Meaning                                                         |
| ---------------- | --------------------------------------------------------------- |
| `Offset`         | Byte offset from the start of the source, zero-based.           |
| `Line`, `Col`    | One-based line and column. `Col` counts bytes, not characters.  |
| `IsValid`        | `false` for a position that was never set.                      |
| `IsRecovered`    | `true` for a token the parser invented while recovering.        |
| `OffsetOverflow` | `true` when the offset was too large for the position encoding. |

Because offsets count UTF-8 bytes, they differ from JavaScript string indices once a script
contains non-ASCII text. The README shows a [conversion
snippet](./README.md#errors-and-limits). `sh-ast` never converts for you.

There are two ways to get a node's span:

- **`nodePos(node)` and `nodeEnd(node)`** compute the start and the exclusive end from the node's
  current fields, the same way mvdan/sh's `Pos()` and `End()` do. They work on edited nodes and
  on nodes you build yourself. Editing a value does not move stored positions, so after an edit
  the span still describes the original token positions. A node you build by hand can be complete
  enough for one bound but not the other; the missing bound throws `InputError`.
- **`parseWithPositionsSync(source, options?)`** parses once and returns `{ File, Positions }`.
  `Positions.get(node)` returns the `{ Pos, End }` each node had at parse time, by object identity,
  with no further calls into WebAssembly. Edits to `File` do not change it, and copied or new
  nodes have no entry. Use it when you map nodes back to the original source, for example to
  report a lint location or replace a span of text. Parse errors behave as they do for
  `parseSync`.

```ts
import { parseWithPositionsSync } from 'sh-ast';

const { File, Positions } = parseWithPositionsSync('echo old\n');
const stmt = File.Stmts?.[0];
if (stmt) console.log(Positions.get(stmt)?.End.Offset); // 8
```

`newPos(offset, line, column)` builds a position with mvdan/sh's clamping and overflow rules.

## Walking

`walk(node, callback)` follows mvdan/sh's `syntax.Walk` order.

- The callback runs on entry with the node, and on exit with `null`.
- Return `true` on entry to visit the children, or `false` to skip them. A skipped node gets no
  exit call. The value returned on exit is ignored.
- The callback must return a boolean. Anything else, including a Promise, throws `InputError`:
  the walk is synchronous.
- An exception thrown by the callback stops the walk and reaches you unchanged.
- Nested `walk` calls inside a callback are independent.

Comments are visited in two ways. Comments stored in a list (for example `File.Last`) are visited
as the stored objects. The comments attached to a `Stmt`, `CaseItem` or `ArrayElem` are visited
as copies, so editing those callback values does not change the tree; edit the parent's
`Comments` array instead.

## Editing during a walk

Children are read live, so you can edit the tree while you walk it. These edits are supported:

- Change any field that keeps a node's kind and shape.
- Replace a pointer child before the walk reaches it.
- Replace a list entry the walk has not reached yet.
- Append to a list. The walk notes each list's array and length when it starts that list; entries
  appended beyond that length are not visited by the current walk, but later walks see them.
- Assign a new array to the owning field. The current walk keeps going over the old array; later
  walks see the new one.

Edits made before the walk reaches a list are always included.

Do not shrink a list the walk is part way through. Removing an entry inside the noted length,
leaving a hole, or shortening the array (`length = n`, `delete`, `pop`, `shift`, or a `splice` that
removes items) is unsupported, even through another reference to the same array. Nothing detects
it and no particular result is promised. To remove items mid-walk, assign a new array instead.

Reordering in place (`sort`, `reverse`, or swapping entries) follows the live slots, so the walk
can visit an object twice if you move it into a slot it has not reached yet. Walks do not promise
to visit each object exactly once.

Arrays and objects are ordinary JavaScript values. Two fields that share an array or object share
your edits too; `sh-ast` does not copy them. Go slice capacity and reslicing have no equivalent
here.

The design record behind these rules is in
[WALK-MUTATION-DECISION.md](https://github.com/mike-north/sh-ast/blob/main/design/WALK-MUTATION-DECISION.md).

## Copying

Use the standard `structuredClone(node)` to get an independent, editable copy of a `File` or any
node. Clone the syntax value itself, without a transfer list. Do not clone the result of
`parseWithPositionsSync`; its `Positions.get` is a function and is not cloneable. Very long
command lists and arithmetic chains can exceed the host's stack when cloned; see
[Resource limits](#resource-limits).

```ts
import { parseSync, printSync } from 'sh-ast';

const original = parseSync('echo one\n');
const copy = structuredClone(original);
const cmd = copy.Stmts?.[0]?.Cmd;
if (cmd?.Type === 'CallExpr') {
  const part = cmd.Args?.[1]?.Parts?.[0];
  if (part?.Type === 'Lit') part.Value = 'two';
}
console.log(JSON.stringify(printSync(original))); // "echo one\n"
console.log(JSON.stringify(printSync(copy))); // "echo two\n"
```

- The copy has its own records, arrays, positions and `Uint8Array` buffers. `TypedNil` tags keep
  their kind.
- Objects shared inside the copied tree stay shared in the copy; references held outside it
  still point at the original.
- Positions keep their values. Copying does not move tokens or rebase offsets, so an unedited
  copy gives the same `nodePos`/`nodeEnd` results as the original.
- Every copied node is a new object, so it has no entry in the original `Positions` snapshot.
  Keep the original node when you need its source span, for example to place a printed fix.
- Copies work anywhere the original does: `walk`, `nodePos`, `nodeEnd` and `printSync`, with the
  same rules.

The design record is in
[STRUCTURED-CLONE-DECISION.md](https://github.com/mike-north/sh-ast/blob/main/design/STRUCTURED-CLONE-DECISION.md).

## Printing

`printSync(node, options?)` runs a fresh mvdan/sh printer over the current tree and returns the
whole output as a `GoString`.

- You can print a `File`, `Stmt`, `Word`, `Assign`, any command node, or any word part. Other
  nodes, such as a `Redirect`, throw `PrintError`.
- Only a `File` is guaranteed to end with a newline.
- Output uses mvdan/sh's formatting, the same as `shfmt`. It does not replay the original source
  bytes or keep the original indentation of a subtree.
- Parsing the printed output again is not guaranteed to reproduce every value, such as a
  `TypedNil`.

| Option             | Default | Meaning                                                     |
| ------------------ | ------- | ----------------------------------------------------------- |
| `Indent`           | `0`     | Spaces per level; `0` indents with tabs.                    |
| `BinaryNextLine`   | `false` | Put `&&`, `\|\|` and `\|` at the start of the next line.    |
| `SwitchCaseIndent` | `false` | Indent `case` items inside `case`.                          |
| `SpaceRedirects`   | `false` | Put a space after redirect operators, as in `> file`.       |
| `KeepPadding`      | `false` | Keep column alignment. Best effort and deprecated upstream. |
| `Minify`           | `false` | Print as compactly as possible.                             |
| `SingleLine`       | `false` | Join statements onto one line where possible.               |
| `FunctionNextLine` | `false` | Put a function's opening brace on the next line.            |

`Minify` and `SingleLine` together throw `PrintError`. `Indent` accepts a safe-integer `number`
or an exact `bigint`.

## Brace expansion

Parsing leaves `{a,b}` as literal text in every dialect. `splitBraces(word)` applies mvdan/sh's
`SplitBraces` to a `Word` in place and returns its boolean result:

```ts
import { parseSync, splitBraces } from 'sh-ast';

const cmd = parseSync('echo {a,b}c\n').Stmts?.[0]?.Cmd;
if (cmd?.Type === 'CallExpr' && cmd.Args?.[1]) {
  const word = cmd.Args[1];
  console.log(splitBraces(word)); // true
  console.log(word.Parts?.map((part) => part?.Type)); // [ 'BraceExp', 'Lit' ]
}
```

- The result is not a "this word has brace expansion" test: `{a}`, `{}` and malformed brace text
  can return `true` without producing a `BraceExp`.
- `false` leaves the word untouched. `true` replaces `Parts` with a new array, reusing the word
  part objects that mvdan/sh reuses. Old references to the `Parts` array still see the old array.
- New `Lit` records have no entry in an earlier `Positions` snapshot.
- mvdan/sh's `Walk` does not support `BraceExp`, so walking a split word throws
  `WalkPanicError`. Walk before you split, or read the new parts directly.
- It does not expand anything else, fix escaping, or decide whether a given shell would expand
  the word.
- To keep the original word, call it on `structuredClone(word)`.

## Operators and metadata

Operator fields are numbers, and each operator family has named constants (for example
`RedirOperator` values such as `RdrOut`). `rawOperator('RedirOperator', value)` produces a value
of that family from a raw unsigned 32-bit number, for values that have no name. Being able to
represent a value does not mean every operation accepts it.

`SYNTAX_SCHEMA` and `SYNTAX_INTERFACES` describe every record's fields and every interface's
concrete types. They are deeply frozen. Their order is not the walk order.

## Errors

Every error extends `ShAstError` and has a stable `code`.

| Error                  | `code`                      | Meaning                                                                           |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| `ParseError`           | `SH_AST_SYNTAX_PARSE`       | Syntax error. Has `Pos`, `Text`, `Incomplete` and the partial `File`.             |
| `LangError`            | `SH_AST_SYNTAX_LANG`        | Syntax not allowed in the dialect. Has `Feature`, `Langs`, `LangUsed`, `File`.    |
| `ShParseMaxDepthError` | `SH_AST_PARSE_MAX_DEPTH`    | Input nests too deeply. Has `maxDepth`; no partial tree.                          |
| `InputError`           | `SH_AST_SYNTAX_INPUT`       | An argument cannot be used: a bad option, an unpaired surrogate, a missing bound. |
| `PrintError`           | `SH_AST_SYNTAX_PRINT`       | The printer reported an error, or the node cannot be printed.                     |
| `PrintPanicError`      | `SH_AST_SYNTAX_PRINT_PANIC` | The printer panicked on a tree it was given.                                      |
| `WalkPanicError`       | `SH_AST_WALK_PANIC`         | The walk reached a node mvdan/sh's `Walk` panics on, such as `BraceExp`.          |
| `ShInternalError`      | `SH_AST_INTERNAL`           | Something failed inside `sh-ast` itself. Please report it.                        |

`ParseError` and `LangError` keep mvdan/sh's message bytes in `Message`. Their `error.message`
is the same text decoded for display.

A syntax error found before the depth limit is reported as a `ParseError`.

## Resource limits

**Parsing.** The parser refuses input that nests more than 128 units deep and throws
`ShParseMaxDepthError`. A statement, word or expression that is open inside another counts one
unit. In practice that means about 127 nested subshells, 63 nested `$( )` substitutions or 125
nested arithmetic parentheses. A list of commands joined by `&&`, `||` or `|`, and a chain of
left-associative arithmetic operators such as `1 + 1 + … + 1`, cost nothing for their length:
mvdan/sh builds them as left-nested trees, but every element is parsed at the depth of the list
itself. Sequences that the grammar nests are different: each `elif` opens inside the clause before
it, `&&` and `||` inside `[[ ]]` group to the right, and so do the arithmetic operators `=`, `?:`
and `**`. These still cost one unit per link, so they are refused after about 125 links. The
limit protects the host from stack exhaustion; it is not a limit on file size, and
long flat scripts, long lists and long comment runs are fine. The refused call returns no
partial tree, and later calls work normally. The error's `estimatedDepth` field holds the count at
which the parser stopped.

**Printing.** `printSync` collects the whole output in memory. A very large tree or a very large
`Indent` can take a lot of memory and time. The parse limit does not apply to trees you build
yourself.

**Brace splitting.** `splitBraces` refuses words whose input or result would be more than 256
nested records deep, and throws `ShInternalError` without changing the word. A short brace
literal can expand to a deep result, which is why the result is checked too.

**Copying.** `structuredClone` and `JSON.stringify` recurse inside the JavaScript engine, so the
host's stack limits them, not sh-ast. In a default Node.js 22 process `structuredClone` throws a
`RangeError` for a tree holding a single list of about 1,000 commands or an arithmetic expression
of about 2,000 terms, and `JSON.stringify` at about three times those lengths. Both fail sooner
when called from deep in your own code.

**Other recursion.** Parsing, `walk` and the transfer of trees to and from the printer do not
recurse per node. The printer itself follows long `&&`, `||`, `|` and arithmetic chains without
recursing, but it recurses through other nesting, so printing a very deeply nested tree that you
construct yourself uses the stack and is not covered by the parse limit.
