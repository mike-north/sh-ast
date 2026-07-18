---
'sh-ast': minor
---

Add `resolveArgv0` to `sh-ast/analyze`: follows a `CommandSite`'s argv0 through zero or more _transparent wrappers_ (`env`, `sudo`, `nohup`, `nice`, `command`, `exec`, `time`, `timeout`) to the **effective** command actually invoked — the one a permission/policy check must judge, since argv0 alone is trivially spoofable through any of these (`env FOO=1 rm -rf /`, `sudo -u x "$prog"`, …).

The default wrapper table (`DEFAULT_TRANSPARENT_WRAPPERS`, exported alongside the new `WrapperSpec` type) is plain data — each entry's flag/operand handling is hand-derived from that wrapper's own manual page — and is fully overridable/extensible via `resolveArgv0`'s `transparentWrappers` option; `xargs` is deliberately excluded (its argument-splicing semantics make "the wrapped command" a stdin-dependent, not statically locatable, concept). A statically-unknowable word anywhere in the chain (an expansion, a glob, …) is never guessed through: it becomes `Argv0Resolution.effective` immediately, and `Argv0Resolution.chain` stops there. `Argv0Resolution.assignmentsSkipped` counts `CallExpr.assigns` shell-assignment prefixes (`FOO=bar rm x`), a mechanism distinct from a wrapper's own `VAR=val` operands (`env A=1 rm x`).

Facts only, matching `resolveWord`'s and `enumerateCommands`'s posture: no safety verdict, no hardcoded "dangerous command" list.
