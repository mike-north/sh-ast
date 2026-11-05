/**
 * Reverse subscripts retain the measured pre-v3.14.1 analysis contract (#88).
 * These finite cases deliberately preserve arithmetic-parser limits; general
 * pattern grammar and corrected character-class printing belong to #90.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { enumerateCommands } from '../src/analyze/index.js';
import {
  LangZsh,
  ParseError,
  ShParseMaxDepthError,
  nodeEnd,
  nodePos,
  parseSync,
  parseWithPositionsSync,
  printSync,
  walk,
} from '../src/index.js';
import type { File, Node } from '../generated/syntax-types.js';

/** Public Walk must expose executed substitutions, not just printable text. */
function nodes(file: File): Node[] {
  const result: Node[] = [];
  walk(file, (node) => {
    if (node) result.push(node);
    return true;
  });
  return result;
}

describe('pre-pin Zsh reverse-subscript analysis', () => {
  it.each([
    ['echo ${a[(r)$(printf foo)]}\n', 12, 25, 14, 24],
    ['echo "${a[(r)$(printf foo)]}"\n', 13, 26, 15, 25],
    ['echo é "${a[(r)$(printf foo)]}"\n', 16, 29, 18, 28],
  ] as const)(
    'exposes executed printf and its byte span in %s',
    (source, start, end, callStart, callEnd) => {
      const file = parseSync(source, { Variant: LangZsh });
      const substitutions = nodes(file).filter((node) => node.Type === 'CmdSubst');
      expect(substitutions).toHaveLength(1);
      expect(substitutions.map((node) => [nodePos(node).Offset, nodeEnd(node).Offset])).toEqual([
        [start, end],
      ]);
      expect(
        enumerateCommands(file).map((site) => {
          const name = site.node.Args?.[0]?.Parts?.[0];
          if (name?.Type !== 'Lit') throw new Error('Expected literal command name');
          return {
            name: name.Value,
            context: site.context,
            span: [nodePos(site.node).Offset, nodeEnd(site.node).Offset],
          };
        }),
      ).toEqual([
        {
          name: 'echo',
          context: [],
          span: [0, Buffer.byteLength(source) - 1],
        },
        {
          name: 'printf',
          context: [{ kind: 'cmdSubst' }],
          span: [callStart, callEnd],
        },
      ]);
      for (const options of [{}, { KeepPadding: true }]) {
        expect(printSync(file, options)).toBe(source);
      }
    },
  );

  it.each([
    ['echo ${a[(r)$needle]}\n', 12, 19],
    ['echo "${a[(r)$needle]}"\n', 13, 20],
  ] as const)(
    'retains the expanded parameter, not an opaque pattern, in %s',
    (source, start, end) => {
      const file = parseSync(source, { Variant: LangZsh });
      const parameters = nodes(file).filter((node) => node.Type === 'ParamExp');
      expect(parameters.map((node) => node.Param?.Value)).toEqual(['a', 'needle']);
      expect(
        parameters.slice(1).map((node) => [nodePos(node).Offset, nodeEnd(node).Offset]),
      ).toEqual([[start, end]]);
      for (const options of [{}, { KeepPadding: true }]) {
        expect(printSync(file, options)).toBe(source);
      }
    },
  );

  it.each(['echo ${a[(r)foo]}\n', 'echo ${a[(r)foo\\]bar]}\n'])(
    'retains plain text and escaped closing-bracket boundaries: %s',
    (source) => {
      const file = parseSync(source, { Variant: LangZsh });
      expect(nodes(file).filter((node) => node.Type === 'FlagsArithm')).toHaveLength(1);
      for (const options of [{}, { KeepPadding: true }]) {
        expect(printSync(file, options)).toBe(source);
      }
    },
  );

  it.each([
    ['wildcard suffix', 'echo ${a[(r)foo*]}\n', 15],
    ['outer quoted apostrophe', 'a=(other "don\'t-panic"); echo "${a[(r)don\'t*]}"\n', 41],
    [
      'explicit nested quoted apostrophe',
      'a=(other "don\'t-panic"); echo ${(U)"${a[(r)don\'t*]}"}\n',
      46,
    ],
    ['dollar/apostrophe (thread 4486180400)', 'echo "${a[(r)$\'foo]}"\n', 13],
  ] as const)('NAMED LIMIT: pre-pin refusal for %s', (_name, source, offset) => {
    expect(() => parseSync(source, { Variant: LangZsh })).toThrow(ParseError);
    try {
      parseSync(source, { Variant: LangZsh });
    } catch (error) {
      expect(error).toMatchObject({ Pos: { Offset: offset } });
    }
    expect(enumerateCommands(parseSync('echo alive', { Variant: LangZsh }))).toHaveLength(1);
  });

  it('NAMED LIMIT: paired dollar/apostrophes hide needle in a pre-pin SglQuoted node', () => {
    const source = 'echo "${a[(r)$\'foo$needle\']}"\n';
    const file = parseSync(source, { Variant: LangZsh });
    expect(
      nodes(file)
        .filter((node) => node.Type === 'ParamExp')
        .map((node) => node.Param?.Value),
    ).toEqual(['a']);
    expect(nodes(file).filter((node) => node.Type === 'SglQuoted')).toMatchObject([
      { Dollar: true, Value: 'foo$needle' },
    ]);
    for (const options of [{}, { KeepPadding: true }]) {
      expect(printSync(file, options)).toBe(source);
    }
  });

  it.each([parseSync, parseWithPositionsSync])(
    'resource refusal is terminal with recovery and permits reuse (%s)',
    (parse) => {
      const source = 'echo ${a[(r)' + '$('.repeat(200) + 'printf foo' + ')'.repeat(200) + ']}';
      for (const RecoverErrors of [0, 100000]) {
        expect(() => parse(source, { Variant: LangZsh, RecoverErrors })).toThrow(
          ShParseMaxDepthError,
        );
        expect(() =>
          parse('echo ${a[(r)$(printf foo)]}', { Variant: LangZsh, RecoverErrors }),
        ).not.toThrow();
      }
    },
  );
});

/** Only these handwritten programs execute; expected stdout comes from Zsh semantics. */
const safeCases = [
  ['plain', 'a=(other foo); echo ${a[(r)foo]}\n', 'foo\n'],
  ['escaped bracket', 'a=(other "foo]bar"); echo ${a[(r)foo\\]bar]}\n', 'foo]bar\n'],
  ['command', 'a=(other foo); echo ${a[(r)$(printf foo)]}\n', 'foo\n'],
  ['quoted command', 'a=(other foo); echo "${a[(r)$(printf foo)]}"\n', 'foo\n'],
  ['parameter', 'a=(other foo); needle=foo; echo ${a[(r)$needle]}\n', 'foo\n'],
  ['quoted parameter', 'a=(other foo); needle=foo; echo "${a[(r)$needle]}"\n', 'foo\n'],
] as const;

/** Keep optional shell discovery and execution bound to the same executable. */
const zshExecutable = 'zsh';

/** Optional native oracle checks successful execution as well as output bytes. */
function stdout(source: string): string {
  const result = spawnSync(zshExecutable, ['-f', '-c', source], { encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout;
}

/** The public structural tests still run on systems without Zsh installed. */
const zshAvailable = spawnSync(zshExecutable, ['-f', '-c', 'exit 0']).status === 0;

describe.each([{}, { KeepPadding: true }])('reverse-subscript printing %j', (options) => {
  it('NAMED LIMIT: foo[0-9] retains pre-pin arithmetic spacing, not general pattern grammar', () => {
    const source = 'echo ${a[(r)foo[0-9]]}\n';
    const file = parseSync(source, { Variant: LangZsh });
    expect(nodes(file).filter((node) => node.Type === 'BinaryArithm')).toHaveLength(1);
    expect(printSync(file, options)).toBe('echo ${a[(r)foo[0 - 9]]}\n');
  });

  describe.skipIf(!zshAvailable)('installed Zsh', () => {
    it.each(safeCases)('preserves handwritten %s stdout', (_name, source, expected) => {
      expect(stdout(source)).toBe(expected);
      const printed = printSync(parseSync(source, { Variant: LangZsh }), options);
      if (typeof printed !== 'string') throw new Error('Expected printed UTF-8 source');
      expect(stdout(printed)).toBe(expected);
    });

    it('NAMED LIMIT: class printing matches foo9 instead of the intended first match foo5', () => {
      const source = 'a=(other foo5 foo9); echo ${a[(r)foo[0-9]]}\n';
      expect(stdout(source)).toBe('foo5\n');
      const printed = printSync(parseSync(source, { Variant: LangZsh }), options);
      if (typeof printed !== 'string') throw new Error('Expected printed UTF-8 source');
      expect(stdout(printed)).toBe('foo9\n');
    });
  });
});
