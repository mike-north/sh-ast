/**
 * Nested <<- writer composition retains literal data and quote-removed closing
 * words. Real Bash checks hand-written stdout rather than printer-derived values.
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

/** Expose exit status and diagnostics independently of the expected body bytes. */
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

it.each(['X', '\t', '\v', '\f'])('preserves nested body and delimiter bytes for %j', (byte) => {
  const body = printed(bodySource(byte));
  expect(body).toBe(
    `cat <<-OUTER\n\t$(\n\t\tcat <<-INNER\n\t\t\ta${byte}b\n\t\tINNER\n\t)\nOUTER\n`,
  );
  expect(bashStdout(bodySource(byte))).toBe(`a${byte}b\n`);
  expect(bashStdout(body)).toBe(`a${byte}b\n`);
  expect(printed(delimiterSource(byte))).toBe(
    `cat <<-OUTER\n\t$(\n\t\tcat <<-E\\${byte}ND\n\t\t\tbody\n\t\tE${byte}ND\n\t)\nOUTER\n`,
  );
  expect(bashStdout(delimiterSource(byte))).toBe('body\n');
  expect(bashStdout(printed(delimiterSource(byte)))).toBe('body\n');
});
