/**
 * Reverse-subscript arguments are patterns containing ordinary word expansions,
 * not arithmetic expressions or opaque text. Literal brackets and executable
 * nodes must survive independently; only these handwritten programs are run.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { LangZsh, parseSync, printSync, walk } from '../src/index.js';
import { enumerateCommands } from '../src/analyze/index.js';

/** Handwritten Zsh results distinguish preserved spelling from actual matching. */
const fixtures = [
  { pattern: 'foo', stdout: 'foo\n' },
  { pattern: 'foo\\]bar', stdout: 'foo]bar\n' },
  { pattern: 'foo[0-9]', stdout: 'foo7\n' },
  { pattern: 'foo[[:digit:]]', stdout: 'foo7\n' },
  { pattern: '$(printf foo)', stdout: 'foo\n' },
  { pattern: '$needle', stdout: 'foo\n' },
  { pattern: 'foo*', stdout: 'foo\n' },
  { pattern: '$(printf foo)[0-9]', stdout: 'foo7\n' },
];

/** Share the optional native oracle's executable between discovery and use. */
const zshExecutable = 'zsh';

/** Shell discovery is optional; syntax, traversal and printing always run. */
const zshAvailable = spawnSync(zshExecutable, ['-f', '-c', 'exit 0']).status === 0;

/** Execute bounded synthetic controls, never repository or corpus scripts. */
function zshStdout(source: string): string {
  const result = spawnSync(zshExecutable, ['-f', '-c', source], {
    encoding: 'utf8',
    timeout: 5000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout;
}

describe.each([false, true])('Zsh reverse-subscript outer quoted=%s', (quoted) => {
  /** Outer quotes must not hide word expansions inside the subscript. */
  function sourceFor(pattern: string): string {
    const expression = '${a[(r)' + pattern + ']}';
    return `echo ${quoted ? `"${expression}"` : expression}\n`;
  }

  it.each(fixtures)('preserves pattern spelling for $pattern', ({ pattern }) => {
    const source = sourceFor(pattern);
    const file = parseSync(source, { Variant: LangZsh });
    for (const options of [{}, { KeepPadding: true }]) {
      expect(printSync(file, options)).toBe(source);
    }
  });

  it('keeps CmdSubst visible to walk and command enumeration', () => {
    const file = parseSync(sourceFor('$(printf foo)'), { Variant: LangZsh });
    const commands: unknown[] = [];
    const substitutions: unknown[] = [];
    walk(file, (node) => {
      if (node?.Type === 'CallExpr') commands.push(node.Args?.[0]?.Parts?.[0]);
      if (node?.Type === 'CmdSubst') substitutions.push(node);
      return true;
    });
    expect(substitutions).toHaveLength(1);
    expect(commands).toMatchObject([
      { Type: 'Lit', Value: 'echo' },
      { Type: 'Lit', Value: 'printf' },
    ]);
    expect(enumerateCommands(file).map(({ argv0, context }) => ({ argv0, context }))).toEqual([
      { argv0: { static: true, text: 'echo' }, context: [] },
      { argv0: { static: true, text: 'printf' }, context: [{ kind: 'cmdSubst' }] },
    ]);
  });

  it('keeps the needle ParamExp and its source location', () => {
    const source = sourceFor('$needle');
    const parameters: unknown[] = [];
    walk(parseSync(source, { Variant: LangZsh }), (node) => {
      if (node?.Type === 'ParamExp') parameters.push(node);
      return true;
    });
    expect(parameters).toMatchObject([
      { Param: { Value: 'a' } },
      { Short: true, Param: { Value: 'needle' }, Dollar: { Offset: source.indexOf('$needle') } },
    ]);
  });

  describe.skipIf(!zshAvailable)('real Zsh matching', () => {
    it.each(fixtures)('retains handwritten stdout for $pattern', ({ pattern, stdout }) => {
      const source = sourceFor(pattern);
      const setup = "a=(other foo foo7 'foo]bar'); needle=foo; ";
      expect(zshStdout(setup + source)).toBe(stdout);
      const file = parseSync(source, { Variant: LangZsh });
      for (const options of [{}, { KeepPadding: true }]) {
        const printed = printSync(file, options);
        if (typeof printed !== 'string') throw new Error('Expected UTF-8 output');
        expect(zshStdout(setup + printed)).toBe(stdout);
      }
    });
  });
});

it.each(['echo ${a[(r)foo', 'echo ${a[(r)$(printf foo]}'])(
  'rejects an unterminated reverse-subscript: %s',
  (source) => {
    expect(() => parseSync(source, { Variant: LangZsh })).toThrow();
  },
);

/** Enclosing double quotes make apostrophes data without suppressing expansions. */
const apostropheFixtures = [
  { pattern: "don't*", value: "don't-panic", commands: ['echo'] },
  { pattern: "'$(printf foo)'", value: "'foo'", commands: ['echo', 'printf'] },
  { pattern: "'$needle'", value: "'foo'", commands: ['echo'] },
];

describe('Zsh reverse-subscript apostrophes inside outer double quotes', () => {
  it.each(apostropheFixtures)(
    'preserves literal apostrophes in $pattern',
    ({ pattern, commands }) => {
      const source = `echo "\${a[(r)${pattern}]}"\n`;
      const file = parseSync(source, { Variant: LangZsh });
      expect(enumerateCommands(file).map(({ argv0 }) => argv0)).toEqual(
        commands.map((text) => ({ static: true, text })),
      );
      if (pattern.includes('$needle')) {
        const parameters: unknown[] = [];
        walk(file, (node) => {
          if (node?.Type === 'ParamExp') parameters.push(node.Param?.Value);
          return true;
        });
        expect(parameters).toEqual(['a', 'needle']);
      }
      for (const options of [{}, { KeepPadding: true }]) {
        expect(printSync(file, options)).toBe(source);
      }
    },
  );

  describe.skipIf(!zshAvailable)('real Zsh matching', () => {
    it.each(apostropheFixtures)('matches literal apostrophes in $pattern', ({ pattern, value }) => {
      const source = `a=(other "${value}"); needle=foo; echo "\${a[(r)${pattern}]}"`;
      expect(zshStdout(source)).toBe(`${value}\n`);
      const file = parseSync(source, { Variant: LangZsh });
      for (const options of [{}, { KeepPadding: true }]) {
        const output = printSync(file, options);
        if (typeof output !== 'string') throw new Error('Expected UTF-8 output');
        expect(zshStdout(output)).toBe(`${value}\n`);
      }
    });
  });

  it('preserves the exact complete apostrophe control under both printers', () => {
    const source = 'a=(other "don\'t-panic"); echo "${a[(r)don\'t*]}"';
    const canonical = 'a=(other "don\'t-panic")\necho "${a[(r)don\'t*]}"\n';
    const file = parseSync(source, { Variant: LangZsh });
    for (const KeepPadding of [false, true]) {
      // Moving the command after a semicolon onto a new line retains the
      // argument's original column with KeepPadding, as on the preceding main.
      const expected = KeepPadding
        ? canonical.replace('echo ', `echo${' '.repeat(26)}`)
        : canonical;
      expect(printSync(file, { KeepPadding })).toBe(expected);
    }
  });

  it.skipIf(!zshAvailable)('matches the exact complete apostrophe control in installed Zsh', () => {
    const source = 'a=(other "don\'t-panic"); echo "${a[(r)don\'t*]}"';
    expect(zshStdout(source)).toBe("don't-panic\n");
    const file = parseSync(source, { Variant: LangZsh });
    for (const options of [{}, { KeepPadding: true }]) {
      const output = printSync(file, options);
      if (typeof output !== 'string') throw new Error('Expected UTF-8 output');
      expect(zshStdout(output)).toBe("don't-panic\n");
    }
  });

  it.each(["echo ${a[(r)don't*]}", 'echo "${a[(r)$(echo ${b[(r)don\'t*]})]}"'])(
    'does not carry outer double quoting into an unquoted pattern: %s',
    (source) => {
      expect(() => parseSync(source, { Variant: LangZsh })).toThrow();
    },
  );
});
