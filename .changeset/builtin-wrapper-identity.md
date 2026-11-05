---
'sh-ast': minor
---

Add `WrapperSpec.shellBuiltin` to identify shell builtin wrappers and exclude them from absolute-path basename matching. The default `command` and `exec` entries now match only exact names, so `/tmp/command eval "$x"` resolves to `/tmp/command` rather than `eval`. Custom tables can mark their own builtins; omitted or false retains existing utility matching. mvdan/sh remains pinned to v3.13.1.
