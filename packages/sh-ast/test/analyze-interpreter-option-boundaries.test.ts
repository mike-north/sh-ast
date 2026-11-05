/**
 * Interpreter option-boundary contracts: long-option operands, termination
 * within a cluster, optional option-name operands, and invalid custom tables.
 * Literal expectations come from real zsh 5.9 and ksh93u+ 2012-08-01 probes;
 * live oracles repeat the relevant invocations when those shells are present.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enumerateCommands, resolveArgv0 } from '../src/analyze/index.js';
import type { Argv0Resolution, ResolveArgv0Options } from '../src/analyze/index.js';
import { parseSync, ShAnalyzeInvalidWrapperSpecError } from '../src/index.js';

/** Resolves one invocation without deriving any expectation from its result. */
function resolve(source: string, options?: ResolveArgv0Options): Argv0Resolution {
  const sites = enumerateCommands(parseSync(source));
  expect(sites).toHaveLength(1);
  return resolveArgv0(sites[0], options);
}

describe('interpreter option boundaries', () => {
  const embedded: readonly (readonly [string, readonly string[], readonly number[]])[] = [
    ["zsh --emulate sh -c 'echo 42'", ['zsh', '<embedded-command>'], [0, 3]],
    ["zsh --emulate ksh -c 'echo 42'", ['zsh', '<embedded-command>'], [0, 3]],
    ["zsh +-emulate zsh -c 'echo 42'", ['zsh', '<embedded-command>'], [0, 3]],
    ["env zsh --emulate sh -c 'echo 42'", ['env', 'zsh', '<embedded-command>'], [0, 1, 4]],
    ["zsh --no-rcs -c 'echo 42'", ['zsh', '<embedded-command>'], [0, 2]],
    ["zsh +-rcs -c 'echo 42'", ['zsh', '<embedded-command>'], [0, 2]],
    ["zsh -bc 'echo X'", ['zsh', '<embedded-command>'], [0, 1]],
    ["zsh -cb 'echo X'", ['zsh', '<embedded-command>'], [0, 1]],
    ["zsh +bc 'echo X'", ['zsh', '<embedded-command>'], [0, 1]],
    ["zsh -cx- 'echo X'", ['zsh', '<embedded-command>'], [0, 1]],
    ["ksh -o -c 'echo X'", ['ksh', '<embedded-command>'], [0, 2]],
    ["ksh +o -c 'echo X'", ['ksh', '<embedded-command>'], [0, 2]],
    ["ksh -eo -c 'echo X'", ['ksh', '<embedded-command>'], [0, 2]],
    ["ksh +eo -c 'echo X'", ['ksh', '<embedded-command>'], [0, 2]],
    ["ksh -co -c 'echo X'", ['ksh', '<embedded-command>'], [0, 1]],
    ["ksh93 +o -c 'echo X'", ['ksh93', '<embedded-command>'], [0, 2]],
    ["sudo ksh +o -c 'echo X'", ['sudo', 'ksh', '<embedded-command>'], [0, 1, 3]],
  ];
  it.each(embedded)('finds the command string in %s', (source, chain, indices) => {
    const result = resolve(source);
    expect(result.chain.map((word) => (word.static ? word.text : `<${word.reason}>`))).toEqual(
      chain,
    );
    expect(result.chainIndices).toEqual(indices);
    expect(result.effective).toEqual({ static: false, reason: 'embedded-command' });
  });

  const ordinary: readonly (readonly [string, string])[] = [
    ["zsh -b -c 'echo X'", 'zsh'],
    ["zsh +b -c 'echo X'", 'zsh'],
    ["zsh -eb -c 'echo X'", 'zsh'],
    ["zsh -x- -c 'echo X'", 'zsh'],
    ["zsh +x- -c 'echo X'", 'zsh'],
    ["zsh +- -c 'echo X'", 'zsh'],
    ['zsh -cb', 'zsh'],
    ['zsh -c -b', 'zsh'],
    ['zsh --emulate sh -c', 'zsh'],
    ['zsh --emulate', 'zsh'],
    ["ksh -o -- -c 'echo X'", 'ksh'],
    ["ksh +o -- -c 'echo X'", 'ksh'],
    ["ksh -oc errexit 'echo X'", 'ksh'],
    ['ksh +o -c', 'ksh'],
    ["ksh -o +c 'echo X'", 'ksh'],
    ["ksh +o +c 'echo X'", 'ksh'],
    ['ksh -c +', 'ksh'],
    ['ksh -co', 'ksh'],
    ['ksh -o "$option" -c x', 'ksh'],
    ["bash +o -c 'echo X'", 'bash'],
    ["sh +o -c 'echo X'", 'sh'],
    ["dash +o -c 'echo X'", 'dash'],
    ["zsh +o -c 'echo X'", 'zsh'],
  ];
  it.each(ordinary)('keeps the interpreter for %s', (source, name) => {
    const result = resolve(source);
    expect(result.effective).toEqual({ static: true, text: name });
    expect(result.chainIndices).toEqual([0]);
  });
});

describe('custom interpreter boundary grammar', () => {
  const spec = {
    names: ['q'],
    operandOptions: ['o'],
    operandAttachment: 'rest-of-cluster',
    optionalOperandOptions: ['o'],
    optionTerminatorLetters: ['z'],
    optionTerminatorWords: ['+'],
    operandLongOptions: ['--mode', '+-mode'],
  } as const;
  const options = { embeddedCommandInterpreters: [spec] };

  it('applies configurable boundaries without depending on default interpreter names', () => {
    expect(resolve('q --mode value -c x', options).chainIndices).toEqual([0, 3]);
    expect(resolve('q +-mode value -c x', options).chainIndices).toEqual([0, 3]);
    expect(resolve('q +o -c x', options).chainIndices).toEqual([0, 2]);
    expect(resolve('q -zc x', options).chainIndices).toEqual([0, 1]);
    expect(resolve('q +z -c x', options).effective).toEqual({ static: true, text: 'q' });
    expect(resolve('q -c +', options).effective).toEqual({ static: true, text: 'q' });
    expect(resolve('q -c + x', options).chainIndices).toEqual([0, 1]);
  });

  it('requires option operands unless the table explicitly makes them optional', () => {
    expect(
      resolve('q -o -c x', {
        embeddedCommandInterpreters: [
          { names: ['q'], operandOptions: ['o'], operandAttachment: 'rest-of-cluster' },
        ],
      }).effective,
    ).toEqual({ static: true, text: 'q' });
  });

  it.each([
    null,
    undefined,
    true,
    42,
    'bash',
    [],
    { ...spec, names: ['/bin/bash'] },
    { ...spec, names: ['bash', './bash'] },
    { ...spec, optionTerminatorLetters: ['zz'] },
    { ...spec, optionTerminatorWords: 1 },
    { ...spec, optionalOperandOptions: ['x'] },
  ])('rejects invalid interpreter table entries: %j', (entry) => {
    expect(() => resolve('bash -c x', { embeddedCommandInterpreters: [entry as never] })).toThrow(
      ShAnalyzeInvalidWrapperSpecError,
    );
  });

  it('accepts a basename entry for absolute and relative command paths', () => {
    const options = {
      embeddedCommandInterpreters: [
        { names: ['bash'], operandOptions: [], operandAttachment: 'separate-word' },
      ],
    } as const;
    expect(resolve('/bin/bash -c x', options).chainIndices).toEqual([0, 1]);
    expect(resolve('./bash -c x', options).chainIndices).toEqual([0, 1]);
  });

  it('rejects a custom operand letter that conflicts with the command selector', () => {
    expect(() =>
      resolve('q -c script', {
        embeddedCommandInterpreters: [
          {
            names: ['q'],
            operandOptions: ['c'],
            operandAttachment: 'separate-word',
          },
        ],
      }),
    ).toThrow(ShAnalyzeInvalidWrapperSpecError);
  });
});

describe('Bash long-option aliases and dynamic operands', () => {
  // Bash 5.3.9 and 3.2.57 (also /bin/sh) ran script s for these aliases.
  // Exact long-option words must not be mistaken for clustered short flags.
  const rows: readonly (readonly [string, readonly number[]])[] = [
    ['bash -rcfile /dev/null s', [0]],
    ['bash -init-file /dev/null s', [0]],
    ['bash -restricted s', [0]],
    ['bash -norc s', [0]],
    ['bash -rcfile /dev/null -c x', [0, 3]],
    ['bash -init-file /dev/null -c x', [0, 3]],
    ['bash -restricted -c x', [0, 2]],
    ['bash -norc -c x', [0, 2]],
    ['bash -noprofile -c x', [0, 2]],
    ['bash -noediting -c x', [0, 2]],
    ['bash -posix -c x', [0, 2]],
    ['bash -login -c x', [0, 2]],
    ['bash -verbose -c x', [0, 2]],
    ['sh -rcfile /dev/null s', [0]],
    ['sh -restricted s', [0]],
    ['sh -init-file /dev/null -c x', [0, 3]],
    ['sh -noprofile -c x', [0, 2]],
  ];
  it.each(rows)('recognizes exact long-option aliases before clusters: %s', (source, indices) => {
    const result = resolve(source);
    expect(result.chainIndices).toEqual(indices);
    expect(result.effective.static).toBe(indices.length === 1);
  });

  it.each([
    'bash -o "$@" -c x',
    'bash +o "$@" -c x',
    'bash -eo "$@" -c x',
    'bash --rcfile "$@" -c x',
    'bash --init-file "$@" -c x',
    'bash -rcfile "$@" -c x',
    'bash -init-file "$@" -c x',
  ])('does not guess the argument count of a dynamic operand: %s', (source) => {
    expect(resolve(source).effective).toEqual({ static: true, text: 'bash' });
    expect(resolve(source).chainIndices).toEqual([0]);
  });

  it('allows a custom exact long-option flag with a single dash', () => {
    const options = {
      embeddedCommandInterpreters: [
        {
          names: ['q'],
          operandOptions: ['o'],
          operandAttachment: 'separate-word',
          noOperandLongOptions: ['-profile', '-restricted'],
        },
      ],
    } as const;
    expect(resolve('q -profile -c x', options).chainIndices).toEqual([0, 2]);
    expect(resolve('q -restricted s', options).effective).toEqual({ static: true, text: 'q' });
  });

  it('rejects sparse interpreter tables at the boundary', () => {
    const tables: readonly (readonly unknown[])[] = [
      new Array<unknown>(1),
      [, { names: ['bash'], operandOptions: [], operandAttachment: 'separate-word' }],
    ];
    for (const table of tables) {
      // Malformed JavaScript inputs deliberately bypass the public type.
      expect(() => resolve('bash -c x', { embeddedCommandInterpreters: table as never })).toThrow(
        ShAnalyzeInvalidWrapperSpecError,
      );
    }
  });

  // A field array promises actual strings in every slot. Array holes must
  // not become silently ignored names, flags or operand grammar entries.
  it.each([
    'names',
    'operandOptions',
    'operandLongOptions',
    'noOperandLongOptions',
    'optionTerminatorLetters',
    'optionTerminatorWords',
    'optionalOperandOptions',
  ])('rejects holes inside the interpreter %s field', (field) => {
    const entry = {
      names: ['bash'],
      operandOptions: [],
      operandAttachment: 'separate-word',
      [field]: new Array<unknown>(1),
    };
    expect(() => resolve('bash -c x', { embeddedCommandInterpreters: [entry as never] })).toThrow(
      ShAnalyzeInvalidWrapperSpecError,
    );
  });

  // Positional parameters yield two actual operands. The second becomes a
  // script path, so skipping the syntactic "$@" as one word would be wrong.
  const bashAvailable = spawnSync('bash', ['-c', 'exit 0']).status === 0;
  it.skipIf(!bashAvailable).each(['-o', '+o', '--rcfile', '-rcfile'])(
    'real bash multi-field operand for %s',
    (option) => {
      const dir = mkdtempSync(join(tmpdir(), 'sh-ast-multifield-oracle-'));
      const value = option === '-o' || option === '+o' ? 'errexit' : '/dev/null';
      try {
        writeFileSync(join(dir, 's'), 'printf "SCRIPT_FILE\\n"\n');
        const source = `bash ${option} "$@" -c 'printf "COMMAND_STRING\\n"'`;
        const ran = spawnSync('bash', ['-c', `set -- '${value}' s; ${source}`], {
          cwd: dir,
          input: '',
          encoding: 'utf8',
        });
        expect(ran.status).toBe(0);
        expect(ran.stdout).toContain('SCRIPT_FILE\n');
        expect(resolve(source).effective).toEqual({ static: true, text: 'bash' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

// Each boolean is a hand-written execution expectation, independent of the
// resolver. A real file named `-c` makes a script invocation visibly distinct.
const oracleCases: readonly (readonly [string, readonly string[], boolean])[] = [
  ['zsh', ['--emulate', 'sh', '-c'], true],
  ['zsh', ['+-emulate', 'zsh', '-c'], true],
  ['zsh', ['--no-rcs', '-c'], true],
  ['zsh', ['+-rcs', '-c'], true],
  ['zsh', ['-b', '-c'], false],
  ['zsh', ['+b', '-c'], false],
  ['zsh', ['-eb', '-c'], false],
  ['zsh', ['-bc'], true],
  ['zsh', ['-cb'], true],
  ['zsh', ['+bc'], true],
  ['zsh', ['-x-', '-c'], false],
  ['zsh', ['+x-', '-c'], false],
  ['zsh', ['+-', '-c'], false],
  ['ksh', ['-o', '-c'], true],
  ['ksh', ['+o', '-c'], true],
  ['ksh', ['-o', '+c'], false],
  ['ksh', ['+o', '+c'], false],
  ['ksh', ['-eo', '-c'], true],
  ['ksh', ['+eo', '-c'], true],
  ['ksh', ['-co', '-c'], true],
  ['ksh', ['-o', '--', '-c'], false],
  ['ksh', ['+o', '--', '-c'], false],
  ['ksh', ['-c', '+'], true],
  ['bash', ['+o', '-c'], false],
  ['sh', ['+o', '-c'], false],
  ['dash', ['+o', '-c'], false],
  ['zsh', ['+o', '-c'], false],
];
for (const [shell, args, runsString] of oracleCases) {
  const available = spawnSync(shell, ['-c', 'exit 0']).status === 0;
  it.skipIf(!available)(`real ${shell} ${args.join(' ')} option boundary`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'sh-ast-boundary-oracle-'));
    const command = 'printf "COMMAND_STRING\\n"';
    try {
      writeFileSync(join(dir, '-c'), 'printf "SCRIPT_FILE\\n"\n');
      // The operand must name a real script too: ksh may evaluate a missing
      // filename while looking it up, which would otherwise mimic execution.
      writeFileSync(join(dir, command), 'printf "SCRIPT_FILE\\n"\n');
      const ran = spawnSync(shell, [...args, command], { cwd: dir, input: '', encoding: 'utf8' });
      expect(ran.stdout.includes('COMMAND_STRING\n')).toBe(runsString);
      if (!runsString && ran.status === 0) expect(ran.stdout).toContain('SCRIPT_FILE\n');
      const source = [shell, ...args, command].map((word) => `'${word}'`).join(' ');
      expect(resolve(source).effective.static).toBe(!runsString);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
