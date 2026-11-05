/**
 * Zsh option prefixes precede length/existence prefixes. Printing must preserve
 * those independent meanings when the result is parsed again, on every host.
 * Native stdout is additional evidence and explicitly skips without Zsh on PATH.
 * Only these hand-written programs are executed; no corpus source is run.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { LangZsh, parseSync, printSync } from '../src/index.js';
import type { File, ParamExp } from '../src/index.js';

/** Explicit fields and stdout specify the meaning of each prefix combination. */
interface IPrefixFixture {
  readonly expression: string;
  readonly canonical: string;
  readonly split: number;
  readonly glob: number;
  readonly rc: number;
  readonly length: boolean;
  readonly isset: boolean;
  readonly stdout: string;
}

/** On/off forms and mixed ordering retain their own option-state identities. */
const fixtures: readonly IPrefixFixture[] = [
  {
    expression: '${=#a}',
    canonical: '${=#a}',
    split: 1,
    glob: 0,
    rc: 0,
    length: true,
    isset: false,
    stdout: '<3>\n',
  },
  {
    expression: '${==#a}',
    canonical: '${==#a}',
    split: 2,
    glob: 0,
    rc: 0,
    length: true,
    isset: false,
    stdout: '<3>\n',
  },
  {
    expression: '${~#a}',
    canonical: '${~#a}',
    split: 0,
    glob: 1,
    rc: 0,
    length: true,
    isset: false,
    stdout: '<3>\n',
  },
  {
    expression: '${~~#a}',
    canonical: '${~~#a}',
    split: 0,
    glob: 2,
    rc: 0,
    length: true,
    isset: false,
    stdout: '<3>\n',
  },
  {
    expression: '${^#a}',
    canonical: '${^#a}',
    split: 0,
    glob: 0,
    rc: 1,
    length: true,
    isset: false,
    stdout: '<3>\n',
  },
  {
    expression: '${^^#a}',
    canonical: '${^^#a}',
    split: 0,
    glob: 0,
    rc: 2,
    length: true,
    isset: false,
    stdout: '<3>\n',
  },
  {
    expression: '${^~=#a}',
    canonical: '${=~^#a}',
    split: 1,
    glob: 1,
    rc: 1,
    length: true,
    isset: false,
    stdout: '<3>\n',
  },
  {
    expression: '${^^~~==#a}',
    canonical: '${==~~^^#a}',
    split: 2,
    glob: 2,
    rc: 2,
    length: true,
    isset: false,
    stdout: '<3>\n',
  },
  {
    expression: '${=+a}',
    canonical: '${=+a}',
    split: 1,
    glob: 0,
    rc: 0,
    length: false,
    isset: true,
    stdout: '<1>\n',
  },
  {
    expression: '${~~+a}',
    canonical: '${~~+a}',
    split: 0,
    glob: 2,
    rc: 0,
    length: false,
    isset: true,
    stdout: '<1>\n',
  },
  {
    expression: '${^+a}',
    canonical: '${^+a}',
    split: 0,
    glob: 0,
    rc: 1,
    length: false,
    isset: true,
    stdout: '<1>\n',
  },
  {
    expression: '${^^~~==+a}',
    canonical: '${==~~^^+a}',
    split: 2,
    glob: 2,
    rc: 2,
    length: false,
    isset: true,
    stdout: '<1>\n',
  },
  {
    expression: '${#a}',
    canonical: '${#a}',
    split: 0,
    glob: 0,
    rc: 0,
    length: true,
    isset: false,
    stdout: '<3>\n',
  },
  {
    expression: '${+a}',
    canonical: '${+a}',
    split: 0,
    glob: 0,
    rc: 0,
    length: false,
    isset: true,
    stdout: '<1>\n',
  },
  {
    expression: '${=a}',
    canonical: '${=a}',
    split: 1,
    glob: 0,
    rc: 0,
    length: false,
    isset: false,
    stdout: '<abc>\n',
  },
];

/** The final printf argument is the expansion whose interpretation is at risk. */
function parameter(file: File): ParamExp {
  const command = file.Stmts?.at(-1)?.Cmd;
  if (command?.Type !== 'CallExpr') throw new Error('Expected printf command');
  const part = command.Args?.at(-1)?.Parts?.[0];
  if (part?.Type !== 'ParamExp') throw new Error('Expected parameter expansion');
  return part;
}

/** One command identity keeps discovery and optional oracle execution consistent. */
const zshExecutable = 'zsh';

/** Match the optional-native-shell pattern: require a callable Zsh on PATH. */
const zshAvailable = spawnSync(zshExecutable, ['-f', '-c', 'exit 0']).status === 0;

/** Only the availability-guarded native suite executes these synthetic programs. */
function zshStdout(source: string): string {
  const result = spawnSync(zshExecutable, ['-f', '-c', source], { encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout;
}

describe.each([{}, { KeepPadding: true }])('Zsh prefix order with %j', (options) => {
  it.each(fixtures)(
    'retains $expression public fields and spelling without native tools',
    (fixture) => {
      const source = `a=abc\nprintf '<%s>\\n' ${fixture.expression}\n`;
      const expected = `a=abc\nprintf '<%s>\\n' ${fixture.canonical}\n`;
      const file = parseSync(source, { Variant: LangZsh });
      const output = printSync(file, options);
      if (typeof output !== 'string') throw new Error('Expected UTF-8 source');
      const reparsed = parseSync(output, { Variant: LangZsh });
      const fields = {
        Split: fixture.split,
        GlobSubst: fixture.glob,
        RcExpand: fixture.rc,
        Length: fixture.length,
        IsSet: fixture.isset,
        Width: false,
        Excl: false,
        Param: { Value: 'a' },
        Exp: null,
      };
      expect(parameter(file)).toMatchObject(fields);
      expect(parameter(reparsed)).toMatchObject(fields);
      expect(output).toBe(expected);
    },
  );

  describe.skipIf(!zshAvailable)(
    'native Zsh oracle (requires zsh on PATH; otherwise skipped)',
    () => {
      it.each(fixtures)('preserves the hand-written Zsh stdout for $expression', (fixture) => {
        const source = `a=abc\nprintf '<%s>\\n' ${fixture.expression}\n`;
        const output = printSync(parseSync(source, { Variant: LangZsh }), options);
        if (typeof output !== 'string') throw new Error('Expected UTF-8 source');
        expect(zshStdout(source)).toBe(fixture.stdout);
        expect(zshStdout(output)).toBe(fixture.stdout);
      });
    },
  );
});
