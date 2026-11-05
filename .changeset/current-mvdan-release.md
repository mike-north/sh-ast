---
'sh-ast': minor
---

Move the mvdan/sh source pin to v3.14.1, retaining the native resource budget and maintained parser/printer corrections. This 0.x minor adds required `ParamExp.Split`, `GlobSubst`, and `RcExpand` option-state fields, exports `OptState` and its constants, and adopts corrected source bounds and `IfClause.Last` traversal.

Accept array elements such as `target=(${target//@/ }[0])`, correct quoted arguments inside backticks, and retain the release's heredoc printer improvements, including internal tabs. Default output changes for backtick quoting and separated closing parentheses; KeepPadding also uses recorded command-substitution close columns. Missing heredoc terminators remain parse errors on this tag. Preserve existing constructed split-literal backslash printing pending a separate compatibility decision.

Accept the measured correctness/performance tradeoff: in the fixed ten-cell campaign, nested parse increased from 0.165666 to 0.1727085 ms (1.0425102314294852x, +4.251023142948517%), nested print from 0.9797085 to 0.9834375 ms (1.0038062342012737x), and consumer parse from 6.434646 to 6.496354 ms (1.0095899603490068x, +0.061708 ms). The other seven aggregates decreased; consumer print decreased by 4.6534785 ms. The original strict comparison remains FAIL, and these observations do not establish non-regression. All ten cells, paired rounds and unchanged raw samples are retained in `design/validation/mvdan-3.14.1/`.
