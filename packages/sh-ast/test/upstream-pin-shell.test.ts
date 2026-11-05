/**
 * Small hand-written shell outcomes explain the corpus delta groups. These are
 * the only executed programs: corpus files are never used as executable tests.
 */
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { ParseError, parseSync, printSync } from '../src/index.js';

/** Each source isolates one upstream lexer or printer boundary. */
const fixtures = [
  {
    name: 'quoted arguments inside backticks',
    source:
      'value="alpha beta"; quote() { printf "<%s>" "$@"; }; printf "%s\\n" "`quote \\"${value}\\"`"\n',
    stdout: '<alpha beta>\n',
  },
  {
    name: 'adjacent bracket literals within brace expansion',
    source:
      'set -f; prefix=p; suffix=s; printf "<%s>\\n" "${prefix}/"{[[:digit:]][[:digit:]][[:digit:]]"${suffix}","${suffix}"}\n',
    stdout: '<p/[[:digit:]][[:digit:]][[:digit:]]s>\n<p/s>\n',
  },
  {
    name: 'subshell closing parentheses',
    source: 'value=$( (printf "%s" safe) ); printf "%s\\n" "$value"\n',
    stdout: 'safe\n',
  },
  {
    name: 'stored command-substitution close column',
    source: 'value=$(printf "%s" safe    ); printf "%s\\n" "$value"\n',
    stdout: 'safe\n',
  },
];

it.each(fixtures)(
  'preserves Bash stdout for $name under default and KeepPadding',
  ({ source, stdout }) => {
    for (const text of [
      source,
      printSync(parseSync(source)),
      printSync(parseSync(source), { KeepPadding: true }),
    ]) {
      expect(typeof text).toBe('string');
      const result = spawnSync(process.env.SH_AST_TEST_BASH ?? 'bash', ['-c', String(text)], {
        encoding: 'utf8',
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe(stdout);
    }
  },
);

it('retains the missing-terminator refusal on the tagged release', () => {
  expect(() => parseSync('cat <<X\nbody\n')).toThrow(ParseError);
  expect(() => parseSync('cat <<X\nbody\n')).toThrow('1:5: unclosed here-document `X`');
});
