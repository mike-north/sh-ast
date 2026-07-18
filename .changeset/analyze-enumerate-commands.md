---
'sh-ast': minor
---

Add `enumerateCommands` to `sh-ast/analyze`: finds every command invocation (`CallExpr`) reachable from a parsed tree, including ones hidden inside command/process substitutions nested in arguments, redirection targets, case subjects, loop word lists, assignment values, and test/arithmetic operands. Each `CommandSite` reports its resolved words (via `resolveWord`) and a `CommandContext` path describing how it's reached — `&&`/`||`/pipeline position, subshell, if/case branch, loop role, function name, background/negated/coproc — in source order. Facts only: no safety verdict, no command/wrapper allowlist or denylist.

`enumerateCommands` traverses `|`/`|&`/`&&`/`||` chains of any length iteratively, so a long linear chain never risks a stack overflow. For genuinely nested structure (subshells within subshells, chained command/process substitutions, deeply nested `if`/`case`/loop/function/`time`/`{ }` bodies, chained `elif`), it now throws the new `ShAnalyzeMaxDepthError` rather than crashing or silently returning a truncated result once a defensive nesting-depth guard is exceeded — a fail-closed backstop against pathological/adversarial input.
