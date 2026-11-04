/**
 * Tests for shell-interpreter `-c` detection in {@link resolveArgv0}
 * (https://github.com/mike-north/sh-ast/issues/42): `bash -c 'rm x'` reports
 * `'embedded-command'` in the same shape `env -S` does, and invocations that
 * only *look* like `-c` (a script operand, `--`, `-o c`) keep resolving to
 * the interpreter.
 *
 * Every expected value is hand-written from the shells' option grammars and
 * was cross-checked by running the real shell: bash 5.2.21, dash 0.5.12, zsh
 * 5.9, ksh93u+m 1.0.8 and mksh R59. The bash cross-check is repeated live by
 * the oracle block at the bottom (skipped where bash is not installed); the
 * other shells are cited per case in comments.
 *
 * Acceptance criterion -> test mapping:
 *   1. `-c` forms, clusters, option operands, `--`, login shells — the
 *      "embedded" describe blocks.
 *   2. Non-embedded stays unchanged — "not embedded" block.
 *   3. Paths and `env` — "paths" block.
 *   4. Result shape — "result shape" block.
 *   6. Old results asserted deliberately — "overrides" block (empty table
 *      restores the previous result).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Argv0Resolution, CommandSite } from '../src/analyze/index.js';
import {
  DEFAULT_EMBEDDED_COMMAND_INTERPRETERS,
  enumerateCommands,
  resolveArgv0,
} from '../src/analyze/index.js';
import { ShAnalyzeInvalidWrapperSpecError, parseSync } from '../src/index.js';

const sh = String.raw;

/** Parses `src` and returns its sole `CommandSite`. */
function site(src: string): CommandSite {
  const sites = enumerateCommands(parseSync(src));
  expect(sites, `expected exactly one CommandSite in: ${src}`).toHaveLength(1);
  return sites[0];
}

/** Each chain element's text, or `<reason>` for an unresolved one. */
function chainSummary(resolution: Argv0Resolution): readonly string[] {
  return resolution.chain.map((word) => (word.static ? word.text : `<${word.reason}>`));
}

const EMBEDDED = { static: false, reason: 'embedded-command' } as const;

describe('interpreter -c — embedded (criterion 1)', () => {
  // Each row: source, expected chain, expected chainIndices. The last index is
  // the word that selects `-c`, per the `env -S` convention.
  const rows: readonly (readonly [string, readonly string[], readonly number[]])[] = [
    [sh`bash -c "$x"`, ['bash', '<embedded-command>'], [0, 1]],
    [sh`bash -ec 'ls'`, ['bash', '<embedded-command>'], [0, 1]],
    [sh`sh -c ls`, ['sh', '<embedded-command>'], [0, 1]],
    // Clusters: `c` anywhere in the word (bash, dash, zsh, ksh, mksh all run
    // the operand for `-xec`, `-ce`, `-lc`).
    [sh`bash -xec 'ls'`, ['bash', '<embedded-command>'], [0, 1]],
    [sh`bash -ce 'ls'`, ['bash', '<embedded-command>'], [0, 1]],
    [sh`bash -lc 'ls'`, ['bash', '<embedded-command>'], [0, 1]],
    // Options before `-c`; `-o`/`+o` take the next word as an option name.
    [sh`bash -e -c 'ls'`, ['bash', '<embedded-command>'], [0, 2]],
    [sh`bash -o pipefail -c 'ls'`, ['bash', '<embedded-command>'], [0, 3]],
    [sh`bash +o nounset -c 'ls'`, ['bash', '<embedded-command>'], [0, 3]],
    [sh`bash -eo pipefail -c 'ls'`, ['bash', '<embedded-command>'], [0, 3]],
    // `-oc errexit 'ls'`: bash and dash read `-o errexit -c`, so `ls` runs.
    [sh`bash -oc errexit 'ls'`, ['bash', '<embedded-command>'], [0, 1]],
    [sh`dash -oc errexit 'ls'`, ['dash', '<embedded-command>'], [0, 1]],
    // `--` after `-c` only ends options for the string operand.
    [sh`bash -c -- 'ls'`, ['bash', '<embedded-command>'], [0, 1]],
    // bash-only operand options and long options.
    [sh`bash -O extglob -c 'ls'`, ['bash', '<embedded-command>'], [0, 3]],
    [sh`bash +O extglob -c 'ls'`, ['bash', '<embedded-command>'], [0, 3]],
    [sh`bash --norc -c 'ls'`, ['bash', '<embedded-command>'], [0, 2]],
    [sh`bash --rcfile /dev/null -c 'ls'`, ['bash', '<embedded-command>'], [0, 3]],
    [sh`bash --init-file /dev/null -c 'ls'`, ['bash', '<embedded-command>'], [0, 3]],
    // bash, dash, zsh and ksh93 treat `+c` as `-c` (mksh does not; see below).
    [sh`bash +c 'ls'`, ['bash', '<embedded-command>'], [0, 1]],
    // `sh` may be bash (macOS /bin/sh is bash 3.2), so it takes bash's long
    // options with an operand: `sh --rcfile f -c "echo RAN"` runs the string.
    [sh`sh --rcfile f -c 'echo RAN'`, ['sh', '<embedded-command>'], [0, 3]],
    [sh`sh --init-file f -c 'echo RAN'`, ['sh', '<embedded-command>'], [0, 3]],
    [sh`sh --norc -c 'echo RAN'`, ['sh', '<embedded-command>'], [0, 2]],
    [sh`zsh +ec 'ls'`, ['zsh', '<embedded-command>'], [0, 1]],
    // The other interpreters.
    [sh`dash -c ls`, ['dash', '<embedded-command>'], [0, 1]],
    [sh`zsh -c ls`, ['zsh', '<embedded-command>'], [0, 1]],
    [sh`ksh -c ls`, ['ksh', '<embedded-command>'], [0, 1]],
    [sh`ksh93 -c ls`, ['ksh93', '<embedded-command>'], [0, 1]],
    [sh`mksh -c ls`, ['mksh', '<embedded-command>'], [0, 1]],
    // zsh/ksh/mksh take an attached `-oNAME`; zsh, ksh93 and mksh all ran the
    // string for `-oerrexit -c`, while bash and dash do not (see oracle).
    [sh`zsh -oerrexit -c 'ls'`, ['zsh', '<embedded-command>'], [0, 2]],
    [sh`ksh -oerrexit -c 'ls'`, ['ksh', '<embedded-command>'], [0, 2]],
    [sh`mksh -oerrexit -c 'ls'`, ['mksh', '<embedded-command>'], [0, 2]],
    [sh`zsh -o errexit -c 'ls'`, ['zsh', '<embedded-command>'], [0, 3]],
    [sh`ksh -co errexit 'ls'`, ['ksh', '<embedded-command>'], [0, 1]],
  ];

  it.each(rows)('%s', (src, chain, indices) => {
    const resolution = resolveArgv0(site(src));
    expect(chainSummary(resolution)).toEqual(chain);
    expect(resolution.chainIndices).toEqual(indices);
    expect(resolution.effective).toEqual(EMBEDDED);
  });

  it('is found after transparent wrappers, with the wrapper chain preserved', () => {
    const cases: readonly (readonly [string, readonly string[], readonly number[]])[] = [
      [sh`sudo bash -c ls`, ['sudo', 'bash', '<embedded-command>'], [0, 1, 2]],
      [sh`env bash -c ls`, ['env', 'bash', '<embedded-command>'], [0, 1, 2]],
      [sh`env A=1 sh -lc ls`, ['env', 'sh', '<embedded-command>'], [0, 2, 3]],
      [sh`nohup dash -c ls`, ['nohup', 'dash', '<embedded-command>'], [0, 1, 2]],
      [sh`command bash -c ls`, ['command', 'bash', '<embedded-command>'], [0, 1, 2]],
      [sh`exec -a x zsh -c ls`, ['exec', 'zsh', '<embedded-command>'], [0, 3, 4]],
      [
        sh`sudo -u root env FOO=1 bash -ec ls`,
        ['sudo', 'env', 'bash', '<embedded-command>'],
        [0, 3, 5, 6],
      ],
    ];
    for (const [src, chain, indices] of cases) {
      const resolution = resolveArgv0(site(src));
      expect(chainSummary(resolution), src).toEqual(chain);
      expect(resolution.chainIndices, src).toEqual(indices);
      expect(resolution.effective, src).toEqual(EMBEDDED);
    }
  });

  it("handles a multibyte command string (bash -c '🎉')", () => {
    const resolution = resolveArgv0(site(sh`bash -c '🎉'`));
    expect(chainSummary(resolution)).toEqual(['bash', '<embedded-command>']);
    expect(resolution.chainIndices).toEqual([0, 1]);
  });

  it('handles multibyte option operands and CJK text around the flag', () => {
    const resolution = resolveArgv0(site(sh`bash -o '名' -c '🎉 名'`));
    expect(chainSummary(resolution)).toEqual(['bash', '<embedded-command>']);
    expect(resolution.chainIndices).toEqual([0, 3]);
  });
});

describe('interpreter -c — not embedded, unchanged from before (criterion 2)', () => {
  // Real-shell notes (bash 5.2.21 unless named):
  //  - `bash script.sh`, `bash -e script.sh`: the operand is a script file.
  //  - `bash` alone: interactive/stdin shell.
  //  - `bash -- -c`: `--` ends options, so `-c` is a script *path*; with a
  //    file named `-c` bash ran it (and dash, zsh, ksh93, mksh did too).
  //  - `bash -o c script`: bash printed "c: invalid option name" and ran
  //    nothing; `c` here is an option name, not `-c`.
  //  - `bash - -c`: a lone `-` also ends options (all five shells ran file `-c`).
  //  - `bash script.sh -c 'x'`: after the script, `-c` is the script's own arg.
  const rows: readonly (readonly [string, readonly string[], readonly number[]])[] = [
    [sh`bash script.sh`, ['bash'], [0]],
    [sh`bash`, ['bash'], [0]],
    [sh`bash -e script.sh`, ['bash'], [0]],
    [sh`bash -x script.sh`, ['bash'], [0]],
    [sh`bash -- -c`, ['bash'], [0]],
    [sh`bash -- -c 'ls'`, ['bash'], [0]],
    [sh`bash -o c script.sh`, ['bash'], [0]],
    [sh`bash -o errexit script.sh`, ['bash'], [0]],
    [sh`bash - -c`, ['bash'], [0]],
    [sh`bash -e script.sh -c 'ls'`, ['bash'], [0]],
    [sh`sh script.sh`, ['sh'], [0]],
    [sh`sh -- -c`, ['sh'], [0]],
    // zsh/ksh93/mksh read the rest of `-oc` as the option *name* `c`, so no
    // command string is selected (zsh: "no such option: c"; ksh93 then treats
    // `errexit` as a script path; mksh: "c: unknown option").
    [sh`zsh -oc errexit 'ls'`, ['zsh'], [0]],
    [sh`ksh -oc errexit 'ls'`, ['ksh'], [0]],
    [sh`mksh -oc errexit 'ls'`, ['mksh'], [0]],
    // mksh R59 ignores `+c`: it ran the operand as a script path.
    [sh`mksh +c 'ls'`, ['mksh'], [0]],
    // A lone `+` is an ordinary operand; the check on the next word never runs.
    [sh`zsh + -c 'ls'`, ['zsh'], [0]],
  ];

  it.each(rows)('%s', (src, chain, indices) => {
    const resolution = resolveArgv0(site(src));
    expect(chainSummary(resolution)).toEqual(chain);
    expect(resolution.chainIndices).toEqual(indices);
    expect(resolution.effective).toEqual({ static: true, text: chain[0] });
  });

  // A dynamic word in option position can be a script path or any number of
  // options, so whether a later `-c` is an option is undecidable. Scanning
  // stops and the interpreter resolves as it did before this behavior.
  it('leaves a dynamic option-position word undecidable and unchanged', () => {
    for (const src of [sh`bash "$script"`, sh`bash "$opts" -c 'ls'`, sh`bash -c"$y" x`]) {
      const resolution = resolveArgv0(site(src));
      expect(chainSummary(resolution), src).toEqual(['bash']);
      expect(resolution.effective, src).toEqual({ static: true, text: 'bash' });
    }
  });

  // Pins the behavior deliberately. `static: true` here means only that the
  // interpreter's name is known: with f=-x, `bash "$f" -c x` runs `x` as a
  // command string (bash 5.2.21), yet this is reported as plain `bash`.
  it('reports static bash with an undecidable chain of exactly one word', () => {
    const resolution = resolveArgv0(site(sh`bash "$f" -c x`));
    expect(resolution.chain).toEqual([{ static: true, text: 'bash' }]);
    expect(resolution.chainIndices).toEqual([0]);
  });

  it('does not treat a non-interpreter name as one', () => {
    const resolution = resolveArgv0(site(sh`mybash -c ls`));
    expect(resolution.effective).toEqual({ static: true, text: 'mybash' });
  });
});

describe('interpreter -c — paths and env (criterion 3)', () => {
  it('reports a path-qualified interpreter exactly like the bare name', () => {
    const cases: readonly (readonly [string, readonly string[], readonly number[]])[] = [
      [sh`/bin/bash -c x`, ['/bin/bash', '<embedded-command>'], [0, 1]],
      [sh`/usr/local/bin/zsh -ec x`, ['/usr/local/bin/zsh', '<embedded-command>'], [0, 1]],
      [sh`sudo /bin/sh -c x`, ['sudo', '/bin/sh', '<embedded-command>'], [0, 1, 2]],
      [sh`/bin/bash script.sh`, ['/bin/bash'], [0]],
    ];
    for (const [src, chain, indices] of cases) {
      const resolution = resolveArgv0(site(src));
      expect(chainSummary(resolution), src).toEqual(chain);
      expect(resolution.chainIndices, src).toEqual(indices);
    }
  });

  it('does not match a name that merely ends with an interpreter name', () => {
    const resolution = resolveArgv0(site(sh`/bin/notbash -c x`));
    expect(resolution.effective).toEqual({ static: true, text: '/bin/notbash' });
  });

  // `env` is matched by exact name only (see `WrapperSpec.names`), so
  // `/usr/bin/env` is not a transparent wrapper today and this behavior is
  // deliberately unchanged here: following it into `bash -c` would also
  // change `/usr/bin/env rm x`, which is a separate public-output decision.
  it('leaves /usr/bin/env as an ordinary effective command (exact-name wrapper policy)', () => {
    const resolution = resolveArgv0(site(sh`/usr/bin/env bash -c x`));
    expect(chainSummary(resolution)).toEqual(['/usr/bin/env']);
    expect(resolution.effective).toEqual({ static: true, text: '/usr/bin/env' });
  });
});

describe('interpreter -c — result shape (criterion 4)', () => {
  it('keeps the interpreter word available in the env -S shape', () => {
    const interpreter = resolveArgv0(site(sh`sudo /bin/bash -ec 'rm x'`));
    const env = resolveArgv0(site(sh`sudo env -S 'rm x'`));
    // Same record shape: the wrapper/interpreter word, then the synthetic one.
    expect(Object.keys(interpreter).sort()).toEqual(Object.keys(env).sort());
    expect(interpreter.chain).toEqual([
      { static: true, text: 'sudo' },
      { static: true, text: '/bin/bash' },
      EMBEDDED,
    ]);
    expect(env.chain.at(-1)).toEqual(EMBEDDED);
    // The flag word is the triggering index: argv[2] is `-ec`.
    expect(interpreter.chainIndices).toEqual([0, 1, 2]);
    expect(interpreter.effective).toEqual(EMBEDDED);
    expect(interpreter.assignmentsSkipped).toBe(0);
  });

  it('counts shell-level assignment prefixes as before', () => {
    const resolution = resolveArgv0(site(sh`A=1 B=2 bash -c ls`));
    expect(resolution.assignmentsSkipped).toBe(2);
    expect(resolution.effective).toEqual(EMBEDDED);
  });
});

describe('interpreter -c — table and overrides', () => {
  it('the default table is deeply frozen', () => {
    expect(Object.isFrozen(DEFAULT_EMBEDDED_COMMAND_INTERPRETERS)).toBe(true);
    for (const entry of DEFAULT_EMBEDDED_COMMAND_INTERPRETERS) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.names)).toBe(true);
      expect(Object.isFrozen(entry.operandOptions)).toBe(true);
    }
  });

  it('names exactly the documented interpreters', () => {
    expect(DEFAULT_EMBEDDED_COMMAND_INTERPRETERS.flatMap((entry) => entry.names)).toEqual([
      'bash',
      'sh',
      'dash',
      'zsh',
      'ksh',
      'ksh93',
      'mksh',
    ]);
  });

  // The previous result: an interpreter was an ordinary static effective
  // command. An empty table restores it exactly.
  it('an empty table restores the previous static result', () => {
    const resolution = resolveArgv0(site(sh`bash -ec 'ls'`), { embeddedCommandInterpreters: [] });
    expect(chainSummary(resolution)).toEqual(['bash']);
    expect(resolution.chainIndices).toEqual([0]);
    expect(resolution.effective).toEqual({ static: true, text: 'bash' });
  });

  it('a custom table can add an interpreter and drop the defaults', () => {
    const options = {
      embeddedCommandInterpreters: [
        { names: ['mybash'], operandOptions: ['o'], operandAttachment: 'separate-word' },
      ],
    } as const;
    expect(resolveArgv0(site(sh`mybash -o x -c ls`), options).effective).toEqual(EMBEDDED);
    expect(resolveArgv0(site(sh`bash -c ls`), options).effective).toEqual({
      static: true,
      text: 'bash',
    });
  });

  it('a custom entry controls plusCSelectsCommand and operandLongOptions', () => {
    const base = { names: ['q'], operandOptions: [], operandAttachment: 'separate-word' } as const;
    expect(
      resolveArgv0(site(sh`q +c ls`), { embeddedCommandInterpreters: [base] }).effective,
    ).toEqual({ static: true, text: 'q' });
    expect(
      resolveArgv0(site(sh`q +c ls`), {
        embeddedCommandInterpreters: [{ ...base, plusCSelectsCommand: true }],
      }).effective,
    ).toEqual(EMBEDDED);
    expect(
      resolveArgv0(site(sh`q --conf file -c ls`), {
        embeddedCommandInterpreters: [{ ...base, operandLongOptions: ['--conf'] }],
      }).chainIndices,
    ).toEqual([0, 3]);
  });

  it('rejects malformed entries at the boundary', () => {
    const bad: readonly unknown[] = [
      { names: [], operandOptions: [], operandAttachment: 'separate-word' },
      { names: ['x'], operandOptions: ['oo'], operandAttachment: 'separate-word' },
      { names: ['x'], operandOptions: [], operandAttachment: 'nope' },
      {
        names: ['x'],
        operandOptions: [],
        operandAttachment: 'separate-word',
        operandLongOptions: 1,
      },
      {
        names: ['x'],
        operandOptions: [],
        operandAttachment: 'separate-word',
        plusCSelectsCommand: 1,
      },
    ];
    for (const entry of bad) {
      expect(() =>
        resolveArgv0(site('ls'), {
          embeddedCommandInterpreters: [entry as never],
        }),
      ).toThrow(ShAnalyzeInvalidWrapperSpecError);
    }
  });
});

// Live cross-check: runs the real bash on each case and compares with the
// hand-written expectation. `echo $((40+2))` prints 42 only if the operand was
// run as a command string; a script operand prints SCRIPT; a rejected option
// prints neither. Skipped when bash is not installed.
const bashAvailable = spawnSync('bash', ['--version']).status === 0;

describe.skipIf(!bashAvailable)('interpreter -c — real bash oracle', () => {
  const command = 'echo $((40+2))';
  // [argv after `bash`, runs the final operand as a command string]
  const cases: readonly (readonly [readonly string[], boolean])[] = [
    [['-c', command], true],
    [['-e', '-c', command], true],
    [['-ec', command], true],
    [['-xec', command], true],
    [['-lc', command], true],
    [['-o', 'pipefail', '-c', command], true],
    [['+o', 'nounset', '-c', command], true],
    [['-eo', 'pipefail', '-c', command], true],
    [['-oc', 'errexit', command], true],
    [['-O', 'extglob', '-c', command], true],
    [['--norc', '-c', command], true],
    [['--rcfile', '/dev/null', '-c', command], true],
    [['+c', command], true],
    [['-c', '--', command], true],
    [['s'], false],
    [['-e', 's'], false],
    [['-x', 's'], false],
    [['--', '-c'], false],
    [['--', '-c', command], false],
    [['-o', 'c', 's'], false],
    [['-', '-c', command], false],
    [['s', '-c', command], false],
  ];

  it.each(cases)('bash %j', (args, runsCommand) => {
    const dir = mkdtempSync(join(tmpdir(), 'sh-ast-oracle-'));
    try {
      writeFileSync(join(dir, 's'), 'echo SCRIPT\n');
      writeFileSync(join(dir, '-c'), 'echo DASH-C-FILE\n');
      const quoted = ['bash', ...args].map((word) => `'${word}'`).join(' ');
      const ran = spawnSync('bash', args, { cwd: dir, input: '', encoding: 'utf8' });
      expect(ran.stdout.includes('42')).toBe(runsCommand);
      const resolution = resolveArgv0(site(quoted));
      expect(resolution.effective.static).toBe(!runsCommand);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
