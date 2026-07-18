/**
 * Tests for {@link resolveArgv0} (`sh-ast/analyze`) against the acceptance
 * criteria in https://github.com/mike-north/eslint-sh/issues/5.
 *
 * Criterion -> test mapping (see this PR's description for the full table):
 *
 *   1. Per-default-wrapper positive coverage — the `describe('resolveArgv0
 *      — criterion 1 ...')` block, one `it` per {@link DEFAULT_TRANSPARENT_WRAPPERS}
 *      entry, each hand-derived from that wrapper's own manual page (`@see`
 *      links below and inline per test).
 *   2. Dynamic-in-chain / "never guessed through" — `describe('... criterion
 *      2 ...')`.
 *   3. `CallExpr.assigns` prefix counting, distinct from a wrapper's own
 *      `VAR=val` operands — `describe('... criterion 3 ...')`.
 *   4. Configurability (custom wrapper spec added; default wrapper removed)
 *      — `describe('... criterion 4 ...')`.
 *   5. Nesting through multiple wrappers in one argv — `describe('...
 *      criterion 5 ...')`.
 *   6. tsd coverage lives in `test-d/analyze.test-d.ts`; this file covers
 *      runtime behavior only.
 *
 * All expected `Argv0Resolution` shapes below are hand-derived from the
 * shell source being parsed and each wrapper's own manual page — never
 * captured from running this implementation (see "Spec-First Test
 * Assertions" in this repo's testing conventions; this repo also bans
 * snapshot/gold-master tests as a correctness mechanism).
 *
 * @see https://www.gnu.org/software/bash/manual/bash.html#Bourne-Shell-Builtins — `command`/`exec` (Bash Reference Manual §4.1)
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/utilities/command.html — POSIX `command`
 * @see https://www.gnu.org/software/coreutils/manual/html_node/env-invocation.html — GNU coreutils `env`
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/utilities/env.html — POSIX `env`
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/utilities/nohup.html — POSIX `nohup`
 * @see https://www.gnu.org/software/coreutils/manual/html_node/nice-invocation.html — GNU coreutils `nice`
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/utilities/nice.html — POSIX `nice`
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/utilities/time.html — POSIX `time` utility
 * @see https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html — GNU coreutils `timeout`
 * @see https://www.sudo.ws/docs/man/sudo.man/ — `sudo(8)`
 */
import { describe, expect, it } from 'vitest';
import type { Argv0Resolution, CommandSite, WrapperSpec } from '../src/analyze/index.js';
import {
  DEFAULT_TRANSPARENT_WRAPPERS,
  enumerateCommands,
  resolveArgv0,
} from '../src/analyze/index.js';
import { parseSync } from '../src/index.js';
import type { ShellDialect, ShNode } from '../src/index.js';

const sh = String.raw;

/**
 * Asserts `value` is defined (with `message` as the failure explanation)
 * and returns it narrowed to `T`, without a forbidden non-null assertion —
 * mirrors `analyze-enumerate-commands.test.ts`'s helper of the same
 * name/shape.
 */
function assertDefined<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeDefined();
  if (value === undefined) throw new Error(message);
  return value;
}

/** Parses `src` and returns the sole `CommandSite` it produces. */
function site(src: string, dialect?: ShellDialect): CommandSite {
  const file = parseSync(src, dialect ? { dialect } : undefined);
  const sites = enumerateCommands(file);
  expect(sites, `expected exactly one CommandSite in: ${src}`).toHaveLength(1);
  return assertDefined(sites[0], 'unreachable — length checked above');
}

/** The `.text` (if static) or `.reason` (if not) of every {@link Argv0Resolution.chain} element, in order — a compact, readable summary for assertions. */
function chainSummary(resolution: Argv0Resolution): readonly string[] {
  return resolution.chain.map((word) => (word.static ? word.text : `<${word.reason}>`));
}

describe('resolveArgv0 — criterion 1: each default wrapper follows to its wrapped command', () => {
  // `command [-pVv] command_name [argument ...]` — Bash Reference Manual
  // §4.1 / POSIX `command`. `-p` takes no operand.
  it('command -p rm x -> effective rm, chain [command, rm]', () => {
    const resolution = resolveArgv0(site('command -p rm x'));
    expect(chainSummary(resolution)).toEqual(['command', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
    expect(resolution.assignmentsSkipped).toBe(0);
  });

  // `exec [-cl] [-a name] [command [arguments]]` — Bash Reference Manual
  // §4.1. `-a name` supplies the wrapped command's argv0 and takes `name`
  // as its own operand.
  it('exec -a myname rm x -> effective rm, chain [exec, rm]', () => {
    const resolution = resolveArgv0(site('exec -a myname rm x'));
    expect(chainSummary(resolution)).toEqual(['exec', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  // POSIX `env` §env(1p): `env [-i] [name=value]... [utility [argument...]]`.
  // The exact fixture from issue #5's body.
  it('env A=1 rm x -> effective rm, chain [env, rm]', () => {
    const resolution = resolveArgv0(site('env A=1 rm x'));
    expect(chainSummary(resolution)).toEqual(['env', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  // POSIX `nohup`: `nohup utility [argument...]` — no documented options.
  it('nohup rm x -> effective rm, chain [nohup, rm]', () => {
    const resolution = resolveArgv0(site('nohup rm x'));
    expect(chainSummary(resolution)).toEqual(['nohup', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  // GNU coreutils nice(1): `nice -n adjustment utility [argument...]`.
  it('nice -n 10 rm x -> effective rm, chain [nice, rm]', () => {
    const resolution = resolveArgv0(site('nice -n 10 rm x'));
    expect(chainSummary(resolution)).toEqual(['nice', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  // POSIX `nice`'s legacy attached form: `nice -increment utility` (e.g.
  // `nice -19 command`), still accepted by GNU coreutils nice(1).
  it('nice -10 rm x (legacy attached adjustment) -> effective rm, chain [nice, rm]', () => {
    const resolution = resolveArgv0(site('nice -10 rm x'));
    expect(chainSummary(resolution)).toEqual(['nice', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  // POSIX `time` utility: `time [-p] utility [argument...]` — but bash's
  // *reserved word* `time` is parsed by mvdan/sh as a transparent
  // `TimeClause` (see `enumerate-commands.ts`), never reaching
  // `CallExpr.args` as an ordinary word, so an unquoted, statement-initial
  // `time rm x` never even produces a `CommandSite` whose argv0 reads
  // "time" — it produces one for `rm` directly, with no wrapper to
  // follow. Quoting suppresses bash's reserved-word recognition (Bash
  // Reference Manual §3.1: "the shell reads its input ... recognizing
  // ... reserved words" — recognition requires an unquoted token), so
  // `"time" -p rm x` exercises the standalone `time(1)` utility this
  // wrapper entry targets.
  it('"time" -p rm x (quoted to avoid the bash `time` keyword) -> effective rm, chain [time, rm]', () => {
    const resolution = resolveArgv0(site(sh`"time" -p rm x`));
    expect(chainSummary(resolution)).toEqual(['time', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  // GNU coreutils timeout(1): `timeout [OPTION] DURATION COMMAND [ARG]...`;
  // `-k`/`--kill-after` takes an operand, and `DURATION` is a mandatory
  // positional operand before the wrapped command regardless of how many
  // flags precede it.
  it('timeout -k 5 10 rm x -> effective rm, chain [timeout, rm]', () => {
    const resolution = resolveArgv0(site('timeout -k 5 10 rm x'));
    expect(chainSummary(resolution)).toEqual(['timeout', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  // sudo(8): `-u user` takes an operand.
  it('sudo -u alice rm x -> effective rm, chain [sudo, rm]', () => {
    const resolution = resolveArgv0(site('sudo -u alice rm x'));
    expect(chainSummary(resolution)).toEqual(['sudo', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('every DEFAULT_TRANSPARENT_WRAPPERS entry above has a covering test (canary)', () => {
    // Not a completeness *proof*, but a tripwire: a new default wrapper
    // added to the table without a matching `it` above should be
    // immediately obvious from this failing count, rather than silently
    // shipping without man-page-derived coverage.
    expect(DEFAULT_TRANSPARENT_WRAPPERS).toHaveLength(8);
  });
});

describe('resolveArgv0 — criterion 2: an unknowable word in the chain is never guessed through', () => {
  // The security-critical invariant from issue #5 and design/RULES.md's
  // no-dynamic-invocation spec ("sudo -u x \"$prog\"` (report — sudo is
  // configured transparent, its target is dynamic)"): `sudo`'s wrapped
  // word is a `ParamExp` (`$prog`), so it can never be identified as a
  // further wrapper or resolved to static text. `resolveArgv0` must stop
  // there rather than falling back to `sudo` (or anything else) as the
  // effective command.
  it('sudo -u x "$prog" -> effective is static:false, chain [sudo, <dynamic>]', () => {
    const resolution = resolveArgv0(site(sh`sudo -u x "$prog"`));
    expect(resolution.chain).toEqual([
      { static: true, text: 'sudo' },
      { static: false, reason: 'expansion' },
    ]);
    expect(resolution.effective).toEqual({ static: false, reason: 'expansion' });
  });

  it('a dynamic argv0 itself (no wrapper at all) -> effective is static:false, chain [<dynamic>]', () => {
    const resolution = resolveArgv0(site(sh`"$cmd" arg`));
    expect(resolution.chain).toEqual([{ static: false, reason: 'expansion' }]);
    expect(resolution.effective).toEqual({ static: false, reason: 'expansion' });
    expect(resolution.assignmentsSkipped).toBe(0);
  });

  it('a dynamic word several wrappers deep still stops the chain there, never resolving past it', () => {
    const resolution = resolveArgv0(site(sh`nohup env A=1 "$cmd" arg`));
    expect(chainSummary(resolution)).toEqual(['nohup', 'env', '<expansion>']);
    expect(resolution.effective).toEqual({ static: false, reason: 'expansion' });
  });
});

describe('resolveArgv0 — criterion 3: CallExpr.assigns prefixes are counted separately from a wrapper operand', () => {
  it('FOO=bar rm x -> effective rm, assignmentsSkipped: 1, chain has no wrapper (assigns are not argv words)', () => {
    const resolution = resolveArgv0(site('FOO=bar rm x'));
    expect(resolution.assignmentsSkipped).toBe(1);
    expect(resolution.chain).toEqual([{ static: true, text: 'rm' }]);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('two assignment prefixes are both counted', () => {
    const resolution = resolveArgv0(site('FOO=bar BAZ=qux rm x'));
    expect(resolution.assignmentsSkipped).toBe(2);
  });

  it("env's own VAR=val operand is a distinct mechanism: it is skipped as part of the chain walk, not counted in assignmentsSkipped", () => {
    const resolution = resolveArgv0(site('env A=1 rm x'));
    expect(resolution.assignmentsSkipped).toBe(0);
    expect(chainSummary(resolution)).toEqual(['env', 'rm']);
  });

  it('CallExpr.assigns prefixes and a wrapper VAR=val operand combine additively', () => {
    const resolution = resolveArgv0(site('FOO=bar env A=1 rm x'));
    expect(resolution.assignmentsSkipped).toBe(1);
    expect(chainSummary(resolution)).toEqual(['env', 'rm']);
  });
});

describe('resolveArgv0 — criterion 4: the wrapper table is data, not policy (configurable both directions)', () => {
  it('a custom project-specific wrapper (e.g. `with-retry`) is followed identically to a default entry', () => {
    const customWrappers: readonly WrapperSpec[] = [
      ...DEFAULT_TRANSPARENT_WRAPPERS,
      { names: ['with-retry'] },
    ];
    const resolution = resolveArgv0(site('with-retry rm x'), {
      transparentWrappers: customWrappers,
    });
    expect(chainSummary(resolution)).toEqual(['with-retry', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('without the custom spec, the same source is NOT followed — with-retry is just an ordinary (unknown) command', () => {
    const resolution = resolveArgv0(site('with-retry rm x'));
    expect(chainSummary(resolution)).toEqual(['with-retry']);
    expect(resolution.effective).toEqual({ static: true, text: 'with-retry' });
  });

  it('removing a default wrapper from the table stops following for that wrapper', () => {
    const withoutEnv = DEFAULT_TRANSPARENT_WRAPPERS.filter(
      (wrapper) => !wrapper.names.includes('env'),
    );
    const resolution = resolveArgv0(site('env A=1 rm x'), { transparentWrappers: withoutEnv });
    expect(chainSummary(resolution)).toEqual(['env']);
    expect(resolution.effective).toEqual({ static: true, text: 'env' });
  });

  it('the default table is unaffected by a caller filtering a copy of it (no shared mutable state)', () => {
    // Verifies `DEFAULT_TRANSPARENT_WRAPPERS.filter(...)` in the test above
    // didn't mutate the shared default export itself.
    const resolution = resolveArgv0(site('env A=1 rm x'));
    expect(chainSummary(resolution)).toEqual(['env', 'rm']);
  });
});

describe('resolveArgv0 — criterion 5: nesting through multiple wrappers in one argv, in order', () => {
  it('nohup env A=1 command rm x -> chain [nohup, env, command, rm], effective rm', () => {
    const resolution = resolveArgv0(site('nohup env A=1 command rm x'));
    expect(chainSummary(resolution)).toEqual(['nohup', 'env', 'command', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
    expect(resolution.assignmentsSkipped).toBe(0);
  });

  it('a five-deep nesting order is followed exactly (sudo env nice nohup command rm)', () => {
    const resolution = resolveArgv0(site('sudo env nice nohup command rm x'));
    expect(chainSummary(resolution)).toEqual(['sudo', 'env', 'nice', 'nohup', 'command', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });
});

describe('resolveArgv0 — multibyte fidelity', () => {
  it('follows a wrapper chain to a multibyte wrapped-command name and resolves it exactly', () => {
    const resolution = resolveArgv0(site('env A=1 café🎉 x'));
    expect(chainSummary(resolution)).toEqual(['env', 'café🎉']);
    expect(resolution.effective).toEqual({ static: true, text: 'café🎉' });
  });
});

describe('resolveArgv0 — edge cases', () => {
  it('a bare wrapper with nothing following it stops the chain at the wrapper itself', () => {
    const resolution = resolveArgv0(site('env'));
    expect(resolution.chain).toEqual([{ static: true, text: 'env' }]);
    expect(resolution.effective).toEqual({ static: true, text: 'env' });
  });

  it('a wrapper whose only trailing word is itself a recognized wrapper name continues following', () => {
    const resolution = resolveArgv0(site('command env A=1 rm x'));
    expect(chainSummary(resolution)).toEqual(['command', 'env', 'rm']);
  });

  it('an ordinary command with no wrapper resolves to itself with a single-element chain', () => {
    const resolution = resolveArgv0(site('rm -rf x'));
    expect(resolution.chain).toEqual([{ static: true, text: 'rm' }]);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
    expect(resolution.assignmentsSkipped).toBe(0);
  });

  it("env's GNU long-option attached form (--unset=NAME) is recognized as a single-token flag+operand", () => {
    const resolution = resolveArgv0(site('env --unset=FOO rm x'));
    expect(chainSummary(resolution)).toEqual(['env', 'rm']);
  });

  it("a `--` end-of-options marker doesn't itself count as the wrapped command", () => {
    const resolution = resolveArgv0(site('sudo -- rm x'));
    expect(chainSummary(resolution)).toEqual(['sudo', 'rm']);
  });

  it('throws TypeError for a CommandSite with an empty argv (programmer misuse, not malformed shell source)', () => {
    const loc: ShNode['loc'] = { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } };
    const node: ShNode = { type: 'CallExpr', range: [0, 0], loc, args: [], assigns: [] };
    const emptySite: CommandSite = {
      node,
      argv0: { static: true, text: '' },
      argv: [],
      context: [],
    };
    expect(() => resolveArgv0(emptySite)).toThrow(TypeError);
  });
});
