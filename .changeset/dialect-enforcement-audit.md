---
'sh-ast': patch
---

Audited and documented dialect enforcement (see issue #27): for each supported dialect (`bash`, `posix`, `mksh`, `bats`, `zsh`), a pinned test matrix (`test/dialect-matrix.test.ts`) and README table (`README.md#dialect-enforcement`) now spell out which constructs mvdan/sh's parser rejects vs accepts per dialect — test clauses `[[ ]]`, regex tests `=~`, array literals, process substitution `<()`, brace expansion, the `function` keyword, C-style `for`, extended globs `@()`, herestrings `<<<`, and `let`.

`[[ ... ]]` and `let` parsing without error under `dialect: 'posix'` is confirmed **accepted-by-design**, not a bridge bug: mvdan/sh has no `checkLang` gate for either keyword, so outside bash-like/mksh/zsh they fall through to ordinary word/command parsing (`[[ a == b ]]` under posix parses as a `CallExpr` calling a command literally named `[[`) — mirroring mvdan/sh's own `LangPOSIX` test fixtures. No runtime parsing behavior changes in this release; this is audit, tests, and docs only.
