/**
 * VT and FF are literal shell data, including in an unquoted word. Expected
 * values are hand-written Bash observations, independent of parse/print output.
 * Comments must retain embedded bytes without exposing their suffix as a command.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseSync, printSync } from '../src/index.js';

/** Bash output is checked against a literal expectation for each source position. */
interface IFixture {
  readonly position: string;
  readonly source: string;
  readonly stdout: string;
}

/** These scripts isolate data bytes from formatting and retain a visible suffix. */
function fixtures(byte: string, escape: string): readonly IFixture[] {
  return [
    { position: 'single quotes', source: `printf '%s' 'a${byte}b'\n`, stdout: `a${byte}b` },
    { position: 'double quotes', source: `printf '%s' "a${byte}b"\n`, stdout: `a${byte}b` },
    { position: 'ANSI-C quotes', source: `printf '%s' $'a${byte}b'\n`, stdout: `a${byte}b` },
    {
      position: 'written ANSI-C escape',
      source: `printf '%s' $'a\\${escape}b'\n`,
      stdout: `a${byte}b`,
    },
    { position: 'unquoted word', source: `printf '<%s>' a${byte}b\n`, stdout: `<a${byte}b>` },
    { position: 'here-document', source: `cat <<EOF\na${byte}b\nEOF\n`, stdout: `a${byte}b\n` },
    {
      position: 'tab-stripping here-document',
      source: `cat <<-EOF\n\ta${byte}b\nEOF\n`,
      stdout: `a${byte}b\n`,
    },
    {
      position: 'unquoted here-document delimiter',
      source: `cat <<E${byte}OF\nbody\nE${byte}OF\nprintf '%s' kept\n`,
      stdout: 'body\nkept',
    },
    {
      position: 'escaped here-document delimiter',
      source: `cat <<E\\${byte}OF\nbody\nE${byte}OF\nprintf '%s' kept\n`,
      stdout: 'body\nkept',
    },
    { position: 'comment', source: `# a${byte}b\nprintf '%s' kept\n`, stdout: 'kept' },
  ];
}

describe.each([
  { name: 'VT', byte: '\v', escape: 'v' },
  { name: 'FF', byte: '\f', escape: 'f' },
])('printing literal $name', ({ byte, escape }) => {
  it.each(fixtures(byte, escape))(
    'preserves $position and its Bash value',
    ({ source, stdout }) => {
      const output = printSync(parseSync(source, { KeepComments: true }));
      expect(output).toBe(source);
      for (const script of [source, output]) {
        const shell = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
        expect(shell.error).toBeUndefined();
        expect(shell.status).toBe(0);
        expect(shell.stderr).toBe('');
        expect(shell.stdout).toBe(stdout);
      }
    },
  );
});
