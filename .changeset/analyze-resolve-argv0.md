---
'sh-ast': minor
---

Add `resolveArgv0` to `sh-ast/analyze`: follows a `CommandSite`'s argv0 through zero or more _transparent wrappers_ (`env`, `sudo`, `nohup`, `nice`, `command`, `exec`, `time`, `timeout`) to the **effective** command actually invoked — the one a permission/policy check must judge, since argv0 alone is trivially spoofable through any of these (`env FOO=1 rm -rf /`, `sudo -u x "$prog"`, …).

The default wrapper table (`DEFAULT_TRANSPARENT_WRAPPERS`, exported alongside the new `WrapperSpec` type) is plain data — each entry's flag/operand handling is hand-derived from that wrapper's own manual page — and is fully overridable/extensible via `resolveArgv0`'s `transparentWrappers` option; `xargs` is deliberately excluded (its argument-splicing semantics make "the wrapped command" a stdin-dependent, not statically locatable, concept). A statically-unknowable word anywhere in the chain (an expansion, a glob, …) is never guessed through: it becomes `Argv0Resolution.effective` immediately, and `Argv0Resolution.chain` stops there. `Argv0Resolution.assignmentsSkipped` counts `CallExpr.assigns` shell-assignment prefixes (`FOO=bar rm x`), a mechanism distinct from a wrapper's own `VAR=val` operands (`env A=1 rm x`).

Facts only, matching `resolveWord`'s and `enumerateCommands`'s posture: no safety verdict, no hardcoded "dangerous command" list.

Hardened against several ways an unrecognized or unusual invocation could previously misreport the effective command:

- A statically known word shaped like a flag (`-`-prefixed, not `--`) that doesn't match any flag/operand shape a `WrapperSpec` recognizes now makes the whole resolution unresolvable (`Argv0Resolution.effective` becomes `{ static: false, reason: 'unknown-flag' }`), instead of being silently treated as the wrapped command — e.g. `sudo -D /tmp rm x` (`-D` isn't a modeled `sudo` flag) no longer reports `rm` as effective. `Argv0ChainWord` and the new `Argv0UnresolvedReason`/`Argv0UnresolvedWord` types widen `Argv0Resolution.chain`/`.effective` to carry this.
- `argFlags` now recognizes every standard getopt short-option form, not just the exact and separate-word forms: attached (`-uuser`), clustered with preceding no-operand flags (`-Eu user`/`-Euuser`), matching real option parsing.
- `env`'s `-S`/`--split-string` is no longer modeled as an ordinary operand-taking flag: its value splices into the invoked command's own argv (GNU env(1)), so the real command is embedded inside the operand text, not a separate word — it now reports `reason: 'embedded-command'` instead of guessing.
- `command -v`/`-V` (which print information about a command name rather than execute it) now correctly stop the chain at `command` itself via the new `WrapperSpec.stopsChainFlags` field, instead of continuing to whatever word follows.
- `WrapperSpec.names` matching is now documented as exact-name-only (`sudo` never matches `/usr/bin/sudo`), and `DEFAULT_TRANSPARENT_WRAPPERS` is now deep-frozen.
- A caller-supplied `transparentWrappers` table with a malformed entry now throws the new `ShAnalyzeInvalidWrapperSpecError` at the `resolveArgv0` boundary, instead of failing confusingly deep inside flag matching.
