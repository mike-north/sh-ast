---
'sh-ast': minor
---

Correct `resolveArgv0` assignment-operand recognition for `env` and `sudo` with mvdan/sh v3.13.1 syntax records. Names such as `A-B`, `1X`, and `名` no longer become false effective commands. `env` recognizes assignments after `--` and stops option parsing at its first assignment; `sudo` retains its own option and assignment boundaries. Platform-dependent empty-name `env` assignments now report `ambiguous-assignment`.

Add explicit `WrapperSpec.assignmentOperands` grammar presets while preserving existing caller-supplied `skipAssignmentOperands` behavior. Parse output, shell assignment counts, and command policy remain unchanged.
