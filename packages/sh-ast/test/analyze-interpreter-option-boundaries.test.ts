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
    ["ksh -o +c 'echo X'", ['ksh', '<embedded-command>'], [0, 2]],
    ["ksh +o +c 'echo X'", ['ksh', '<embedded-command>'], [0, 2]],
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
  ['ksh', ['-o', '+c'], true],
  ['ksh', ['+o', '+c'], true],
  ['ksh', ['-eo', '-c'], true],
  ['ksh', ['+eo', '-c'], true],
  ['ksh', ['-co', '-c'], true],
  ['ksh', ['-o', '--', '-c'], false],
  ['ksh', ['+o', '--', '-c'], false],
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
      const ran = spawnSync(shell, [...args, command], { cwd: dir, input: '', encoding: 'utf8' });
      expect(ran.stdout.includes('COMMAND_STRING\n')).toBe(runsString);
      const source = [shell, ...args, command].map((word) => `'${word}'`).join(' ');
      expect(resolve(source).effective.static).toBe(!runsString);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
