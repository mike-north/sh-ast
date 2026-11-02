/** Printing operates on current faithful records; positions are formatting hints, not source slices. */
import { describe, expect, it } from 'vitest';
import type { CallExpr, Lit, Node, SyntaxPos } from '../generated/syntax-types.js';
import { OrStmt } from '../generated/syntax-constants.js';
import { ShAstError } from '../src/errors.js';
import { InputError } from '../src/syntax-errors.js';
import { parseSync } from '../src/syntax.js';
import { printSync, type PrintOptions } from '../src/syntax-print.js';
import { PrintError, PrintPanicError } from '../src/syntax-print-errors.js';

/** Constructed values use the upstream zero position, without implying source ownership. */
const zero: SyntaxPos = {
  Offset: 0,
  Line: 0,
  Col: 0,
  IsValid: false,
  IsRecovered: false,
  OffsetOverflow: false,
};
/** A literal's text remains authoritative when old/invalid token positions are retained. */
const literal = (Value: string | Uint8Array): Lit => ({
  Type: 'Lit',
  Value,
  ValuePos: zero,
  ValueEnd: zero,
});
/** Fixture narrowing fails loudly when the independent shell example changes shape. */
function command(source: string): CallExpr {
  const cmd = parseSync(source).Stmts?.[0]?.Cmd;
  if (cmd?.Type !== 'CallExpr') throw new Error('Expected fixture command');
  return cmd;
}

describe('printSync', () => {
  it('prints edited text and operators from the current tree and preserves unrelated operands', () => {
    const file = parseSync("# keep 🎉\nprintf '%s\\n' 'old 🎉'\n", { KeepComments: true });
    const cmd = file.Stmts?.[0]?.Cmd;
    if (cmd?.Type !== 'CallExpr') throw new Error('Expected printf');
    const quoted = cmd.Args?.[2]?.Parts?.[0];
    if (quoted?.Type !== 'SglQuoted') throw new Error('Expected quoted operand');
    quoted.Value = 'new 你好 e\u0301';
    const output = printSync(file);
    expect(output).toBe("# keep 🎉\nprintf '%s\\n' 'new 你好 e\u0301'\n");
    if (typeof output !== 'string') throw new Error('Expected UTF-8 output');
    expect(command(output).Args?.map((word) => word?.Parts?.[0])).toMatchObject([
      { Type: 'Lit', Value: 'printf' },
      { Type: 'SglQuoted', Value: '%s\\n' },
      { Type: 'SglQuoted', Value: 'new 你好 e\u0301' },
    ]);
    const binary = parseSync('echo left && echo 你好\n');
    const operator = binary.Stmts?.[0]?.Cmd;
    if (operator?.Type !== 'BinaryCmd') throw new Error('Expected binary command');
    operator.Op = OrStmt;
    expect(printSync(binary)).toBe('echo left || echo 你好\n');
  });

  it('prints constructed/stale-position nodes and preserves each supported root newline rule', () => {
    expect(
      printSync({
        Type: 'Word',
        Parts: [
          literal('hello'),
          { Type: 'SglQuoted', Left: zero, Right: zero, Dollar: false, Value: ' 🎉' },
        ],
      }),
    ).toBe("hello' 🎉'");
    const file = parseSync('echo x\n');
    const stmt = file.Stmts?.[0];
    if (!stmt || stmt.Cmd?.Type !== 'CallExpr') throw new Error('Expected statement');
    const lit = stmt.Cmd.Args?.[1]?.Parts?.[0];
    if (lit?.Type !== 'Lit') throw new Error('Expected literal');
    lit.Value = 'longer🎉';
    expect(printSync(file)).toBe('echo longer🎉\n');
    expect(printSync(stmt)).toBe('echo longer🎉');
    expect(printSync(stmt.Cmd)).toBe('echo longer🎉');
    expect(printSync(lit)).toBe('longer🎉');
    expect(printSync(parseSync(''))).toBe('\n');
  });

  // These expected strings are captured from independent pinned Go NewPrinter
  // invocations, not output from this bridge or a parse/print round-trip oracle.
  it.each<[string, string, PrintOptions, string]>([
    ['Indent', 'if true; then\necho hi\nfi\n', { Indent: 2 }, 'if true; then\n  echo hi\nfi\n'],
    ['BinaryNextLine', 'echo a |\ncat\n', { BinaryNextLine: true }, 'echo a \\\n\t| cat\n'],
    [
      'SwitchCaseIndent',
      'case x in\na) echo a;;\nesac\n',
      { SwitchCaseIndent: true },
      'case x in\n\ta) echo a ;;\nesac\n',
    ],
    ['SpaceRedirects', 'echo hi >out 2>&1\n', { SpaceRedirects: true }, 'echo hi > out 2>&1\n'],
    [
      'KeepPadding',
      'echo   a\necho   longer\n',
      { KeepPadding: true },
      'echo   a\necho   longer\n',
    ],
    [
      'Minify',
      '# keep 🎉\nif true; then\necho hi\nfi\n',
      { Minify: true },
      'if true;then\necho hi\nfi\n',
    ],
    ['SingleLine', '{\necho a\necho b\n}\n', { SingleLine: true }, '{ echo a; echo b; }\n'],
    [
      'FunctionNextLine',
      'f() { echo hi; }\n',
      { FunctionNextLine: true },
      'f()\n{\n\techo hi\n}\n',
    ],
  ])('passes the observable %s option', (_name, source, options, output) => {
    expect(printSync(parseSync(source, { KeepComments: true }), options)).toBe(output);
  });

  it('retains explicit false defaults, bigint indentation and fresh printer state', () => {
    const file = parseSync('# keep\nif true; then\necho hi\nfi\n', { KeepComments: true });
    const expected = '# keep\nif true; then\n\techo hi\nfi\n';
    expect(printSync(file, { Minify: true })).not.toBe(expected);
    expect(printSync(file)).toBe(expected);
    expect(
      printSync(file, {
        Indent: 0n,
        BinaryNextLine: false,
        SwitchCaseIndent: false,
        SpaceRedirects: false,
        KeepPadding: false,
        Minify: false,
        SingleLine: false,
        FunctionNextLine: false,
      }),
    ).toBe(expected);
    expect(printSync(file, { Indent: 2n })).toContain('\n  echo hi\n');
    expect(printSync(file)).toBe(expected);
  });

  it('collects upstream bytes including its tabwriter escape-byte behavior', () => {
    expect(printSync(literal(new Uint8Array([0x78, 0xfe])))).toEqual(new Uint8Array([0x78, 0xfe]));
    expect(printSync(literal(new Uint8Array([0x78, 0xff])))).toBe('x');
  });

  it('preserves ordinary upstream errors separately from printer panics and recovers reuse', () => {
    const unsupported: Node = { Type: 'Comment', Hash: zero, Text: 'comment' };
    expect(() => printSync(unsupported)).toThrow(PrintError);
    expect(() => printSync({ Type: 'TypedNil', Kind: 'Comment' })).toThrow(PrintError);
    expect(() => printSync({ Type: 'TypedNil', Kind: 'Word' })).toThrow(PrintPanicError);
    expect(() => printSync({ Type: 'Word', Parts: null })).toThrow(PrintPanicError);
    expect(() =>
      printSync({ Type: 'TypedNil', Kind: 'Word' }, { Minify: true, SingleLine: true }),
    ).toThrow(PrintError);
    expect(() => printSync(parseSync(''), { Indent: (1n << 64n) - 1n })).toThrow(PrintPanicError);
    expect(printSync(parseSync('echo okay'))).toBe('echo okay\n');
    for (const [Failure, code] of [
      [PrintError, 'SH_AST_SYNTAX_PRINT'],
      [PrintPanicError, 'SH_AST_SYNTAX_PRINT_PANIC'],
    ] as const) {
      const failure = new Failure(new Uint8Array([0xfe]));
      expect(failure).toBeInstanceOf(ShAstError);
      expect(failure).toMatchObject({ code, Message: new Uint8Array([0xfe]) });
      expect(failure.message).toBe('\ufffd');
    }
  });

  it('keeps heredoc and recovered parser data printable', () => {
    const source = "# keep 🎉\ncat <<'EOF'\n你好 e\u0301\nEOF\necho done\n";
    expect(printSync(parseSync(source, { KeepComments: true }), { SingleLine: true })).toBe(
      "# keep 🎉\ncat <<'EOF'; echo done\n你好 e\u0301\nEOF\n",
    );
    expect(printSync(parseSync('(foo |', { RecoverErrors: 2 }))).toBe('(foo |)\n');
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, -1n, 1n << 64n, NaN, Infinity])(
    'rejects unrepresentable Indent %s',
    (Indent) => {
      expect(() => printSync(parseSync(''), { Indent })).toThrow(InputError);
    },
  );
});
