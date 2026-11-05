---
'sh-ast': minor
---

Preserve U+0080 and U+0081 as source characters instead of lexer control markers. Both parse APIs now retain later commands and literal contents that could previously be silently truncated, corrupted, or rejected, including quoted heredocs crossing reader boundaries. The parser remains pinned to mvdan/sh v3.13.1 with the official Unicode sentinel correction backported; this does not adopt the unrelated grammar or AST changes in v3.14.
