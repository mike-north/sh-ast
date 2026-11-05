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
 *   3. `CallExpr.Assigns` prefix counting, distinct from a wrapper's own
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
import { ShAnalyzeInvalidWrapperSpecError } from '../src/index.js';
import { parseSync } from '../src/index.js';
import { syntheticNode } from './analyze-fixtures.js';

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
function site(src: string, dialect?: number): CommandSite {
  const file = parseSync(src, dialect ? { Variant: dialect } : undefined);
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
  // `CallExpr.Args` as an ordinary word, so an unquoted, statement-initial
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

describe('resolveArgv0 — criterion 3: CallExpr.Assigns prefixes are counted separately from a wrapper operand', () => {
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

  it('CallExpr.Assigns prefixes and a wrapper VAR=val operand combine additively', () => {
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
  // The more important `--` semantic — that option parsing STOPS for
  // every later word too, not just that `--` itself is skipped — is
  // covered by the dedicated describe block below ("`--` ends option
  // parsing for the rest of this wrapper scan").

  it('throws TypeError for a CommandSite with an empty argv (programmer misuse, not malformed shell source)', () => {
    const node = syntheticNode('CallExpr', { Args: [], Assigns: [] });
    const emptySite: CommandSite = {
      node,
      argv0: { static: true, text: '' },
      argv: [],
      context: [],
    };
    expect(() => resolveArgv0(emptySite)).toThrow(TypeError);
  });
});

describe('resolveArgv0 — review fix: an unrecognized flag-shaped word never becomes the effective command', () => {
  // The root bug this fix wave addresses: `advancePastWrapperOperands`'s
  // fallback used to treat ANY unplaceable word as the wrapped command —
  // for a static, flag-shaped word this table doesn't recognize, that
  // silently hid the real effective command behind a flag. Verified
  // against each wrapper's own real usage/help output (`sudo -h`; GNU
  // coreutils `env --help`/`nice --help` locally) that these specific
  // flags exist and are genuinely unmodeled, not modeling gaps that should
  // instead be filled in.
  it.each([
    ['command -x rm x', 'command'],
    ['exec -x rm x', 'exec'],
    ['nohup -x rm x', 'nohup'],
    ['nice -x rm x', 'nice'],
    [sh`"time" -x rm x`, 'time'],
    ['timeout -x rm x', 'timeout'],
    // sudo(8) -h documents both of these as real options this table
    // deliberately doesn't model (see sudo's table-entry comment).
    ['sudo -D /tmp rm x', 'sudo'],
    ['sudo --preserve-env=HOME rm x', 'sudo'],
    // GNU env(1) --help documents --default-signal (optional-argument
    // long form), not modeled by this table at all.
    ['env --default-signal rm x', 'env'],
  ] as const)(
    '%s (unrecognized flag for %s) -> effective is unresolvable, not the flag or a later word',
    (src, _wrapper) => {
      const resolution = resolveArgv0(site(src));
      expect(resolution.effective).toEqual({ static: false, reason: 'unknown-flag' });
    },
  );

  it('a plain unrecognized word (not flag-shaped) is still treated as the wrapped command, unaffected by this fix', () => {
    // `env someOrdinaryCommand` — `someOrdinaryCommand` isn't flag-shaped,
    // so it's correctly the wrapped command, exactly as before this fix.
    const resolution = resolveArgv0(site('env someOrdinaryCommand x'));
    expect(chainSummary(resolution)).toEqual(['env', 'someOrdinaryCommand']);
    expect(resolution.effective).toEqual({ static: true, text: 'someOrdinaryCommand' });
  });

  it('an unknown flag several wrappers deep still stops the whole chain there', () => {
    const resolution = resolveArgv0(site('nohup env --default-signal rm x'));
    expect(chainSummary(resolution)).toEqual(['nohup', 'env', '<unknown-flag>']);
    expect(resolution.effective).toEqual({ static: false, reason: 'unknown-flag' });
  });
});

describe('resolveArgv0 — review fix: getopt-standard attached and clustered short-flag forms', () => {
  // Each form below is verified against the real utility empirically:
  // GNU coreutils env(1)/nice(1) locally (`genv -uFOO`, `genv -iv`,
  // `gnice -n10` — all confirmed to behave as modeled here), and sudo(8)'s
  // documented option syntax via `sudo -h` only (sudo itself was never
  // executed).
  it('sudo -ualice rm x (attached short argFlag) -> effective rm', () => {
    const resolution = resolveArgv0(site('sudo -ualice rm x'));
    expect(chainSummary(resolution)).toEqual(['sudo', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('sudo -Eu alice rm x (clustered: -E no-arg + -u taking the next word) -> effective rm', () => {
    const resolution = resolveArgv0(site('sudo -Eu alice rm x'));
    expect(chainSummary(resolution)).toEqual(['sudo', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('sudo -Eualice rm x (clustered with the operand attached to the cluster itself) -> effective rm', () => {
    const resolution = resolveArgv0(site('sudo -Eualice rm x'));
    expect(chainSummary(resolution)).toEqual(['sudo', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('nice -n10 rm x (attached short argFlag) -> effective rm', () => {
    const resolution = resolveArgv0(site('nice -n10 rm x'));
    expect(chainSummary(resolution)).toEqual(['nice', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('env -uFOO rm x (attached short argFlag) -> effective rm', () => {
    const resolution = resolveArgv0(site('env -uFOO rm x'));
    expect(chainSummary(resolution)).toEqual(['env', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('env -iv rm x (clustered: two no-arg flags, no operand) -> effective rm', () => {
    const resolution = resolveArgv0(site('env -iv rm x'));
    expect(chainSummary(resolution)).toEqual(['env', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('exec -aFOO rm x (attached short argFlag) -> effective rm', () => {
    const resolution = resolveArgv0(site('exec -aFOO rm x'));
    expect(chainSummary(resolution)).toEqual(['exec', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('exec -cl rm x (clustered: two no-arg flags) -> effective rm', () => {
    const resolution = resolveArgv0(site('exec -cl rm x'));
    expect(chainSummary(resolution)).toEqual(['exec', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('timeout -k5 10 rm x (attached short argFlag) -> effective rm', () => {
    const resolution = resolveArgv0(site('timeout -k5 10 rm x'));
    expect(chainSummary(resolution)).toEqual(['timeout', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it(sh`"time" -ofile rm x (attached short argFlag) -> effective rm`, () => {
    const resolution = resolveArgv0(site(sh`"time" -ofile rm x`));
    expect(chainSummary(resolution)).toEqual(['time', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('a cluster with one unrecognized character fails the whole match, not a partial guess', () => {
    // `-Ex` for sudo: `-E` is a real noArgFlag, but `x` isn't any
    // recognized sudo flag character — the whole token is unresolvable,
    // matching real getopt's "first bad option char aborts" behavior,
    // rather than partially consuming `-E` and guessing at `x`.
    const resolution = resolveArgv0(site('sudo -Ex rm x'));
    expect(resolution.effective).toEqual({ static: false, reason: 'unknown-flag' });
  });
});

describe('resolveArgv0 — review fix: env -S/--split-string is unresolvable (splice semantics)', () => {
  // GNU env(1) -S/--split-string splices its operand's own words into the
  // invoked command's argv (verified empirically: `env -S 'echo hello
  // world'` runs `echo` with args `hello`/`world`) — the real wrapped
  // command lives *inside* the operand text, not at a separate,
  // identifiable word position, so it can never be honestly reported as
  // "the next word" the way every other argFlags operand can.
  it("env -S 'rm -rf' x does NOT resolve to effective 'x' (or anything else) — it's unresolvable", () => {
    const resolution = resolveArgv0(site(sh`env -S 'rm -rf' x`));
    expect(resolution.effective).toEqual({ static: false, reason: 'embedded-command' });
  });

  it('env --split-string=cmd x is unresolvable too (long attached form)', () => {
    const resolution = resolveArgv0(site(sh`env --split-string=cmd x`));
    expect(resolution.effective).toEqual({ static: false, reason: 'embedded-command' });
  });

  it('env -Secho x is unresolvable too (short attached form, verified empirically against GNU env)', () => {
    const resolution = resolveArgv0(site(sh`env -Secho x`));
    expect(resolution.effective).toEqual({ static: false, reason: 'embedded-command' });
  });

  it('env -S alone (separate word form) is unresolvable', () => {
    const resolution = resolveArgv0(site(sh`env -S 'echo hi'`));
    expect(resolution.effective).toEqual({ static: false, reason: 'embedded-command' });
  });
});

describe('resolveArgv0 — review fix: command -v/-V stop the chain at command itself (prints, never executes)', () => {
  // Bash Reference Manual §4.1: `command -v`/`-V` print information about
  // `command_name` (its path, or a description) rather than execute it —
  // so nothing after `-v`/`-V` is ever the effective command.
  it('command -v rm x -> effective is command itself, not rm', () => {
    const resolution = resolveArgv0(site('command -v rm x'));
    expect(chainSummary(resolution)).toEqual(['command']);
    expect(resolution.effective).toEqual({ static: true, text: 'command' });
  });

  it('command -V rm x -> effective is command itself, not rm', () => {
    const resolution = resolveArgv0(site('command -V rm x'));
    expect(chainSummary(resolution)).toEqual(['command']);
    expect(resolution.effective).toEqual({ static: true, text: 'command' });
  });

  it('command rm x (no -v/-V) still resolves through to rm, unaffected', () => {
    const resolution = resolveArgv0(site('command rm x'));
    expect(chainSummary(resolution)).toEqual(['command', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('command -p -v rm x -> still stops at command (order of an ordinary flag before -v does not matter)', () => {
    const resolution = resolveArgv0(site('command -p -v rm x'));
    expect(chainSummary(resolution)).toEqual(['command']);
    expect(resolution.effective).toEqual({ static: true, text: 'command' });
  });
});

describe('resolveArgv0 — wrappers named by absolute path are followed (issue #66)', () => {
  // Criterion 1: an absolute path whose final segment is a wrapper name is
  // that wrapper. Expected chains are hand-derived from the source text.
  it('/usr/bin/env bash x -> follows env; the chain keeps the word as written (criterion 3)', () => {
    const resolution = resolveArgv0(site('/usr/bin/env bash x'));
    expect(chainSummary(resolution)).toEqual(['/usr/bin/env', 'bash']);
    expect(resolution.effective).toEqual({ static: true, text: 'bash' });
    expect(resolution.chainIndices).toEqual([0, 1]);
  });

  it('/usr/bin/env /usr/sbin/useradd bob -> reaches /usr/sbin/useradd', () => {
    const resolution = resolveArgv0(site('/usr/bin/env /usr/sbin/useradd bob'));
    expect(chainSummary(resolution)).toEqual(['/usr/bin/env', '/usr/sbin/useradd']);
    expect(resolution.effective).toEqual({ static: true, text: '/usr/sbin/useradd' });
  });

  it('/usr/bin/sudo -u alice rm x -> follows sudo and its -u operand', () => {
    const resolution = resolveArgv0(site('/usr/bin/sudo -u alice rm x'));
    expect(chainSummary(resolution)).toEqual(['/usr/bin/sudo', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
    expect(resolution.chainIndices).toEqual([0, 3]);
  });

  it('/usr/bin/nice -n 5 rm x -> follows nice and its -n operand', () => {
    const resolution = resolveArgv0(site('/usr/bin/nice -n 5 rm x'));
    expect(chainSummary(resolution)).toEqual(['/usr/bin/nice', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('the wrapper grammar still applies behind the path: /usr/bin/env -i A=1 rm x', () => {
    const resolution = resolveArgv0(site('/usr/bin/env -i A=1 rm x'));
    expect(chainSummary(resolution)).toEqual(['/usr/bin/env', 'rm']);
  });

  it('absolute-path and bare wrappers nest: /usr/bin/nohup env /usr/bin/nice rm x', () => {
    const resolution = resolveArgv0(site('/usr/bin/nohup env /usr/bin/nice rm x'));
    expect(chainSummary(resolution)).toEqual(['/usr/bin/nohup', 'env', '/usr/bin/nice', 'rm']);
  });

  it('a doubled slash still ends in the wrapper name: /usr//bin/env rm x', () => {
    const resolution = resolveArgv0(site('/usr//bin/env rm x'));
    expect(chainSummary(resolution)).toEqual(['/usr//bin/env', 'rm']);
  });

  it('a quoted absolute path is the same static word: "/usr/bin/env" rm x', () => {
    const resolution = resolveArgv0(site('"/usr/bin/env" rm x'));
    expect(chainSummary(resolution)).toEqual(['/usr/bin/env', 'rm']);
  });

  it('a multibyte directory does not disturb the final segment: /opt/日本語/🚀/env rm x', () => {
    const resolution = resolveArgv0(site('/opt/日本語/🚀/env rm x'));
    expect(chainSummary(resolution)).toEqual(['/opt/日本語/🚀/env', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('a multibyte final segment is not a wrapper name: /usr/bin/envé rm x', () => {
    const resolution = resolveArgv0(site('/usr/bin/envé rm x'));
    expect(chainSummary(resolution)).toEqual(['/usr/bin/envé']);
  });

  // Criterion 2: relative paths are not followed. Checked against bash and
  // zsh on macOS: with files ./env and bin/env present, `./env b` and
  // `bin/env a` run those local files, not env(1).
  it('bin/env rm x -> a relative path with a directory is NOT followed', () => {
    const resolution = resolveArgv0(site('bin/env rm x'));
    expect(chainSummary(resolution)).toEqual(['bin/env']);
    expect(resolution.effective).toEqual({ static: true, text: 'bin/env' });
  });

  it('./sudo -u alice rm x -> NOT followed', () => {
    const resolution = resolveArgv0(site('./sudo -u alice rm x'));
    expect(chainSummary(resolution)).toEqual(['./sudo']);
    expect(resolution.effective).toEqual({ static: true, text: './sudo' });
  });

  it('../env rm x -> NOT followed', () => {
    expect(chainSummary(resolveArgv0(site('../env rm x')))).toEqual(['../env']);
  });

  // Negative cases for the absolute rule itself.
  it('an absolute path ending in a slash has no final segment: /usr/bin/env/ rm x', () => {
    const resolution = resolveArgv0(site('/usr/bin/env/ rm x'));
    expect(chainSummary(resolution)).toEqual(['/usr/bin/env/']);
  });

  it('the root and a non-wrapper absolute path are ordinary commands', () => {
    expect(chainSummary(resolveArgv0(site('/ rm x')))).toEqual(['/']);
    expect(chainSummary(resolveArgv0(site('/usr/bin/printenv rm x')))).toEqual([
      '/usr/bin/printenv',
    ]);
  });

  // Criterion 4: a dynamic path stays unresolved.
  it('"$dir/env" rm x -> dynamic word, never matched', () => {
    const resolution = resolveArgv0(site('"$dir/env" rm x'));
    expect(chainSummary(resolution)).toEqual(['<expansion>']);
    expect(resolution.effective).toEqual({ static: false, reason: 'expansion' });
  });

  it('/usr/bin/$tool rm x -> dynamic final segment, never matched', () => {
    const resolution = resolveArgv0(site('/usr/bin/$tool rm x'));
    expect(resolution.effective).toEqual({ static: false, reason: 'expansion' });
  });

  it('/usr/bin/env "$cmd" x -> stops at the dynamic word behind the wrapper', () => {
    const resolution = resolveArgv0(site('/usr/bin/env "$cmd" x'));
    expect(chainSummary(resolution)).toEqual(['/usr/bin/env', '<expansion>']);
  });

  it('a table that omits env does not follow /usr/bin/env either', () => {
    const noEnv = DEFAULT_TRANSPARENT_WRAPPERS.filter((w) => !w.names.includes('env'));
    const resolution = resolveArgv0(site('/usr/bin/env rm x'), { transparentWrappers: noEnv });
    expect(chainSummary(resolution)).toEqual(['/usr/bin/env']);
  });

  it('a name listed verbatim in a custom table still matches, relative included', () => {
    const custom: readonly WrapperSpec[] = [{ names: ['./with-retry'] }];
    const resolution = resolveArgv0(site('./with-retry rm x'), { transparentWrappers: custom });
    expect(chainSummary(resolution)).toEqual(['./with-retry', 'rm']);
  });

  // Exact entries select a caller's grammar before any basename fallback,
  // even when the fallback entry appears earlier in the table.
  it.each([false, true])('an exact path grammar wins with exact-first=%s', (exactFirst) => {
    const generic: WrapperSpec = { names: ['with-retry'], noArgFlags: ['-q'] };
    const exact: WrapperSpec = { names: ['/opt/with-retry'], stopsChainFlags: ['-q'] };
    const wrappers: readonly WrapperSpec[] = exactFirst ? [exact, generic] : [generic, exact];
    const resolution = resolveArgv0(site('/opt/with-retry -q task'), {
      transparentWrappers: wrappers,
    });
    expect(chainSummary(resolution)).toEqual(['/opt/with-retry']);
    expect(resolution.chainIndices).toEqual([0]);
    expect(resolution.effective).toEqual({ static: true, text: '/opt/with-retry' });
  });

  it('an explicitly listed relative path uses its own operand grammar', () => {
    const wrappers: readonly WrapperSpec[] = [{ names: ['./with-retry'], argFlags: ['-n'] }];
    const resolution = resolveArgv0(site('./with-retry -n 3 task'), {
      transparentWrappers: wrappers,
    });
    expect(chainSummary(resolution)).toEqual(['./with-retry', 'task']);
    expect(resolution.chainIndices).toEqual([0, 3]);
    expect(resolution.effective).toEqual({ static: true, text: 'task' });
  });

  // Names express a lexical analysis assumption, not executable validity.
  // A caller can explicitly supply a spelling that has no basename match.
  it('an explicitly listed trailing-slash name matches exactly', () => {
    const wrappers: readonly WrapperSpec[] = [{ names: ['/opt/with-retry/'] }];
    const resolution = resolveArgv0(site('/opt/with-retry/ task'), {
      transparentWrappers: wrappers,
    });
    expect(chainSummary(resolution)).toEqual(['/opt/with-retry/', 'task']);
    expect(resolution.chainIndices).toEqual([0, 1]);
    expect(resolution.effective).toEqual({ static: true, text: 'task' });
  });

  it('a custom plain name acquires absolute aliases but no relative or trailing-slash aliases', () => {
    const wrappers: readonly WrapperSpec[] = [{ names: ['with-retry'], argFlags: ['-n'] }];
    const resolution = resolveArgv0(site('/opt/tools/with-retry -n 3 task'), {
      transparentWrappers: wrappers,
    });
    expect(chainSummary(resolution)).toEqual(['/opt/tools/with-retry', 'task']);
    expect(resolution.chainIndices).toEqual([0, 3]);
    expect(resolution.effective).toEqual({ static: true, text: 'task' });
    for (const command of ['./with-retry', 'bin/with-retry', '/opt/tools/with-retry/']) {
      const unmatched = resolveArgv0(site(`${command} task`), {
        transparentWrappers: wrappers,
      });
      expect(chainSummary(unmatched)).toEqual([command]);
      expect(unmatched.chainIndices).toEqual([0]);
      expect(unmatched.effective).toEqual({ static: true, text: command });
    }
  });

  it('a custom path-only name does not acquire other paths with the same basename', () => {
    const wrappers: readonly WrapperSpec[] = [{ names: ['/opt/with-retry'] }];
    const resolution = resolveArgv0(site('/other/with-retry task'), {
      transparentWrappers: wrappers,
    });
    expect(chainSummary(resolution)).toEqual(['/other/with-retry']);
    expect(resolution.chainIndices).toEqual([0]);
    expect(resolution.effective).toEqual({ static: true, text: '/other/with-retry' });
  });
});

describe('resolveArgv0 — review fix: truncated/malformed invocations resolve to the wrapper itself', () => {
  it('sudo -u (trailing argFlag with no operand at all) -> effective is sudo itself', () => {
    const resolution = resolveArgv0(site('sudo -u'));
    expect(resolution.chain).toEqual([{ static: true, text: 'sudo' }]);
    expect(resolution.effective).toEqual({ static: true, text: 'sudo' });
  });

  it('env -u (trailing argFlag with no operand at all) -> effective is env itself', () => {
    const resolution = resolveArgv0(site('env -u'));
    expect(resolution.chain).toEqual([{ static: true, text: 'env' }]);
    expect(resolution.effective).toEqual({ static: true, text: 'env' });
  });

  it('timeout -k 5 (missing the mandatory DURATION positional) -> effective is timeout itself', () => {
    const resolution = resolveArgv0(site('timeout -k 5'));
    expect(resolution.chain).toEqual([{ static: true, text: 'timeout' }]);
    expect(resolution.effective).toEqual({ static: true, text: 'timeout' });
  });
});

describe('resolveArgv0 — review fix: a WrapperSpec with multiple names is followed through either alias', () => {
  it('a custom two-name wrapper resolves through its second, non-first name', () => {
    const aliasedWrapper: WrapperSpec = { names: ['run-safely', 'rs'] };
    const customWrappers: readonly WrapperSpec[] = [
      ...DEFAULT_TRANSPARENT_WRAPPERS,
      aliasedWrapper,
    ];
    const resolution = resolveArgv0(site('rs rm x'), { transparentWrappers: customWrappers });
    expect(chainSummary(resolution)).toEqual(['rs', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('the same wrapper also resolves through its first name (both aliases behave identically)', () => {
    const aliasedWrapper: WrapperSpec = { names: ['run-safely', 'rs'] };
    const customWrappers: readonly WrapperSpec[] = [
      ...DEFAULT_TRANSPARENT_WRAPPERS,
      aliasedWrapper,
    ];
    const resolution = resolveArgv0(site('run-safely rm x'), {
      transparentWrappers: customWrappers,
    });
    expect(chainSummary(resolution)).toEqual(['run-safely', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });
});

describe('resolveArgv0 — review fix: DEFAULT_TRANSPARENT_WRAPPERS is frozen', () => {
  it('mutating a top-level entry throws (strict mode)', () => {
    const entry = DEFAULT_TRANSPARENT_WRAPPERS[0];
    expect(entry).toBeDefined();
    expect(() => {
      // @ts-expect-error — intentionally violating readonly to prove the
      // runtime freeze, not just the compile-time type, is enforced.
      entry.names = ['nonsense'];
    }).toThrow(TypeError);
  });

  it("mutating a nested array field (e.g. an entry's names array) throws too — deepFreeze, not a shallow Object.freeze", () => {
    const entry = DEFAULT_TRANSPARENT_WRAPPERS.find((w) => w.names.includes('env'));
    expect(entry).toBeDefined();
    // Explicit mutable-view cast (not `@ts-expect-error`) — intentionally
    // testing runtime immutability of a `readonly string[]` field, which
    // needs a real (typed, not suppressed) escape hatch to call a mutating
    // method the compile-time type otherwise correctly forbids.
    const mutableNames = entry?.names as string[] | undefined;
    expect(() => {
      mutableNames?.push('nonsense');
    }).toThrow(TypeError);
  });
});

describe('resolveArgv0 — review fix: malformed injected WrapperSpec entries throw a typed error', () => {
  it.each([
    ['names missing entirely', {} as WrapperSpec],
    ['names is not an array', { names: 'env' } as unknown as WrapperSpec],
    ['names is an empty array', { names: [] }],
    ['names contains an empty string', { names: [''] }],
    [
      'noArgFlags is not an array of strings',
      { names: ['x'], noArgFlags: 'bad' as unknown as string[] },
    ],
    [
      'argFlags contains a non-string element',
      { names: ['x'], argFlags: [1] as unknown as string[] },
    ],
    [
      'skipAssignmentOperands is not a boolean',
      { names: ['x'], skipAssignmentOperands: 'yes' as unknown as boolean },
    ],
    [
      'positionalOperandsBeforeCommand is not a non-negative integer',
      { names: ['x'], positionalOperandsBeforeCommand: -1 },
    ],
  ] as const)('%s throws ShAnalyzeInvalidWrapperSpecError', (_label, malformedSpec) => {
    expect(() => resolveArgv0(site('rm x'), { transparentWrappers: [malformedSpec] })).toThrow(
      ShAnalyzeInvalidWrapperSpecError,
    );
  });

  it('a well-formed custom table does not throw', () => {
    expect(() =>
      resolveArgv0(site('rm x'), { transparentWrappers: [{ names: ['ok'] }] }),
    ).not.toThrow();
  });

  it('exposes code === "SH_AST_ANALYZE_INVALID_WRAPPER_SPEC" (rename: eslint-sh#17)', () => {
    const invoke = () => resolveArgv0(site('rm x'), { transparentWrappers: [{} as WrapperSpec] });
    expect(invoke).toThrow(ShAnalyzeInvalidWrapperSpecError);
    let caught: unknown;
    try {
      invoke();
    } catch (error) {
      caught = error;
    }
    expect((caught as ShAnalyzeInvalidWrapperSpecError).code).toBe(
      'SH_AST_ANALYZE_INVALID_WRAPPER_SPEC',
    );
  });

  it('the default table (no transparentWrappers override) is never validated at runtime — only caller-supplied tables are', () => {
    // DEFAULT_TRANSPARENT_WRAPPERS is trusted, well-formed data this
    // package ships — validation exists to fail closed on *caller*
    // mistakes, not to re-check this package's own built-in table on
    // every call.
    expect(() => resolveArgv0(site('env A=1 rm x'))).not.toThrow();
  });
});

describe('resolveArgv0 — review fix: `--` ends option parsing for the rest of this wrapper scan (Copilot PR #16 review)', () => {
  // Every wrapper's own manual page documents `--` as the standard
  // getopt(3)/getopt_long(3) end-of-options marker: once seen, everything
  // that follows is an ordinary operand, even if it's shaped like a flag
  // (starts with `-`) — that's the entire point of `--` (POSIX Utility
  // Syntax Guidelines, guideline 10; sudo(8): "the command line arguments
  // after the -- are passed to the command as-is"). The pre-fix behavior
  // skipped `--` itself but kept recognizing later words as this wrapper's
  // own flags, so `sudo -- -u alice rm` incorrectly consumed `-u alice` as
  // sudo's own `-u` option instead of treating `-u` as the wrapped
  // command's (literal) argv0.
  it('sudo -- -u alice rm -> chain [sudo, -u], effective is a command literally named "-u", NOT sudo -u parsed as an option', () => {
    const resolution = resolveArgv0(site('sudo -- -u alice rm'));
    expect(resolution.chain).toEqual([
      { static: true, text: 'sudo' },
      { static: true, text: '-u' },
    ]);
    expect(resolution.effective).toEqual({ static: true, text: '-u' });
  });

  it('env -- -i cmd -> chain [env, -i], effective is a command literally named "-i", NOT env -i parsed as an option', () => {
    const resolution = resolveArgv0(site('env -- -i cmd'));
    expect(resolution.chain).toEqual([
      { static: true, text: 'env' },
      { static: true, text: '-i' },
    ]);
    expect(resolution.effective).toEqual({ static: true, text: '-i' });
  });

  it('a required positional operand (timeout DURATION) is still consumed after `--` — `--` ends FLAG parsing, not positional-operand parsing', () => {
    const resolution = resolveArgv0(site('timeout -- 10 rm x'));
    expect(chainSummary(resolution)).toEqual(['timeout', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('an ordinary command word after `--` is still followed as the wrapped command, unaffected by this fix', () => {
    const resolution = resolveArgv0(site('sudo -- rm x'));
    expect(chainSummary(resolution)).toEqual(['sudo', 'rm']);
    expect(resolution.effective).toEqual({ static: true, text: 'rm' });
  });

  it('command -- -v rm -> effective is a command literally named "-v", NOT command\'s own query-mode -v flag (stopsChainFlags no longer applies after `--`)', () => {
    const resolution = resolveArgv0(site('command -- -v rm'));
    expect(chainSummary(resolution)).toEqual(['command', '-v']);
    expect(resolution.effective).toEqual({ static: true, text: '-v' });
  });
});
