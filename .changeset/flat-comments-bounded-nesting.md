---
'sh-ast': minor
---

Replace the lexical pre-scan with a fixed 128-unit native node-nesting budget for both parse operations. Preserve `ShParseMaxDepthError`, its code, and constructor signature; `maxDepth` now means the native budget and the historically named `estimatedDepth` carries the rejected native work count. Resource refusals contain no partial File or position sidecar and leave subsequent parses usable. Grammar errors encountered first retain their ordinary precedence. Some valid inputs accepted by the former 150-unit lexical policy now exceed the native budget.

Keep mvdan/sh v3.13.1 with separate official Unicode-sentinel and nesting backports, plus owned comment-iteration and binding-budget adaptations. Flat comment runs parse iteratively without a comment-count limit. The budget is an empirical constraint tested with repeated ordinary direct and ESLint calls, not a universal guarantee for arbitrary caller stacks, constructed ASTs, or other recursive operations.
