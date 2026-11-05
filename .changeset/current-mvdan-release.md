---
'sh-ast': minor
---

Move the mvdan/sh source pin to v3.14.1, retaining the native resource budget and maintained parser/printer corrections. This 0.x minor adds required `ParamExp.Split`, `GlobSubst`, and `RcExpand` option-state fields, exports `OptState` and its constants, and adopts corrected source bounds and `IfClause.Last` traversal.

Accept array elements such as `target=(${target//@/ }[0])`, correct quoted arguments inside backticks, and retain the release's heredoc printer improvements, including internal tabs. Default output changes for backtick quoting and separated closing parentheses; KeepPadding also uses recorded command-substitution close columns. Missing heredoc terminators remain parse errors on this tag. Preserve existing constructed split-literal backslash printing pending a separate compatibility decision.
