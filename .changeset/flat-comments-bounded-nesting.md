---
'sh-ast': minor
---

Cover recursive parameter expansions, arithmetic subscripts/operators, and case-arm action pipelines in the pre-parse resource estimate. Preserve literal parameter/quoted-heredoc contents and independent let arguments instead of counting their punctuation as nesting. Scan flat comment runs iteratively so large comment files can parse without a separate comment-count limit.

The parser remains mvdan/sh v3.13.1 with the official Unicode sentinel backport plus a separately maintained comment-iteration correction. The 150-unit estimate describes tested ordinary caller headroom, not arbitrary caller-stack or serialization-depth safety. Error identity and code remain stable; its message now calls the estimate units rather than stack frames.
