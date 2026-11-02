# Wrapper assignment grammar validation

Issue: [#39](https://github.com/mike-north/sh-ast/issues/39).
Base: `3fecd43` (published package behavior 0.5.0; mvdan/sh v3.13.1).

## Independent ground truth

Expectations are derived from utility sources, not recorded implementation output.
No command in a test fixture is executed.

- [GNU env 9.8](https://github.com/coreutils/coreutils/blob/v9.8/src/env.c#L797)
  scans any equals-bearing word after getopt completes. Its leading `+` option
  specification stops getopt at the first non-option, so options do not resume
  after assignments. An explicit `--` ends only the option phase.
- [FreeBSD env 14.3](https://github.com/freebsd/freebsd-src/blob/releng/14.3/usr.bin/env/env.c#L188)
  uses the same equals-bearing scan, but calls `setenv`.
- [FreeBSD setenv](https://github.com/freebsd/freebsd-src/blob/releng/14.3/lib/libc/stdlib/getenv.c#L556)
  rejects empty names. [glibc putenv](https://github.com/bminor/glibc/blob/glibc-2.42/stdlib/putenv.c#L48)
  instead passes the empty name to
  [the internal environment insertion function](https://github.com/bminor/glibc/blob/glibc-2.42/stdlib/setenv.c#L133).
  Therefore `env =value cmd` cannot produce a portable effective-command fact.
- [sudo 1.9.17p2](https://github.com/sudo-project/sudo/blob/v1.9.17p2/src/parse_args.c#L263)
  recognizes equals-bearing operands except those beginning with `/` or `=`.
  Its `!got_end_of_args && is_envar` branch resumes getopt after each assignment,
  but never recognizes assignments after `--`.

The `env` and `sudo` presets encode these complete assignment scanning grammars,
not all behavior of those utilities. No command-name branch is added to the
resolver. The legacy boolean retains the ASCII shell-identifier rule before
`--`; an explicit preset takes precedence.

## Default-wrapper audit

`nice`, `timeout`, `nohup`, `command`, `exec`, and standalone `time` have no
assignment-operand setting in the default table. Their existing cited grammars
take the command after their options (and `timeout`'s duration); a later
`A-B=1` therefore remains a command word rather than being silently skipped.
The `does not invent assignment operands for other defaults` fixtures cover all
six. Shell `CallExpr.Assigns` is separate and remains counted independently.

## Outcome evidence

`test/analyze-wrapper-assignments.test.ts` contains 44 source-derived outcomes:

- Utility names with hyphens, leading digits, emoji/CJK/combining marks.
- Shell prefix count unchanged; dynamic operands remain unresolved.
- Empty-name ambiguity before and after `--`.
- Env's permanent option boundary, including assignment-looking flag spellings.
- Sudo's `/` and `=` exclusions, resumed options, and `--` boundary.
- Other defaults unchanged; old caller boolean behavior preserved.
- Caller-named grammar presets and invalid grammar boundary rejection.

Tests were added before implementation. On unchanged source, 26 failed and 18
passed. After implementation, all 44 and the existing 86 argv0 tests passed.
Type tests cover allowed presets, invalid presets, and the new unresolved reason.

Full validation used Node 22.13.0 and pnpm 11.12.0: `pnpm build`, `pnpm check`,
and `pnpm test` passed (710 runtime tests plus tsd). API reports and docs were
regenerated with `NX_SKIP_NX_CACHE=true`; the generated declaration includes the
grammar property and unresolved reason, and the generated property page includes
all three grammar contracts. The committed WASM is unchanged. Generated API/docs
retain their existing CRLF convention (`git -c core.whitespace=cr-at-eol diff
--check` passes).

## Limits

This correction does not model additional utility options, shell environment
policies, runtime command lookup, or successful execution. Unknown flags remain
unresolved. Presets describe the pinned source behavior above and remain
overridable through caller-owned wrapper tables.
