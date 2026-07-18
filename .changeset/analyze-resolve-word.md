---
'sh-ast': minor
---

Add the `sh-ast/analyze` subpath, with `resolveWord` as its first primitive: determines whether a `Word` node is statically a known string (single quoting, `$'...'` ANSI-C escapes, concatenated literals, and `DblQuoted` text with no expansions all count as static) and reports a neutral, extensible reason — `expansion`, `tilde`, `glob`, `brace`, `locale`, or `unsupported` — when it isn't. Bracket expressions (`[...]`) and `$"..."` locale-translated strings are recognized as non-static, and an unrepresentable `$'\U...'` ANSI-C code point reports `unsupported` rather than a false literal. An optional second `options.context` parameter (`'command-argument'` or `'assignment-value'`, default `'assignment-value'`) controls whether an assignment's colon-adjacent tilde (`PATH=/foo:~/bar`) is detected. Built against the pinned mvdan.cc/sh/v3 v3.13.1 parser; reports syntactic facts only, never a safety verdict.
