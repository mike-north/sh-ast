---
'sh-ast': minor
---

Add readonly `chainIndices` to `resolveArgv0` results, identifying each chain word or synthesized failure's triggering argument in `CommandSite.argv`. Preserve existing wrapper resolution and assignment behavior against pinned mvdan/sh v3.13.1; callers can locate a resolved command's arguments without repeating wrapper parsing.
