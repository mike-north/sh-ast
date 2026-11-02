---
'sh-ast': minor
---

Recognize potential brace expansions in `resolveWord`, `enumerateCommands`, and
`resolveArgv0` using mvdan/sh v3.13.1 on private observation copies. Parse records
remain unchanged. Bare words are classified conservatively across dialects;
brace candidates with uncertain backslash handling report `unsupported` rather
than claiming a static command name.
