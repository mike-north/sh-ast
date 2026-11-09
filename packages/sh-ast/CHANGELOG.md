# sh-ast

## 0.11.0

### Minor Changes

- [#93](https://github.com/mike-north/sh-ast/pull/93) [`43db64d`](https://github.com/mike-north/sh-ast/commit/43db64d48e97eeab654aa40f72785cc1e51f922d) Thanks [@mike-north](https://github.com/mike-north)! - Consume the maintained Go syntax fork at immutable revision bbc7c4ace575d5de375726fdaa2a5c001c46564c (based on mvdan/sh v3.14.1), using the same source for schema generation and canonical Linux WASM. Native fixes and their upkeep now live in the Go fork; the binding no longer carries a semantic source patch stack. Builds verify resolved source identity and actual module-cache integrity.

  Drop the constructed split-literal backslash and Zsh reverse-subscript compatibility holds. The selected Go printer doubles a trailing backslash, and reverse-subscript patterns remain opaque literal text: wildcard forms can parse, while nested substitutions are not exposed as syntax nodes. These are selected-Go observations, not a claim that opaque text contains no executable commands or that every printed program preserves shell behavior. Analysis extraction and its uncertainty contract are separate work.

  Expose synchronous `splitBraces(word): boolean` as the faithful Go syntax transformation. It mutates the Word, returns the exact upstream boolean, and retains original WordPart objects that Go reuses. A true result can occur without a BraceExp. Remove the private analysis-specific brace-classification bridge operation; classification remains in the analysis layer.

  Bound SplitBraces input and output transport to 256 nested Go struct records, including positions. Check input iteratively before recursive validation, encoding or native entry; check output after the upstream transformation and before recursive encoding. Deep valid data is refused as typed bridge failures without changing the caller's Word. Shared input aliases are checked along each path; cycles remain InputError. JavaScript input/output stack exhaustion retains its original RangeError as the cause of ShInternalError. This is a bridge resource constraint, separate from grammar and parser work limits.

- [#94](https://github.com/mike-north/sh-ast/pull/94) [`240ec38`](https://github.com/mike-north/sh-ast/commit/240ec38eb8ce0f3cb3b81b3382b76f104acf1942) Thanks [@mike-north](https://github.com/mike-north)! - Keep `sh-ast` a faithful synchronous syntax binding: remove the `sh-ast/analyze`
  entry point, analysis implementation, and root analysis error classes. Word,
  command, wrapper, and interpreter analysis is owned by the independent
  `mike-north/sh-analysis` repository and selected package `sh-analysis`. Syntax
  records, constants, parsing, traversal, printing, and binding errors remain at
  the root. There are no forwarding aliases or compatibility layer.

## 0.10.0

### Minor Changes

- [#86](https://github.com/mike-north/sh-ast/pull/86) [`0a36f9c`](https://github.com/mike-north/sh-ast/commit/0a36f9ccec1de73c7418e3e4e2032c79f7fa89cb) Thanks [@mike-north](https://github.com/mike-north)! - Move the mvdan/sh source pin to v3.14.1, retaining the native resource budget and maintained parser/printer corrections. This 0.x minor adds required `ParamExp.Split`, `GlobSubst`, and `RcExpand` option-state fields, exports `OptState` and its constants, and adopts corrected source bounds and `IfClause.Last` traversal.

  Accept array elements such as `target=(${target//@/ }[0])`, correct quoted arguments inside backticks, and retain the release's heredoc printer improvements, including internal tabs. Default output changes for backtick quoting and separated closing parentheses; KeepPadding also uses recorded command-substitution close columns. Missing heredoc terminators remain parse errors on this tag. Preserve existing constructed split-literal backslash printing pending a separate compatibility decision.

  Accept the measured correctness/performance tradeoff: in the fixed ten-cell campaign, nested parse increased from 0.165666 to 0.1727085 ms (1.0425102314294852x, +4.251023142948517%), nested print from 0.9797085 to 0.9834375 ms (1.0038062342012737x), and consumer parse from 6.434646 to 6.496354 ms (1.0095899603490068x, +0.061708 ms). The other seven aggregates decreased; consumer print decreased by 4.6534785 ms. The original strict comparison remains FAIL, and these observations do not establish non-regression. All ten cells, paired rounds and unchanged raw samples are retained in `design/validation/mvdan-3.14.1/`.

- [#84](https://github.com/mike-north/sh-ast/pull/84) [`211c5b7`](https://github.com/mike-north/sh-ast/commit/211c5b7d4207b5e409d3b1ed841ad629d5f03fde) Thanks [@mike-north](https://github.com/mike-north)! - Preserve the Bash value of unquoted `<<-` here-documents with backslash
  continuations when printing. Physical lines following an active continuation
  retain their exact tabs instead of receiving additional indentation. Quoted
  here-documents, ordinary `<<`, and bodies without continuations keep their
  previous output. The maintained correction leaves shared layout code unchanged;
  existing internal-tab, nested here-document, and KeepPadding limits remain.

- [#80](https://github.com/mike-north/sh-ast/pull/80) [`7d5c540`](https://github.com/mike-north/sh-ast/commit/7d5c540291b064ee4f346a8eb1d3820ea9a2dc44) Thanks [@mike-north](https://github.com/mike-north)! - Preserve literal vertical tabs and form feeds when printing quoted strings, unquoted words, here-document bodies and delimiters, and embedded comment text. These bytes previously became spaces or newlines, changing shell values and sometimes exposing comment text as commands. Written ANSI-C escapes retain their existing spelling. mvdan/sh remains pinned to v3.13.1 with a maintained printer correction; no API shape changes.

  Escape VT/FF individually in literals without horizontal tabs so physical newlines still align subsequent comments. Horizontal tabs retain their upstream whole-literal escaping and multiline alignment limit. The deprecated `KeepPadding` option retains upstream's counter behavior, including shrinking padding around protected bytes; ordinary and HT-only output remains byte-identical to the base.

  Nested `<<-` documents inside an outer `<<-` command substitution retain a known writer limit: VT/FF body values can still change, and malformed nested delimiters can become body data or make Bash reject the printed program. These nested cases are not covered by the byte-preservation correction.

  Minify's retained-shebang path also retains upstream's VT/FF transformation; an embedded form feed can still expose following shebang comment text as code. Conservative caller guards remain justified for these unsupported cases.

- [#91](https://github.com/mike-north/sh-ast/pull/91) [`38f32a3`](https://github.com/mike-north/sh-ast/commit/38f32a3c68dbc2a882dc48ff8f817f0c5987483a) Thanks [@mike-north](https://github.com/mike-north)! - Restore pre-pin Zsh reverse-subscript analysis while keeping mvdan/sh v3.14.1.
  Previously supported command and parameter substitutions are syntax nodes again:
  `echo ${a[(r)$(printf foo)]}` exposes `printf` to `walk` and `enumerateCommands`,
  with command-substitution context and source byte positions. Consumers inspecting
  these subscripts may see expansion nodes and additional command sites again.

  Recursive reverse-subscript flag arguments also use the existing 128-unit native
  work budget. Over-budget parsing returns the typed resource refusal without a
  partial tree or position snapshot, including when error recovery is enabled;
  subsequent parses remain available.

  Unsupported pre-pin patterns, including `foo*` and unmatched apostrophe/dollar
  forms, may again fail loudly instead of being accepted as opaque text. This
  restores the earlier compatibility ceiling; it does not provide general Zsh
  pattern support. The known arithmetic printing limit (`foo[0-9]` becomes
  `foo[0 - 9]` and can change matching), and paired-dollar quoting limits, remain.
  Broader pattern support and the character-class printing correction are tracked
  in [#90](https://github.com/mike-north/sh-ast/issues/90).

## 0.9.0

### Minor Changes

- [#76](https://github.com/mike-north/sh-ast/pull/76) [`cd340e6`](https://github.com/mike-north/sh-ast/commit/cd340e62d41e7c41ba8ddcd457d7a1818bc1bdf1) Thanks [@mike-north](https://github.com/mike-north)! - Add `WrapperSpec.shellBuiltin` to identify shell builtin wrappers and exclude them from absolute-path basename matching. The default `command` and `exec` entries now match only exact names, so `/tmp/command eval "$x"` resolves to `/tmp/command` rather than `eval`. Custom tables can mark their own builtins; omitted or false retains existing utility matching. mvdan/sh remains pinned to v3.13.1.

- [#79](https://github.com/mike-north/sh-ast/pull/79) [`5a08b91`](https://github.com/mike-north/sh-ast/commit/5a08b91259517af2746f8a99c2e91da790d27b10) Thanks [@mike-north](https://github.com/mike-north)! - Read pending here-document bodies when the operator's line ends in `(` or `( :`, attaching the body to its original command. Command-substitution scope is unchanged. mvdan/sh remains pinned to v3.13.1 with a maintained subshell parser correction.

## 0.8.0

### Minor Changes

- [#67](https://github.com/mike-north/sh-ast/pull/67) [`87da64f`](https://github.com/mike-north/sh-ast/commit/87da64fb2f293c2a247bb365399f0150c43ba2ea) Thanks [@mike-north](https://github.com/mike-north)! - `resolveArgv0` now follows a transparent wrapper named by absolute path: `/usr/bin/env bash x`, `/usr/bin/sudo -u alice rm x` and `/usr/bin/nice -n 5 rm x` resolve through to `bash` and `rm` instead of stopping at the wrapper. Exact names anywhere in the table take precedence; otherwise an absolute path's final segment can match a `WrapperSpec.names` entry, including custom plain names. The chain keeps the word as written (`/usr/bin/env`). Relative and trailing-slash paths have no final-segment fallback but still match explicitly listed custom names. Dynamic words (`"$dir/env"`) are not followed. Matching assumes the selected grammar without consulting `PATH` or the filesystem. This changes results on unchanged input: consumers that relied on `/usr/bin/sudo` being the effective command now see the wrapped command, with the wrapper still in `chain`. The parser remains based on mvdan/sh v3.13.1 with the documented maintained patches.

- [#73](https://github.com/mike-north/sh-ast/pull/73) [`4ecb0e6`](https://github.com/mike-north/sh-ast/commit/4ecb0e625e25cd9e841db34f1c5281fda54be54d) Thanks [@mike-north](https://github.com/mike-north)! - Replace the lexical pre-scan with a fixed 128-unit native node-nesting budget for both parse operations. Preserve `ShParseMaxDepthError`, its code, and constructor signature; `maxDepth` now means the native budget and the historically named `estimatedDepth` carries the rejected native work count. Resource refusals contain no partial File or position sidecar and leave subsequent parses usable. Grammar errors encountered first retain their ordinary precedence. Some valid inputs accepted by the former 150-unit lexical policy now exceed the native budget.

  Keep mvdan/sh v3.13.1 with separate official Unicode-sentinel and nesting backports, plus owned comment-iteration and binding-budget adaptations. Flat comment runs parse iteratively without a comment-count limit. The budget is an empirical constraint tested with repeated ordinary direct and ESLint calls, not a universal guarantee for arbitrary caller stacks, constructed ASTs, or other recursive operations.

- [#70](https://github.com/mike-north/sh-ast/pull/70) [`44e9c18`](https://github.com/mike-north/sh-ast/commit/44e9c1853d8955e8d3f44e31f604914a9f5fe490) Thanks [@mike-north](https://github.com/mike-north)! - Preserve U+0080 and U+0081 as source characters instead of lexer control markers. Both parse APIs now retain later commands and literal contents that could previously be silently truncated, corrupted, or rejected, including quoted heredocs crossing reader boundaries. The parser remains pinned to mvdan/sh v3.13.1 with the official Unicode sentinel correction backported; this does not adopt the unrelated grammar or AST changes in v3.14.

- [#65](https://github.com/mike-north/sh-ast/pull/65) [`92ef7bf`](https://github.com/mike-north/sh-ast/commit/92ef7bfe81d5a84bcda9360d7bd3189716738562) Thanks [@mike-north](https://github.com/mike-north)! - `resolveArgv0` now reports a shell interpreter's `-c` operand (`bash -c "$x"`, `sh -ec ls`, `sudo zsh -lc ls`, `/bin/dash -c ls`) as `effective: { static: false, reason: 'embedded-command' }`, the same result `env -S` gives, instead of a static effective command naming the interpreter. The interpreter word stays available as `chain.at(-2)` and `chainIndices.at(-1)` is the option word that selected `-c`. Covered interpreters are `bash`, `sh`, `dash`, `zsh`, `ksh`, `ksh93` and `mksh`, matched by final path segment; `bash script.sh`, `bash -e script.sh`, `bash -- -c` and `bash -o c` are unchanged. This changes results on unchanged input: consumers that treated `effective.static` as "the command is the interpreter" must now handle `embedded-command` (and can read the shell from `chain`). Adds `DEFAULT_EMBEDDED_COMMAND_INTERPRETERS`, the `EmbeddedCommandInterpreterSpec` type and `ResolveArgv0Options.embeddedCommandInterpreters`; pass `[]` to restore the previous behavior. Pinned mvdan/sh remains v3.13.1.

  The configurable grammar includes long-option operands, option-terminating letters/words, and optional option-name operands. Zsh's `--emulate sh -c x` and `+-emulate sh -c x` report embedded commands; `-b` / `+b` stop scanning after their current cluster. Ksh's `-o -c x` and `+o -c x` report embedded commands using omitted-operand behavior executed on ksh93u+ AJM 2012-08-01; that boundary was not executed on ksh93u+m or mksh. Other tested shells keep requiring the option-name operand. Custom interpreter names must be basenames (`['bash']` also recognizes `/bin/bash` and `./bash`); entries containing `/`, null/undefined entries, and malformed grammar fields throw `ShAnalyzeInvalidWrapperSpecError`.

  Bash single-dash long-option aliases are recognized before clustered short options, preserving script invocations and selector indices for forms such as `-rcfile` and `-restricted`. Separate option operands that contain expansions stop scanning because they may produce multiple actual arguments. Sparse interpreter tables and sparse grammar-field arrays are rejected with the documented validation error.

  Custom operand-option entries cannot claim the reserved command selector `c`. Ksh's lone `+` is modeled as an option terminator, so `ksh -c +` without a following string stays static; this boundary was executed on ksh93u+ AJM 2012-08-01.

  Ksh/ksh93 `+c` forms stay static, and Apple ksh's `-R` consumes its database path. Exact-token fields cannot override `-c`, and non-array interpreter tables (including `null`) throw the documented validation error. Ordinary commands skip interpreter lookup when their first operand cannot select an option. The resolver documents and pins known limits for phase-dependent Bash aliases, command-mode clearing/dynamic options, mksh selector-bearing operands, lone `+`, and zsh grammar switches; the table models common spellings rather than every shell parser.

### Patch Changes

- [#64](https://github.com/mike-north/sh-ast/pull/64) [`4e92cec`](https://github.com/mike-north/sh-ast/commit/4e92cec1edb179a2787692c4e612773574126598) Thanks [@mike-north](https://github.com/mike-north)! - Fix a Go runtime abort (`fatal error: found bad pointer in Go heap`) that could occur once the WASM heap had grown, after which every later call failed. The WASM shim is now built with Go 1.26.10, which includes the upstream fix for golang/go#80472. Parse, position, and print output is unchanged.

- [#57](https://github.com/mike-north/sh-ast/pull/57) [`cff3a0a`](https://github.com/mike-north/sh-ast/commit/cff3a0a3d8b36733f149408c32ccf2ee32702554) Thanks [@mike-north](https://github.com/mike-north)! - Reduce `parseSync` and `parseWithPositionsSync` transport cost. The WASM shim now encodes syntax records with precomputed per-type plans, cheaper cycle tracking and a reused response buffer, and sends an ASCII-only response with compact File position tuples; the JavaScript side finds the response terminator natively, skips byte-string restoration when no byte strings are present, and restores positions during its single File validation pass. Parsed records, `GoString` values, position snapshots and supported-input error precedence are unchanged (pinned mvdan/sh v3.13.1).

  Sparse list holes in caller-constructed records now produce `InputError` before transport; they are not explicit nullable elements. Empty arrays and explicit `null` entries retain their existing behavior.

- [#61](https://github.com/mike-north/sh-ast/pull/61) [`bea22f4`](https://github.com/mike-north/sh-ast/commit/bea22f4c062872b4eb7f709425f406e7f9e787b2) Thanks [@mike-north](https://github.com/mike-north)! - Read every pointer returned across the WASM boundary as unsigned 32-bit, so parses no longer fail with a `RangeError` once linear memory grows past 2 GiB. An address that cannot be viewed now surfaces as `ShInternalError`.

## 0.7.0

### Minor Changes

- [#55](https://github.com/mike-north/sh-ast/pull/55) [`c8c0c0e`](https://github.com/mike-north/sh-ast/commit/c8c0c0e95e962f1f439dbb125a38a0c43742f86f) Thanks [@mike-north](https://github.com/mike-north)! - Export the named operator constants referenced by faithful record types, plus rawOperator, from sh-ast/analyze. Analyze-only consumers can compare and construct operator values without importing the root entry point. Existing types, constant values, operator families and validation behavior are unchanged.

- [#53](https://github.com/mike-north/sh-ast/pull/53) [`cd2a43c`](https://github.com/mike-north/sh-ast/commit/cd2a43cdc29e8ebeb3a78dc414e9570567661a4c) Thanks [@mike-north](https://github.com/mike-north)! - Add readonly `chainIndices` to `resolveArgv0` results, identifying each chain word or synthesized failure's triggering argument in `CommandSite.argv`. Preserve existing wrapper resolution and assignment behavior against pinned mvdan/sh v3.13.1; callers can locate a resolved command's arguments without repeating wrapper parsing.

### Patch Changes

- [#52](https://github.com/mike-north/sh-ast/pull/52) [`42bfcc2`](https://github.com/mike-north/sh-ast/commit/42bfcc245c88188f0d52ab86d2ad03e443d44fec) Thanks [@mike-north](https://github.com/mike-north)! - Document and test ordinary structuredClone as the supported way to make independent editable copies of parsed syntax subtrees. Preserve byte strings, typed-nil records, internal aliases and original position values while keeping copied node identities separate from parse-time snapshots and retaining each operation's existing input limits.

## 0.6.1

### Patch Changes

- [#49](https://github.com/mike-north/sh-ast/pull/49) [`9c5ff2b`](https://github.com/mike-north/sh-ast/commit/9c5ff2b1d5ade99db8ca1e170404e534f4f49a90) Thanks [@mike-north](https://github.com/mike-north)! - Reduce parse-with-positions transport overhead by collecting node occurrences during syntax encoding and sending compact position tuples with sparse errors. Preserve snapshot identity, original-source coordinates, independent upstream failures, and public API behavior.

## 0.6.0

### Minor Changes

- [#46](https://github.com/mike-north/sh-ast/pull/46) [`80bdcd9`](https://github.com/mike-north/sh-ast/commit/80bdcd9f99e2ad5e48dc8d15af13c8470f12794e) Thanks [@mike-north](https://github.com/mike-north)! - Recognize potential brace expansions in `resolveWord`, `enumerateCommands`, and
  `resolveArgv0` using mvdan/sh v3.13.1 on private observation copies. Parse records
  remain unchanged. Bare words are classified conservatively across dialects;
  brace candidates with uncertain backslash handling report `unsupported` rather
  than claiming a static command name.

  Caller-constructed words whose unquoted backslash escapes cross word-part
  boundaries also report `unsupported`; analysis no longer claims static text
  through those uncertain quoting boundaries.

- [#44](https://github.com/mike-north/sh-ast/pull/44) [`11697ff`](https://github.com/mike-north/sh-ast/commit/11697ff10d20fe5936762b558ea14156fe9facf2) Thanks [@mike-north](https://github.com/mike-north)! - Correct `resolveArgv0` assignment-operand recognition for `env` and `sudo` with mvdan/sh v3.13.1 syntax records. Names such as `A-B`, `1X`, and `名` no longer become false effective commands. `env` recognizes assignments after `--` and stops option parsing at its first assignment; `sudo` retains its own option and assignment boundaries. Platform-dependent empty-name `env` assignments now report `ambiguous-assignment`.

  Add explicit `WrapperSpec.assignmentOperands` grammar presets while preserving existing caller-supplied `skipAssignmentOperands` behavior. Parse output, shell assignment counts, and command policy remain unchanged.

### Patch Changes

- [#48](https://github.com/mike-north/sh-ast/pull/48) [`4e3420b`](https://github.com/mike-north/sh-ast/commit/4e3420bbb45df45bdd41947fe7c8f784a85c8811) Thanks [@mike-north](https://github.com/mike-north)! - Stream faithful syntax responses and position snapshots without intermediate syntax maps or retained boxed paths, preserving response bytes and error precedence. Reject cyclic slice inputs instead of recursing indefinitely.

- [#45](https://github.com/mike-north/sh-ast/pull/45) [`38d2be1`](https://github.com/mike-north/sh-ast/commit/38d2be19ad7964be6e332fe48cfcf812594215fd) Thanks [@mike-north](https://github.com/mike-north)! - Restore wire byte values in the JSON parser's owned records and arrays instead of
  allocating a second syntax tree. Public syntax values, byte preservation, and
  bridge validation remain unchanged.

## 0.5.0

### Minor Changes

- [#31](https://github.com/mike-north/sh-ast/pull/31) [`8f2aacb`](https://github.com/mike-north/sh-ast/commit/8f2aacb65a96fd936cf1d8e9394a844c615b3520) Thanks [@mike-north](https://github.com/mike-north)! - Add synchronous traversal and printing for the faithful mvdan/sh v3.13.1 syntax model. Traversal preserves upstream callback order and control using ordinary TypeScript arrays: active lists capture their array and extent, read future slots live, ignore appends, and retain their captured array when its owner field is replaced. Destructive active-array edits are unsupported; Go slice capacity, reslicing, backing-store aliases and value-slot addresses are not modeled. Printing uses the current edited tree and the pinned printer options. These operations support transformations while original parse-position snapshots remain tied to their original source.

## 0.4.0

### Minor Changes

- [#30](https://github.com/mike-north/sh-ast/pull/30) [`1431503`](https://github.com/mike-north/sh-ast/commit/143150399ed1a91f53f5a871335854f1d30ede18) Thanks [@mike-north](https://github.com/mike-north)! - Expose a faithful synchronous interface to mvdan/sh v3.13.1, preserving upstream fields, explicit defaults and nulls, byte strings, token positions, operator families, parser controls, and partial error results. First use remains synchronous. Node bounds are computed from current mutable records. `parseWithPositionsSync` provides a separate immutable snapshot of original node bounds for source consumers, with no per-node WASM calls.

  This 0.x migration replaces normalized lowercase nodes and UTF-16 ranges with upstream syntax records and byte positions; consumers own their presentation adapters. KeepComments now follows the upstream false default. Analysis helpers consume the new records. Public traversal and printing remain deferred to the following minor release.

## 0.3.1

### Patch Changes

- [#28](https://github.com/mike-north/sh-ast/pull/28) [`7a70a12`](https://github.com/mike-north/sh-ast/commit/7a70a12b0a2f93b30b89521dbc06d89a1067cd46) Thanks [@mike-north](https://github.com/mike-north)! - Audited and documented dialect enforcement (see issue [#27](https://github.com/mike-north/sh-ast/issues/27)): for each supported dialect (`bash`, `posix`, `mksh`, `bats`, `zsh`), a pinned test matrix (`test/dialect-matrix.test.ts`) and README table (`README.md#dialect-enforcement`) now spell out which constructs mvdan/sh's parser rejects vs accepts per dialect — test clauses `[[ ]]`, regex tests `=~`, array literals, process substitution `<()`, brace expansion, the `function` keyword, C-style `for`, extended globs `@()`, herestrings `<<<`, and `let`.

  `[[ ... ]]` and `let` parsing without error under `dialect: 'posix'` is confirmed **accepted-by-design**, not a bridge bug: mvdan/sh has no `checkLang` gate for either keyword, so outside bash-like/mksh/zsh they fall through to ordinary word/command parsing (`[[ a == b ]]` under posix parses as a `CallExpr` calling a command literally named `[[`) — mirroring mvdan/sh's own `LangPOSIX` test fixtures. No runtime parsing behavior changes in this release; this is audit, tests, and docs only.

## 0.3.0

### Minor Changes

- [#24](https://github.com/mike-north/sh-ast/pull/24) [`b93cba8`](https://github.com/mike-north/sh-ast/commit/b93cba8d7238cbc120d77a85b93a9f27b89b6a11) Thanks [@mike-north](https://github.com/mike-north)! - Generated node types (`node-types.d.ts`) now give every scalar leaf field a concrete TypeScript type instead of leaving it as `unknown` — e.g. `ShLitNode.value: string | undefined`, `ShStmtNode.negated: boolean | undefined`, `ShRedirectNode.op: number | undefined` (see issue [#22](https://github.com/mike-north/sh-ast/issues/22)). `tools/gen-visitor-keys` was only classifying node-reference/interface-union child fields; plain scalars fell through to the `[field: string]: unknown` catch-all every node still carries.

  Types are derived from the pinned `mvdan.cc/sh/v3 v3.13.1` struct definitions plus the shim's actual runtime serialization: `bool`/`string` fields map straight through, and mvdan/sh's `uint32`-backed operator-enum fields (`RedirOperator`, `BinAritOperator`, `CaseOperator`, ...) are typed `number` — those types implement only `fmt.Stringer`, not `json.Marshaler`, so the shim's encoder serializes them as plain JSON numbers, not string tokens.

  Every generated interface still carries `[field: string]: unknown` as an escape hatch for fields this generator doesn't yet classify — this is unchanged and intentional, not a hedge against the newly-typed fields.

## 0.2.0

### Minor Changes

- [#25](https://github.com/mike-north/sh-ast/pull/25) [`ea7dbfb`](https://github.com/mike-north/sh-ast/commit/ea7dbfbc32d2485c248796b17d9d4ee1d286746e) Thanks [@mike-north](https://github.com/mike-north)! - `sh-ast/analyze` now re-exports `ShAstError` (the shared base class every error the analyze layer throws — `ShAnalyzeMaxDepthError`, `ShAnalyzeInvalidWrapperSpecError` — extends) and `ShNode`/`Position` (the node/position types the subpath's public surface consumes and exposes). A consumer of `sh-ast/analyze` can now `catch`/reference these directly, without also importing from the root `sh-ast` entry point. This also clears the two pre-existing, accepted `ae-forgotten-export` API Extractor warnings at the top of `packages/sh-ast/api-report/sh-ast-analyze.api.md` (see [#23](https://github.com/mike-north/sh-ast/issues/23)).

- [#16](https://github.com/mike-north/sh-ast/pull/16) [`ed46136`](https://github.com/mike-north/sh-ast/commit/ed461361b0527f72cad64d6c2d933630f2671a8b) Thanks [@mike-north](https://github.com/mike-north)! - Add `resolveArgv0` to `sh-ast/analyze`: follows a `CommandSite`'s argv0 through zero or more _transparent wrappers_ (`env`, `sudo`, `nohup`, `nice`, `command`, `exec`, `time`, `timeout`) to the **effective** command actually invoked — the one a permission/policy check must judge, since argv0 alone is trivially spoofable through any of these (`env FOO=1 rm -rf /`, `sudo -u x "$prog"`, …).

  The default wrapper table (`DEFAULT_TRANSPARENT_WRAPPERS`, exported alongside the new `WrapperSpec` type) is plain data — each entry's flag/operand handling is hand-derived from that wrapper's own manual page — and is fully overridable/extensible via `resolveArgv0`'s `transparentWrappers` option; `xargs` is deliberately excluded (its argument-splicing semantics make "the wrapped command" a stdin-dependent, not statically locatable, concept). A statically-unknowable word anywhere in the chain (an expansion, a glob, …) is never guessed through: it becomes `Argv0Resolution.effective` immediately, and `Argv0Resolution.chain` stops there. `Argv0Resolution.assignmentsSkipped` counts `CallExpr.assigns` shell-assignment prefixes (`FOO=bar rm x`), a mechanism distinct from a wrapper's own `VAR=val` operands (`env A=1 rm x`).

  Facts only, matching `resolveWord`'s and `enumerateCommands`'s posture: no safety verdict, no hardcoded "dangerous command" list.

  Hardened against several ways an unrecognized or unusual invocation could previously misreport the effective command:

  - A statically known word shaped like a flag (`-`-prefixed, not `--`) that doesn't match any flag/operand shape a `WrapperSpec` recognizes now makes the whole resolution unresolvable (`Argv0Resolution.effective` becomes `{ static: false, reason: 'unknown-flag' }`), instead of being silently treated as the wrapped command — e.g. `sudo -D /tmp rm x` (`-D` isn't a modeled `sudo` flag) no longer reports `rm` as effective. `Argv0ChainWord` and the new `Argv0UnresolvedReason`/`Argv0UnresolvedWord` types widen `Argv0Resolution.chain`/`.effective` to carry this.
  - `argFlags` now recognizes every standard getopt short-option form, not just the exact and separate-word forms: attached (`-uuser`), clustered with preceding no-operand flags (`-Eu user`/`-Euuser`), matching real option parsing.
  - `env`'s `-S`/`--split-string` is no longer modeled as an ordinary operand-taking flag: its value splices into the invoked command's own argv (GNU env(1)), so the real command is embedded inside the operand text, not a separate word — it now reports `reason: 'embedded-command'` instead of guessing.
  - `command -v`/`-V` (which print information about a command name rather than execute it) now correctly stop the chain at `command` itself via the new `WrapperSpec.stopsChainFlags` field, instead of continuing to whatever word follows.
  - `WrapperSpec.names` matching is now documented as exact-name-only (`sudo` never matches `/usr/bin/sudo`), and `DEFAULT_TRANSPARENT_WRAPPERS` is now deep-frozen.
  - A caller-supplied `transparentWrappers` table with a malformed entry now throws the new `ShAnalyzeInvalidWrapperSpecError` at the `resolveArgv0` boundary, instead of failing confusingly deep inside flag matching.

- [#21](https://github.com/mike-north/sh-ast/pull/21) [`163f842`](https://github.com/mike-north/sh-ast/commit/163f84286e265098e45963df3254c3a777a62651) Thanks [@mike-north](https://github.com/mike-north)! - Renamed the public error taxonomy exported from `sh-ast` to drop pre-spinout `eslint-sh`/`@eslint-sh/bridge` naming, now that this package ships standalone. This is a breaking rename with **no back-compat aliases** — 0.x, so it ships as `minor` rather than `major` per this repo's pre-1.0 policy.

  `code` string literals:

  - `ESLINT_SH_PARSE_ERROR` → `SH_AST_PARSE_ERROR`
  - `ESLINT_SH_INVALID_DIALECT` → `SH_AST_INVALID_DIALECT`
  - `ESLINT_SH_BRIDGE_INTERNAL` → `SH_AST_INTERNAL`
  - `ESLINT_SH_ANALYZE_MAX_DEPTH` → `SH_AST_ANALYZE_MAX_DEPTH`
  - `ESLINT_SH_PARSE_MAX_DEPTH` → `SH_AST_PARSE_MAX_DEPTH`
  - `ESLINT_SH_ANALYZE_INVALID_WRAPPER_SPEC` → `SH_AST_ANALYZE_INVALID_WRAPPER_SPEC`

  Class renames:

  - `ShBridgeError` (abstract base) → `ShAstError`
  - `ShBridgeInternalError` → `ShInternalError`

  All other exported error classes (`ShParseError`, `ShInvalidDialectError`, `ShAnalyzeMaxDepthError`, `ShParseMaxDepthError`, `ShAnalyzeInvalidWrapperSpecError`) are unchanged — they were already product-neutral. No error semantics, messages, or throw sites changed; this is an identifier rename only.

- [#18](https://github.com/mike-north/sh-ast/pull/18) [`ef343d7`](https://github.com/mike-north/sh-ast/commit/ef343d7d326c4049cf0c3a9f304a3658b085c21a) Thanks [@mike-north](https://github.com/mike-north)! - `parseSync` now rejects pathologically deep/nested shell source (deeply nested subshells, command substitutions, control-flow bodies, or very long pipeline/list chains) with a typed, catchable `ShParseMaxDepthError` (`code: 'SH_AST_PARSE_MAX_DEPTH'`) instead of letting it reach the WASM parser, where sufficiently deep nesting causes an uncatchable native stack overflow. The guard runs a conservative, single-pass estimate of the input's structural nesting depth before ever invoking the shared WASM instance, so pathological input never risks crashing (or wedging) that instance for subsequent calls. Realistic scripts, including deeply-but-legitimately nested ones, are unaffected.

  Hardened against a bypass found in review: an unmatched closer (`}` with no open `{`, or a stray `fi`/`done`/`esac` with no matching opener) previously decremented the depth estimate unconditionally, letting a self-canceling adversarial input (e.g. `case x in a}) ` repeated) silently defeat the guard while the real parser still recursed to a genuine, uncatchable stack overflow — every closer now only decrements state when it actually matches an open region. Also fixed: `|` alternation inside a `case` arm's pattern list (`a|b|c) ...`) was incorrectly counted as pipeline depth, falsely rejecting arms with many alternatives — a real pipeline in the arm's action list still counts correctly.

## 0.1.0

### Minor Changes

- [#11](https://github.com/mike-north/sh-ast/pull/11) [`936c601`](https://github.com/mike-north/sh-ast/commit/936c6014f4f19fd701134d463ec368b6a0add5bb) Thanks [@mike-north](https://github.com/mike-north)! - Add `enumerateCommands` to `sh-ast/analyze`: finds every command invocation (`CallExpr`) reachable from a parsed tree, including ones hidden inside command/process substitutions nested in arguments, redirection targets, case subjects, loop word lists, assignment values, and test/arithmetic operands. Each `CommandSite` reports its resolved words (via `resolveWord`) and a `CommandContext` path describing how it's reached — `&&`/`||`/pipeline position, subshell, if/case branch, loop role, function name, background/negated/coproc — in source order. Facts only: no safety verdict, no command/wrapper allowlist or denylist.

  `enumerateCommands` traverses `|`/`|&`/`&&`/`||` chains of any length iteratively, so a long linear chain never risks a stack overflow. For genuinely nested structure (subshells within subshells, chained command/process substitutions, deeply nested `if`/`case`/loop/function/`time`/`{ }` bodies, chained `elif`), it now throws the new `ShAnalyzeMaxDepthError` rather than crashing or silently returning a truncated result once a defensive nesting-depth guard is exceeded — a fail-closed backstop against pathological/adversarial input.

- [#7](https://github.com/mike-north/sh-ast/pull/7) [`d051af4`](https://github.com/mike-north/sh-ast/commit/d051af42c746f6f42217902678a0407321e4a69a) Thanks [@mike-north](https://github.com/mike-north)! - Add the `sh-ast/analyze` subpath, with `resolveWord` as its first primitive: determines whether a `Word` node is statically a known string (single quoting, `$'...'` ANSI-C escapes, concatenated literals, and `DblQuoted` text with no expansions all count as static) and reports a neutral, extensible reason — `expansion`, `tilde`, `glob`, `brace`, `locale`, or `unsupported` — when it isn't. Bracket expressions (`[...]`) and `$"..."` locale-translated strings are recognized as non-static, and an unrepresentable `$'\U...'` ANSI-C code point reports `unsupported` rather than a false literal. An optional second `options.context` parameter (`'command-argument'` or `'assignment-value'`, default `'assignment-value'`) controls whether an assignment's colon-adjacent tilde (`PATH=/foo:~/bar`) is detected. Built against the pinned mvdan.cc/sh/v3 v3.13.1 parser; reports syntactic facts only, never a safety verdict.

- [#6](https://github.com/mike-north/sh-ast/pull/6) [`6cd00f4`](https://github.com/mike-north/sh-ast/commit/6cd00f4bfcc7cd1e73007ba84e49b42770c66e78) Thanks [@mike-north](https://github.com/mike-north)! - Fix the normalizer dropping `ForClause`/`WhileClause` loop bodies (the `do` statement list). Any `for`, `while`, or `until` loop's body is now reachable on the normalized node's `do` field — previously it was silently omitted entirely.

  Root cause: `normalize.ts`'s `POS_KEYS` denylist listed the bare field name `Do`, but mvdan/sh v3.13.1's `ForClause`/`WhileClause` structs use `Do` for two different fields — `DoPos Pos` (a position, correctly dropped) and `Do []*Stmt` (the loop body, a real child) — so the denylist entry discarded the statement list before it could become a normalized child.

  This changes normalized output for any source containing a `for`/`while`/`until` loop, hence the minor bump.

- [#12](https://github.com/mike-north/sh-ast/pull/12) [`b8bead0`](https://github.com/mike-north/sh-ast/commit/b8bead084c8274bfaf1daa7f2f0e01e0e7031f0b) Thanks [@mike-north](https://github.com/mike-north)! - Replace `normalize.ts`'s hand-maintained `POS_KEYS` bare-name denylist with a generated, per-(node type, field name) `position-fields` table (`tools/gen-visitor-keys`, pinned to mvdan.cc/sh/v3 v3.13.1), so the normalizer never has to guess whether a reused field name is a position from one struct or real data from another.

  This recovers three fields the old denylist wrongly dropped for _every_ node carrying a same-named field, even though none of them is a `Pos` in any mvdan/sh v3.13.1 struct:

  - `ForClause.Select` (`bool`) — marks a `select ... in ...; do ...; done` loop.
  - `WhileClause.Until` (`bool`) — marks an `until ...; do ...; done` loop.
  - `ArithmExp.Unsigned` / `ArithmCmd.Unsigned` (`bool`) — marks mksh's `$((# expr))` / `((# expr))` unsigned arithmetic.

  `Do` (`ForClause`/`WhileClause`'s loop body, issue [#2](https://github.com/mike-north/sh-ast/issues/2)) and `Dollar` (`SglQuoted`/`DblQuoted`'s ANSI-C-quoting flag, issue [#3](https://github.com/mike-north/sh-ast/issues/3)) were already fixed by earlier PRs; this generated table is what makes the whole collision class structurally impossible to reintroduce on a future mvdan/sh bump, rather than requiring another hand audit.

  Normalized output changes for any source containing a `select` loop, an `until` loop, or mksh unsigned arithmetic — previously these booleans were silently omitted — hence the minor bump.

- [#9](https://github.com/mike-north/sh-ast/pull/9) [`e6ceb37`](https://github.com/mike-north/sh-ast/commit/e6ceb377032763c068fa35f8b66b3875d94dda48) Thanks [@mike-north](https://github.com/mike-north)! - Preserve `SglQuoted`/`DblQuoted`'s `Dollar` flag in the normalized AST. `normalize.ts`'s `POS_KEYS` denylist previously stripped the bare field name `Dollar` unconditionally — correct for `ParamExp.Dollar` (a position, already dropped by the generic position check), but wrong for `SglQuoted.Dollar`/`DblQuoted.Dollar`, which are `bool` flags marking `$'...'` (ANSI-C quoting) and `$"..."` (locale translation) respectively. Without the flag, `$'...'` was indistinguishable from plain `'...'` in the normalized tree (and likewise for `$"..."` vs `"..."`).

  A normalized `SglQuoted`/`DblQuoted` node now carries a `dollar` boolean field it previously omitted entirely — a consumer-visible addition to the normalized output shape, hence the minor bump. `sh-ast/analyze`'s `resolveWord` (see its own changeset) is the first consumer that relies on this flag.
