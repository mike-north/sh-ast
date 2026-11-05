---
'sh-ast': minor
---

Restore pre-pin Zsh reverse-subscript analysis while keeping mvdan/sh v3.14.1.
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
in #90.
