/**
 * VT and FF are literal shell data, including in an unquoted word. Expected
 * values are hand-written Bash observations, independent of parse/print output.
 * Comments must retain embedded bytes without exposing their suffix as a command.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseSync, printSync } from '../src/index.js';
import type { PrintOptions } from '../src/index.js';

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

/** Valid UTF-8 layout fixtures must remain textual rather than becoming byte strings. */
function printText(source: string, options: PrintOptions = {}): string {
  const output = printSync(parseSync(source, { KeepComments: true }), options);
  if (typeof output !== 'string') {
    throw new Error('Expected UTF-8 fixture output');
  }
  return output;
}

describe.each([
  { name: 'VT', byte: '\v', escape: 'v' },
  { name: 'FF', byte: '\f', escape: 'f' },
])('printing literal $name', ({ byte, escape }) => {
  it.each(fixtures(byte, escape))(
    'preserves $position and its Bash value',
    ({ source, stdout }) => {
      const output = printText(source);
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

  it('retains the documented upstream KeepPadding escape-marker limit', () => {
    // KeepPadding is deprecated and tracks its layout bugs in mvdan/sh#658:
    // https://github.com/mvdan/sh/issues/658. Like HT, protected VT/FF cause its
    // counter to count stripped markers, shrinking padding on repeated prints.
    // Preserve that limit rather than changing ordinary or HT-only output.
    const source = `x='a${byte}b'    # comment\ny='longword' # another\n`;
    const options = { KeepPadding: true };
    const first = printText(source, options);
    expect(first).toBe(`x='a${byte}b'  # comment\ny='longword' # another\n`);
    expect(printText(first, options)).toBe(`x='a${byte}b' # comment\ny='longword' # another\n`);
  });

  it('aligns physical lines around a multiline literal as it does for an ordinary byte', () => {
    const ordinary = "printf '%s' 'longqfirst\nx' # first\nprintf x # second\n";
    const source = ordinary.replace('longqfirst', `long${byte}first`);
    const reference = printText(ordinary);
    const first = printText(source);
    expect(reference).toBe("printf '%s' 'longqfirst\nx'       # first\nprintf x # second\n");
    expect(first.replace(byte, 'q')).toBe(reference);
    expect(printText(first)).toBe(first);
  });
});

it.each([
  ["if true; then\n  printf '%s' ok\nfi\n", "if true; then\n\tprintf '%s' ok\nfi\n"],
  [
    "x='a\tb'    # comment\ny='longword' # another\n",
    "x='a\tb'  # comment\ny='longword' # another\n",
  ],
])('retains base KeepPadding bytes for a source without VT/FF', (source, expected) => {
  // These baseline observations are compatibility requirements, including the
  // imperfect HT padding. They guard the shared counter against scope expansion.
  expect(printText(source, { KeepPadding: true })).toBe(expected);
});

it('retains the upstream multiline horizontal-tab alignment limit', () => {
  // The base printer also escapes the entire literal when it contains HT. That
  // hides its LF from tabwriter and misaligns these comments. Preserve that known
  // upstream limit rather than changing horizontal-tab behavior in this fix.
  const source = "printf '%s' 'long\tfirst\nx' # first\nprintf x # second\n";
  expect(printSync(parseSync(source, { KeepComments: true }))).toBe(
    "printf '%s' 'long\tfirst\nx' # first\nprintf x                   # second\n",
  );
});
