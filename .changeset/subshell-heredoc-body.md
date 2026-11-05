---
'sh-ast': minor
---

Read pending here-document bodies when the operator's line ends in `(` or `( :`, attaching the body to its original command. Command-substitution scope is unchanged. mvdan/sh remains pinned to v3.13.1 with a maintained subshell parser correction.
