/**
 * Bash strips <<- tabs at logical-line starts. Tabs after an active backslash
 * continuation are data, so formatting must preserve them exactly. Expected
 * stdout and printed spellings are hand-written, independent of the printer.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseSync, printSync } from '../src/index.js';
import type { PrintOptions } from '../src/index.js';

/** Each fixture specifies the shell value as well as the allowed layout change. */
interface IFixture {
  readonly name: string;
  readonly body: string;
  readonly printedBody: string;
  readonly stdout: string;
}

/** These physical lines exercise continuation parity, chains, and return to layout. */
const fixtures: readonly IFixture[] = [
  {
    name: 'issue 81',
    body: '\tXa\\\n\tmore\n',
    printedBody: '\t\tXa\\\n\tmore\n',
    stdout: 'Xa\tmore\n',
  },
  {
    name: 'no tabs after continuation',
    body: '\tXa\\\nmore\n',
    printedBody: '\t\tXa\\\nmore\n',
    stdout: 'Xamore\n',
  },
  {
    name: 'extra tabs after continuation',
    body: '\tXa\\\n\t\tmore\n',
    printedBody: '\t\tXa\\\n\t\tmore\n',
    stdout: 'Xa\t\tmore\n',
  },
  {
    name: 'continuation chain',
    body: '\tXa\\\n\tmore\\\n\tend\n\tlast\n',
    printedBody: '\t\tXa\\\n\tmore\\\n\tend\n\t\tlast\n',
    stdout: 'Xa\tmore\tend\nlast\n',
  },
  {
    name: 'tabs-only continuation line',
    body: '\tXa\\\n\t\n\tlast\n',
    printedBody: '\t\tXa\\\n\t\n\t\tlast\n',
    stdout: 'Xa\t\nlast\n',
  },
  {
    name: 'even backslash run',
    body: '\tXa\\\\\n\tmore\n',
    printedBody: '\t\tXa\\\\\n\t\tmore\n',
    stdout: 'Xa\\\nmore\n',
  },
  {
    name: 'odd backslash run',
    body: '\tXa\\\\\\\n\tmore\n',
    printedBody: '\t\tXa\\\\\\\n\tmore\n',
    stdout: 'Xa\\\tmore\n',
  },
  {
    name: 'expansion after continuation',
    body: '\tXa\\\n\t${value}\n',
    printedBody: '\t\tXa\\\n\t${value}\n',
    stdout: 'Xa\tmore\n',
  },
  {
    name: 'no continuation',
    body: '\tXa\n\tmore\n',
    printedBody: '\t\tXa\n\t\tmore\n',
    stdout: 'Xa\nmore\n',
  },
];

/** Hand-authored shell programs are the only inputs executed by these tests. */
function bashStdout(script: string): string {
  const result = spawnSync(process.env.SH_AST_TEST_BASH ?? 'bash', ['-c', script], {
    encoding: 'utf8',
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout;
}

/** The public API must keep these UTF-8 fixtures textual and stable on reprint. */
function printText(source: string, options: PrintOptions = {}): string {
  const output = printSync(parseSync(source), options);
  if (typeof output !== 'string') {
    throw new Error('Expected UTF-8 fixture');
  }
  return output;
}

describe.each([
  { name: 'defaults', options: {} },
  { name: 'KeepPadding', options: { KeepPadding: true } },
])('$name <<- logical lines', ({ options }) => {
  it.each(fixtures)('preserves $name', ({ body, printedBody, stdout }) => {
    const source = `value=more\nif true; then\ncat <<-EOF\n${body}\tEOF\nfi\n`;
    const expected = `value=more\nif true; then\n\tcat <<-EOF\n${printedBody}\tEOF\nfi\n`;
    // The source's hand-written Bash value is the oracle for printed behavior.
    expect(bashStdout(source)).toBe(stdout);
    const output = printText(source, options);
    expect(bashStdout(output)).toBe(stdout);
    expect(output).toBe(expected);
    expect(printText(output, options)).toBe(expected);
  });

  it.each(["'EOF'", '"EOF"', 'E\\OF', "E'OF'"])(
    'keeps quoted delimiter %s bodies literal',
    (delimiter) => {
      const source = `if true; then\ncat <<-${delimiter}\n\tXa\\\n\tmore\n\tEOF\nfi\n`;
      const expected = `if true; then\n\tcat <<-${delimiter}\n\t\tXa\\\n\t\tmore\n\tEOF\nfi\n`;
      expect(printText(source, options)).toBe(expected);
      expect(bashStdout(source)).toBe('Xa\\\nmore\n');
      expect(bashStdout(expected)).toBe('Xa\\\nmore\n');
    },
  );

  it('retains following-line layout with the known internal heredoc tab limit', () => {
    const source = 'if true; then\ncat <<-EOF\n\tXa\\\n\tmore\n\ta\tX\n\tbbbbb\tY\n\tEOF\nfi\n';
    const expected =
      'if true; then\n\tcat <<-EOF\n\t\tXa\\\n\tmore\n\t\ta     X\n\t\tbbbbb Y\n\tEOF\nfi\n';
    // The base already aligns internal HT as columns in ordinary <<- lines.
    // Preserve that layout limit without letting a continuation change its rows.
    expect(bashStdout(source)).toBe('Xa\tmore\na\tX\nbbbbb\tY\n');
    const output = printText(source, options);
    expect(output).toBe(expected);
    expect(bashStdout(output)).toBe('Xa\tmore\na     X\nbbbbb Y\n');
  });

  it('keeps plain << bodies unchanged', () => {
    const source = 'if true; then\ncat <<EOF\n\tXa\\\n\tmore\nEOF\nfi\n';
    const expected = 'if true; then\n\tcat <<EOF\n\tXa\\\n\tmore\nEOF\nfi\n';
    expect(printText(source, options)).toBe(expected);
    expect(bashStdout(source)).toBe('\tXa\tmore\n');
    expect(bashStdout(expected)).toBe('\tXa\tmore\n');
  });
});
