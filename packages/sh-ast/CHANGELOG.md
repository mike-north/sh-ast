# sh-ast

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
