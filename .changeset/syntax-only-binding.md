---
'sh-ast': minor
---

Keep `sh-ast` a faithful synchronous syntax binding: remove the `sh-ast/analyze`
entry point, analysis implementation, and root analysis error classes. Word,
command, wrapper, and interpreter analysis is owned by the independent
`mike-north/sh-analysis` repository and selected package `sh-analysis`. Syntax
records, constants, parsing, traversal, printing, and binding errors remain at
the root. There are no forwarding aliases or compatibility layer.
