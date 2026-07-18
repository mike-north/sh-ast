---
'sh-ast': minor
---

Add the `sh-ast/analyze` subpath, with `resolveWord` as its first primitive: determines whether a `Word` node is statically a known string (single quoting, `$'...'` ANSI-C escapes, concatenated literals, and `DblQuoted` text with no expansions all count as static) and reports a neutral, extensible reason (`expansion`, `tilde`, `glob`, `brace`) when it isn't. Built against the pinned mvdan.cc/sh/v3 v3.13.1 parser; reports syntactic facts only, never a safety verdict.
