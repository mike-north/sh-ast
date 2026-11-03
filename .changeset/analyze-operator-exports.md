---
'sh-ast': minor
---

Export the named operator constants referenced by faithful record types, plus rawOperator, from sh-ast/analyze. Analyze-only consumers can compare and construct operator values without importing the root entry point. Existing types, constant values, operator families and validation behavior are unchanged.
