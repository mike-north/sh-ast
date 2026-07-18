---
'sh-ast': minor
---

Add `enumerateCommands` to `sh-ast/analyze`: finds every command invocation (`CallExpr`) reachable from a parsed tree, including ones hidden inside command/process substitutions nested in arguments, redirection targets, case subjects, loop word lists, assignment values, and test/arithmetic operands. Each `CommandSite` reports its resolved words (via `resolveWord`) and a `CommandContext` path describing how it's reached — `&&`/`||`/pipeline position, subshell, if/case branch, loop role, function name, background/negated/coproc — in source order. Facts only: no safety verdict, no command/wrapper allowlist or denylist.
