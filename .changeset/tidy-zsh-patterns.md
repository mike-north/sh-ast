---
'sh-ast': minor
---

Preserve Zsh reverse-subscript patterns containing escaped brackets, balanced character classes, and command or parameter expansions. `LangZsh` now retains nested `CmdSubst` and `ParamExp` nodes, so `walk` and `enumerateCommands` can discover commands inside quoted and unquoted patterns. Default and `KeepPadding` printing preserve pattern matching instead of treating character classes as arithmetic; plain and wildcard patterns remain supported.

No API migration is required. Callers inspecting pattern literals should account for nested expansion nodes now being represented explicitly, and command inventories may include previously omitted substitutions.
