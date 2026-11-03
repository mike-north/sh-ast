/** Argument provenance is counted from source words, independently of wrapper scanning internals. */
import { describe, expect, it } from 'vitest';
import { parseSync } from '../src/index.js';
import {
  DEFAULT_TRANSPARENT_WRAPPERS,
  enumerateCommands,
  resolveArgv0,
} from '../src/analyze/index.js';
import type { CommandSite, WrapperSpec } from '../src/analyze/index.js';

/** Every fixture has exactly one invocation; assignments remain separate from argv. */
function site(source: string): CommandSite {
  const sites = enumerateCommands(parseSync(source));
  expect(sites).toHaveLength(1);
  const result = sites.at(0);
  if (!result) throw new Error('Expected invocation');
  return result;
}

/** Caller grammar consumes an option operand and otherwise treats the next word as command. */
const wrappers: readonly WrapperSpec[] = [
  ...DEFAULT_TRANSPARENT_WRAPPERS,
  { names: ['retry'], argFlags: ['-n'] },
  { names: ['with-context'], positionalOperandsBeforeCommand: 1 },
];

describe('resolveArgv0 argument provenance', () => {
  it.each<{ source: string; indices: readonly number[]; chain: readonly string[] }>([
    {
      source: 'nohup env A=1 command rm x',
      indices: [0, 1, 3, 4],
      chain: ['nohup', 'env', 'command', 'rm'],
    },
    { source: 'retry -n 3 curl x', indices: [0, 3], chain: ['retry', 'curl'] },
    { source: 'sudo -uuser rm x', indices: [0, 2], chain: ['sudo', 'rm'] },
    { source: 'sudo -Eu user rm x', indices: [0, 3], chain: ['sudo', 'rm'] },
    { source: "env -S 'a b'", indices: [0, 1], chain: ['env', '<embedded-command>'] },
    { source: "env --split-string='a b'", indices: [0, 1], chain: ['env', '<embedded-command>'] },
    { source: 'sudo -u x "$prog"', indices: [0, 3], chain: ['sudo', '<expansion>'] },
    { source: 'env env x', indices: [0, 1, 2], chain: ['env', 'env', 'x'] },
    { source: 'retry retry x', indices: [0, 1, 2], chain: ['retry', 'retry', 'x'] },
    { source: 'env A=🎉 中文 x', indices: [0, 2], chain: ['env', '中文'] },
    { source: 'sudo -u user -D /tmp rm', indices: [0, 3], chain: ['sudo', '<unknown-flag>'] },
    { source: 'env A=1 =value rm', indices: [0, 2], chain: ['env', '<ambiguous-assignment>'] },
    { source: 'env -- =value rm', indices: [0, 2], chain: ['env', '<ambiguous-assignment>'] },
    { source: 'with-context context cmd x', indices: [0, 2], chain: ['with-context', 'cmd'] },
    { source: 'sudo -- -u x', indices: [0, 2], chain: ['sudo', '-u'] },
    { source: 'sudo -u', indices: [0], chain: ['sudo'] },
    { source: 'env A=1', indices: [0], chain: ['env'] },
    { source: 'command -v git', indices: [0], chain: ['command'] },
    { source: '"$prog" x', indices: [0], chain: ['<expansion>'] },
  ])(
    'retains exact word indices and existing outcomes for $source',
    ({ source, indices, chain }) => {
      const input = site(source);
      const result = resolveArgv0(input, { transparentWrappers: wrappers });
      expect(result.chainIndices).toEqual(indices);
      expect(result.chainIndices).toHaveLength(result.chain.length);
      expect(result.chain.map((word) => (word.static ? word.text : `<${word.reason}>`))).toEqual(
        chain,
      );
      expect(result.effective).toBe(result.chain.at(-1));
      expect(result.assignmentsSkipped).toBe(0);
      result.chain.forEach((word, index) => {
        // Native word outcomes keep their original resolution identity; only wrapper failures are synthesized.
        if (
          word.static ||
          !['unknown-flag', 'embedded-command', 'ambiguous-assignment'].includes(word.reason)
        ) {
          expect(word).toBe(input.argv[indices[index]]);
        }
      });
    },
  );

  it('locates effective arguments without reinterpreting their command-specific flags', () => {
    const input = site('retry git -C d fetch');
    const result = resolveArgv0(input, { transparentWrappers: wrappers });
    expect(result.chainIndices).toEqual([0, 1]);
    const index = result.chainIndices.at(-1);
    if (index === undefined) throw new Error('Expected nonempty chain');
    expect(input.argv.slice(index + 1)).toEqual([
      { static: true, text: '-C' },
      { static: true, text: 'd' },
      { static: true, text: 'fetch' },
    ]);
    expect(input.node.Args?.slice(index + 1).map((word) => word?.Parts?.[0])).toMatchObject([
      { Type: 'Lit', Value: '-C' },
      { Type: 'Lit', Value: 'd' },
      { Type: 'Lit', Value: 'fetch' },
    ]);
  });

  it('retains null Args positions instead of shifting later word indices', () => {
    const file = parseSync('sudo -u user cmd x');
    const command = file.Stmts?.[0]?.Cmd;
    if (command?.Type !== 'CallExpr' || !command.Args) throw new Error('Expected arguments');
    command.Args[3] = null;
    const input = enumerateCommands(file).at(0);
    if (!input) throw new Error('Expected invocation');
    expect(input.argv).toHaveLength(5);
    expect(input.argv[3]).toEqual({ static: false, reason: 'unsupported' });
    const result = resolveArgv0(input);
    expect(result.chainIndices).toEqual([0, 3]);
    expect(result.effective).toBe(input.argv[3]);
    expect(input.argv[4]).toEqual({ static: true, text: 'x' });
  });
});
