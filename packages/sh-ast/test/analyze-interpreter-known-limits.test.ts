/**
 * Bounded interpreter contract: supported fixes and deliberately retained
 * approximations. Known-limit expectations describe current analysis, while
 * each comment records the independent real-shell outcome from the named builds.
 */
import { describe, expect, it } from 'vitest';
import { enumerateCommands, resolveArgv0 } from '../src/analyze/index.js';
import type { Argv0Resolution, ResolveArgv0Options } from '../src/analyze/index.js';
import { parseSync, ShAnalyzeInvalidWrapperSpecError } from '../src/index.js';

/** Resolves one syntactic invocation; expectations remain literal shell facts. */
function resolve(source: string, options?: ResolveArgv0Options): Argv0Resolution {
  const sites = enumerateCommands(parseSync(source));
  expect(sites).toHaveLength(1);
  return resolveArgv0(sites[0], options);
}

describe('bounded interpreter fixes', () => {
  // Apple ksh93u+ 2012-08-01 and Linux ksh93u+m 1.0.8 execute the actual
  // marker-named script for each positive-sign form, not its command text.
  it.each(['ksh', 'ksh93'])('%s positive c forms stay static', (name) => {
    for (const flags of ['+c', '+ec', '+o +c']) {
      const result = resolve(`${name} ${flags} 'printf COMMAND_STRING'`);
      expect(result.effective).toEqual({ static: true, text: name });
      expect(result.chainIndices).toEqual([0]);
    }
  });

  it('Apple ksh -R consumes the database path rather than selecting -c', () => {
    // Apple ksh creates a database named -c and does not execute script.sh.
    expect(resolve('ksh -R -c script.sh').effective).toEqual({ static: true, text: 'ksh' });
  });

  it.each(['noOperandLongOptions', 'operandLongOptions', 'optionTerminatorWords'])(
    'rejects reserved -c in %s',
    (field) => {
      const entry = {
        names: ['bash'],
        operandOptions: [],
        operandAttachment: 'separate-word',
        [field]: ['-c'],
      };
      expect(() => resolve('bash -c x', { embeddedCommandInterpreters: [entry as never] })).toThrow(
        ShAnalyzeInvalidWrapperSpecError,
      );
    },
  );

  it.each([{}, 'bash', 42, new Set(), null])('rejects a non-array table: %j', (table) => {
    expect(() => resolve('echo x', { embeddedCommandInterpreters: table as never })).toThrow(
      ShAnalyzeInvalidWrapperSpecError,
    );
  });
});

describe('known limits of the common-spelling grammar', () => {
  it.each(['bash', 'sh'])(
    'known limit: %s single-dash long option after a short option',
    (name) => {
      // Bash 5.3.9/3.2.57 and Bash-backed sh run the marker here: -rcfile
      // belongs to their later short-option phase, not the initial long phase.
      expect(resolve(`${name} -e -rcfile 'printf COMMAND_STRING'`).effective).toEqual({
        static: true,
        text: name,
      });
    },
  );
  it('known limit: ksh +c does not clear a previously selected -c', () => {
    // Both tested ksh builds run the marker-named script after +c clears -c.
    expect(resolve("ksh -c +c 'printf COMMAND_STRING'").effective).toEqual({
      static: false,
      reason: 'embedded-command',
    });
  });
  it('known limit: a dynamic word after -c can expand to an option', () => {
    // Apple ksh with opts=+c runs the marker-named script, not the string.
    expect(resolve('ksh -c "$opts" \'printf COMMAND_STRING\'').effective).toEqual({
      static: false,
      reason: 'embedded-command',
    });
  });
  it.each(['-c', '+c'])('known limit: mksh -o %s can select a command string', (sign) => {
    // Linux mksh R59 executes the string for both forms even with a
    // same-named script present; this table consumes the sign as an operand.
    expect(resolve(`mksh -o ${sign} 'printf COMMAND_STRING'`).effective).toEqual({
      static: true,
      text: 'mksh',
    });
  });
  it('known limit: bash skips a lone + before -c', () => {
    // Bash 5.3.9 runs the command string; the table treats + as an operand.
    expect(resolve("bash + -c 'printf COMMAND_STRING'").effective).toEqual({
      static: true,
      text: 'bash',
    });
  });
  it('known limit: zsh shoptionletters changes the meaning of -b', () => {
    // Zsh 5.9 runs the command string with shoptionletters enabled.
    expect(resolve("zsh -o shoptionletters -b -c 'printf COMMAND_STRING'").effective).toEqual({
      static: true,
      text: 'zsh',
    });
  });
});
