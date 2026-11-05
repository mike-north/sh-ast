---
'sh-ast': minor
---

Preserve literal vertical tabs and form feeds when printing quoted strings, unquoted words, here-document bodies, and embedded comment text. These bytes previously became spaces or newlines, changing shell values and sometimes exposing comment text as commands. Written ANSI-C escapes retain their existing spelling. mvdan/sh remains pinned to v3.13.1 with a maintained printer correction; no API shape changes.
