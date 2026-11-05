/**
 * Nested <<- writers retain an upstream byte/marker ordering limit. Ordinary
 * and HT-only output must still match the pinned base, including its defects.
 * Bash preserves body bytes and consumes the exact quote-removed delimiter;
 * the nested printer can instead change body data or emit delimiter text as data.
 */
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { parseSync, printSync } from '../src/index.js';

/** Two tab-stripping heredocs share a command-substitution boundary. */
function bodySource(byte: string): string {
  return `cat <<-OUTER\n\t$(cat <<-INNER\n\t\ta${byte}b\n\t\tINNER\n\t)\nOUTER\n`;
}

/** The backslash quotes the delimiter byte without becoming part of the terminator. */
function delimiterSource(byte: string): string {
  return `cat <<-OUTER\n\t$(cat <<-E\\${byte}ND\n\t\tbody\n\t\tE${byte}ND\n\t)\nOUTER\n`;
}

/** These hand-written fixtures are valid UTF-8 programs with observable stdout. */
function printed(source: string): string {
  const output = printSync(parseSync(source, { KeepComments: true }));
  if (typeof output !== 'string') {
    throw new Error('Expected UTF-8 fixture');
  }
  return output;
}

/** Bash versions differ on malformed printed delimiters; retain each observable result. */
function bashRun(source: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('bash', ['-c', source], { encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Only the synthetic fixture is executed; Bash is the independent value oracle. */
function bashStdout(source: string): string {
  const result = bashRun(source);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout;
}

it.each(['X', '\t'])('retains base nested body and delimiter spelling for %j', (byte) => {
  // Base observations deliberately retain the existing HT-to-space body defect.
  const body = printed(bodySource(byte));
  expect(body).toBe(
    `cat <<-OUTER\n\t$(\n\t\tcat <<-INNER\na${byte === '\t' ? ' ' : byte}b\n\t\t\t\tINNER\n\t)\nOUTER\n`,
  );
  expect(bashStdout(bodySource(byte))).toBe(`a${byte}b\n`);
  expect(bashStdout(body)).toBe(`a${byte === '\t' ? ' ' : byte}b\n`);
  expect(printed(delimiterSource(byte))).toBe(
    `cat <<-OUTER\n\t$(\n\t\tcat <<-E\\${byte === '\t' ? ' ' : byte}ND\nbody\n\t\t\t\tE${byte === '\t' ? ' ' : byte}ND\n\t)\nOUTER\n`,
  );
  expect(bashStdout(delimiterSource(byte))).toBe('body\n');
  expect(bashStdout(printed(delimiterSource(byte)))).toBe('body\n');
});

it.each(['\v', '\f'])('records the known nested control-byte limit for %j', (byte) => {
  // Bash retains a<byte>b and prints only body after the exact E<byte>ND
  // delimiter. The nested printer changes the body. Its malformed terminator
  // leaks delimiter text under Bash 3.2, while Bash 5.3 rejects the substitution.
  expect(bashStdout(bodySource(byte))).toBe(`a${byte}b\n`);
  expect(bashStdout(printed(bodySource(byte)))).toBe(byte === '\v' ? 'a b\n' : 'a\nb\n');
  expect(bashStdout(delimiterSource(byte))).toBe('body\n');
  const result = bashRun(printed(delimiterSource(byte)));
  if (result.status === 0) {
    expect(result.stdout).toBe(`body\n   E${byte}ND\n`);
    expect(result.stderr).toBe('');
  } else {
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('here-document');
    expect(result.stderr).toContain('unexpected EOF');
  }
});
