/**
 * Tests for {@link parseSync} against the acceptance criteria in
 * https://github.com/mike-north/eslint-sh/issues/4 (criteria 1, 3, 4, 5).
 *
 * @see design/ARCHITECTURE.md — serialization contract, parse errors and dialects
 * @see design/PACKAGES.md §`sh-ast` — the public API under test
 */
import { describe, expect, it } from 'vitest';
import { parseSync, ShParseError, walk } from '../src/index.js';
import { isResultEnvelope } from '../src/parse.js';
import type { ShNode } from '../src/index.js';

const sh = String.raw;

describe('parseSync — criterion 1: normalized tree shape', () => {
  it("returns a normalized tree where file.stmts[0].cmd.type === 'CallExpr' and cmd.args[0].parts[0] is Lit 'echo'", () => {
    const file = parseSync('echo hi');
    const cmd = file.stmts[0]?.cmd as {
      type: string;
      args: { parts: { type: string; value: string }[] }[];
    };
    expect(cmd.type).toBe('CallExpr');
    // Every normalized node also always carries `range`/`loc` (design/ARCHITECTURE.md's
    // "Normalized node shape"); toMatchObject checks the type/value pair the
    // acceptance criterion names without over-asserting on those.
    expect(cmd.args[0]?.parts[0]).toMatchObject({ type: 'Lit', value: 'echo' });
  });
});

describe('parseSync — regression: IfClause.Last (trailing comment before fi/elif/else)', () => {
  // STATIC_CHILD_TYPES.IfClause was missing a `Last: 'Comment'` entry (mvdan/sh's
  // IfClause struct has `Last []Comment` — "comments on the first elif, else,
  // or fi"; see mvdan/sh's syntax/nodes.go). Since Comment is a concrete
  // struct type, typedjson doesn't tag its instances with their own "Type",
  // so normalize() relied entirely on this table to resolve the type of
  // items in an IfClause's "Last" field — with no entry, it threw "node
  // without resolvable type" for any if-statement with a comment
  // immediately before its closing fi/elif/else, even though that's
  // syntactically valid, everyday shell.
  it('parses an if-statement with a comment immediately before "fi" without throwing', () => {
    const file = parseSync('if true; then\n  echo hi\n# trailing comment\nfi\n');
    expect(file.type).toBe('File');
    let sawComment = false;
    walk(file, (node: ShNode) => {
      if (node.type === 'Comment') sawComment = true;
    });
    expect(sawComment).toBe(true);
  });

  it('parses an if/elif-statement with a comment immediately before "elif" without throwing', () => {
    const file = parseSync(
      'if false; then\n  echo a\n# trailing comment\nelif true; then\n  echo b\nfi\n',
    );
    expect(file.type).toBe('File');
  });
});

describe('parseSync — criterion 3: parse errors carry real positions', () => {
  it("throws ShParseError with .line/.column/.filename matching mvdan's reported position for `if true; then\\n`", () => {
    expect.assertions(5);
    try {
      parseSync('if true; then\n', { filename: 'b.sh' });
    } catch (error) {
      expect(error).toBeInstanceOf(ShParseError);
      const parseError = error as ShParseError;
      // mvdan reports "b.sh:1:10: `then` must be followed by a statement list"
      // — verified directly against the shim; these are not 1:1 placeholders.
      expect(parseError.line).toBe(1);
      expect(parseError.column).toBe(10);
      expect(parseError.filename).toBe('b.sh');
      expect(parseError.message).toContain('must be followed by a statement list');
    }
  });

  it('does not report placeholder position 1:1 for an error later in the file', () => {
    expect.assertions(2);
    try {
      parseSync('echo one\necho two\nif true; then\n', { filename: 'c.sh' });
    } catch (error) {
      const parseError = error as ShParseError;
      expect(parseError.line).toBe(3);
      expect(parseError.column).toBe(10);
    }
  });

  it("reports .column in UTF-16 code units (not mvdan/sh's own byte count) when multibyte content precedes the error on the same line", () => {
    // "🎉" is 4 bytes in UTF-8 but a single 2-UTF-16-unit character, so
    // mvdan/sh's own byte-counting column and the UTF-16 column diverge by 2
    // for anything after it on the line. `prefix` is shared, byte-for-byte
    // identical text between a syntactically valid fixture (whose Lit node
    // loc.start.column is read directly, independent of the error path) and
    // an invalid one that fails to parse at the exact same source position
    // — an unclosed double quote is reported at the position of the
    // offending `"` itself (see the `q.sh` fixture below), which sits right
    // where the valid fixture's Lit starts.
    const prefix = sh`echo "🎉" `;

    const validFile = parseSync(prefix + 'x\n');
    let litX: ShNode | undefined;
    walk(validFile, (node) => {
      if (node.type === 'Lit' && node.value === 'x') {
        litX = node;
      }
    });
    expect(litX).toBeDefined();

    expect.assertions(5);
    try {
      parseSync(prefix + sh`"unterminated`, { filename: 'q2.sh' });
    } catch (error) {
      expect(error).toBeInstanceOf(ShParseError);
      const parseError = error as ShParseError;
      expect(parseError.line).toBe(1);
      // The UTF-16 column matches the sibling valid fixture's real node —
      // not mvdan/sh's own byte column (13 for this fixture; see the
      // message text below, which embeds mvdan's unconverted byte column
      // since it's mvdan's own formatted string, not a structured field).
      expect(parseError.column).toBe(litX?.loc.start.column);
      expect(parseError.message).toBe('q2.sh:1:13: reached EOF without closing quote `"`');
    }
  });
});

describe('parseSync — criterion 4: error-message escaping regression', () => {
  it('survives a double-quote character in the mvdan error message across the Go->JS boundary intact', () => {
    // Unclosed double quote: mvdan reports `reached EOF without closing quote `"``
    // (backtick-quoted `"` character). The spike's hand-rolled escaper only
    // handled `"`, `\`, and `\n` — this is a regression test for switching
    // the shim to encoding/json.Marshal for the whole result envelope.
    expect.assertions(3);
    try {
      parseSync(sh`echo "unterminated`, { filename: 'q.sh' });
    } catch (error) {
      const parseError = error as ShParseError;
      expect(parseError.message).toContain('"');
      expect(parseError.message).toBe('q.sh:1:6: reached EOF without closing quote `"`');
      // The quote character must be the literal U+0022, not a mangled escape.
      expect(parseError.message.includes(String.fromCharCode(0x22))).toBe(true);
    }
  });
});

describe('parseSync — criterion 5: dialect handling', () => {
  it.each(['bash', 'posix', 'mksh', 'bats', 'zsh'] as const)('accepts dialect %s', (dialect) => {
    const file = parseSync('echo hi', { dialect });
    expect(file.type).toBe('File');
  });

  it('throws for an unrecognized dialect name', () => {
    expect(() => parseSync('echo hi', { dialect: 'fish' as never })).toThrow();
  });

  it('does not throw ShParseError for an unrecognized dialect (no source position to report)', () => {
    expect.assertions(1);
    try {
      parseSync('echo hi', { dialect: 'fish' as never });
    } catch (error) {
      expect(error).not.toBeInstanceOf(ShParseError);
    }
  });

  it("parses `declare -A m` successfully under posix — version gating is a rule-layer concern, not the parser's", () => {
    const file = parseSync('declare -A m', { dialect: 'posix' });
    expect(file.stmts).toHaveLength(1);
  });
});

describe('isResultEnvelope', () => {
  // Regression test: the guard used to be `typeof value === 'object' &&
  // value !== null`, which also accepts arrays (arrays are typeof
  // "object"). A malformed shim payload shaped as an array would have
  // been accepted as a valid envelope and blown up later on property
  // access instead of failing with the intended "unexpected payload
  // shape" error.
  it('rejects an array', () => {
    expect(isResultEnvelope([])).toBe(false);
    expect(isResultEnvelope([{ file: {} }])).toBe(false);
  });

  it('rejects null', () => {
    expect(isResultEnvelope(null)).toBe(false);
  });

  it.each([
    ['a string', 'not an envelope'],
    ['a number', 42],
    ['a boolean', true],
    ['undefined', undefined],
  ] as const)('rejects a primitive (%s)', (_label, value) => {
    expect(isResultEnvelope(value)).toBe(false);
  });

  it('rejects a non-plain object (class instance)', () => {
    expect(isResultEnvelope(new Date())).toBe(false);
  });

  it('accepts an empty object — every envelope field is optional', () => {
    expect(isResultEnvelope({})).toBe(true);
  });

  it('accepts an envelope with a well-formed file field', () => {
    expect(isResultEnvelope({ file: { Type: 'File' } })).toBe(true);
  });

  it('accepts an envelope with a well-formed parseError field', () => {
    expect(
      isResultEnvelope({
        parseError: { message: 'bad', filename: 'a.sh', line: 1, column: 1, offset: 0 },
      }),
    ).toBe(true);
  });

  it('rejects an envelope whose parseError is missing required fields', () => {
    expect(isResultEnvelope({ parseError: { message: 'bad' } })).toBe(false);
  });

  it('rejects an envelope whose parseError field has the wrong field types', () => {
    expect(
      isResultEnvelope({
        parseError: { message: 'bad', filename: 'a.sh', line: '1', column: 1, offset: 0 },
      }),
    ).toBe(false);
  });

  it('rejects an envelope whose parseError is not an object', () => {
    expect(isResultEnvelope({ parseError: 'bad' })).toBe(false);
  });

  it('accepts an envelope with a well-formed error field', () => {
    expect(isResultEnvelope({ error: { message: 'bad' } })).toBe(true);
  });

  it('rejects an envelope whose error field is missing its message', () => {
    expect(isResultEnvelope({ error: {} })).toBe(false);
  });

  it('rejects an envelope whose error.message has the wrong type', () => {
    expect(isResultEnvelope({ error: { message: 42 } })).toBe(false);
  });

  it('rejects an envelope whose error field is present but null', () => {
    expect(isResultEnvelope({ error: null })).toBe(false);
  });
});
