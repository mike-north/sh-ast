/**
 * Dialect-enforcement audit for https://github.com/mike-north/sh-ast/issues/27.
 *
 * Pins, per supported dialect (`bash`, `posix`, `mksh`, `bats`, `zsh`), whether a
 * representative set of dialect-gated shell constructs parse cleanly or throw
 * `ShParseError`. Expected values are derived from mvdan/sh v3.13.1's parser source
 * (`syntax/parser.go`'s `checkLang` gates, and the *silent* language-variant checks that
 * fall through to ordinary word/command parsing instead of erroring), not from this
 * package's current output — see the per-`describe` block comments below for the exact
 * source line each expectation is pinned to.
 *
 * `[[ ... ]]`-under-posix is deliberately accepted-by-design (see the "test clause"
 * block): mvdan/sh's own `filetests_test.go` asserts the same behavior for `LangPOSIX`.
 * This is NOT a bridge bug — the bridge passes the requested `LangVariant` through
 * faithfully (see `shim/main.go`'s `variant.Set(dialect)`); mvdan/sh itself treats `[[`
 * as an ordinary command word outside bash-like/mksh/zsh.
 *
 * @see https://github.com/mvdan/sh — mvdan/sh, the underlying Go shell parser (pinned v3.13.1)
 * @see https://pkg.go.dev/mvdan.cc/sh/v3/syntax#LangVariant — the dialect enum this maps `dialect` onto
 * @see design/ARCHITECTURE.md — serialization contract, parse errors and dialects
 * @see packages/sh-ast/README.md#dialect-enforcement — the published construct table this test pins
 */
import { describe, expect, it } from 'vitest';
import { parseSync, ShParseError } from '../src/index.js';
import type { ShellDialect } from '../src/index.js';

const DIALECTS = [
  'bash',
  'posix',
  'mksh',
  'bats',
  'zsh',
] as const satisfies readonly ShellDialect[];

describe('dialect matrix — test clause `[[ ]]` (parser.go:2158, SILENT gate: langBashLike|LangMirBSDKorn|LangZsh)', () => {
  // No checkLang call guards this case — outside the gated dialects, `[[` simply isn't
  // recognized as the start of a test clause and falls through to ordinary word/command
  // parsing, so `[[ a == b ]]` becomes a CallExpr calling a command literally named "[[".
  // mvdan/sh's own filetests_test.go:3933 asserts exactly this for LangPOSIX.
  it.each([
    ['bash', 'TestClause'],
    ['mksh', 'TestClause'],
    ['bats', 'TestClause'],
    ['zsh', 'TestClause'],
  ] as const)('%s: `[[ a == b ]]` parses as %s', (dialect, expectedType) => {
    const file = parseSync('[[ a == b ]]', { dialect });
    expect(file.stmts[0]?.cmd?.type).toBe(expectedType);
  });

  it('posix: `[[ a == b ]]` is ACCEPTED-BY-DESIGN, parsing as a CallExpr calling "[["', () => {
    const file = parseSync('[[ a == b ]]', { dialect: 'posix' });
    const cmd = file.stmts[0]?.cmd as {
      type: string;
      args: { parts: { type: string; value: string }[] }[];
    };
    expect(cmd.type).toBe('CallExpr');
    expect(cmd.args[0]?.parts[0]).toMatchObject({ type: 'Lit', value: '[[' });
  });
});

describe('dialect matrix — regex test `=~` (parser.go:2614, checkLang: langBashLike|LangZsh)', () => {
  it.each(['bash', 'bats', 'zsh'] as const)(
    '%s: `[[ a =~ b ]]` parses as TestClause',
    (dialect) => {
      const file = parseSync('[[ a =~ b ]]', { dialect });
      expect(file.stmts[0]?.cmd?.type).toBe('TestClause');
    },
  );

  it("mksh: `[[ a =~ b ]]` throws — regex tests are not in mksh's checkLang set", () => {
    expect(() => parseSync('[[ a =~ b ]]', { dialect: 'mksh' })).toThrow(/regex tests/);
  });

  it('posix: `[[ a =~ b ]]` is accepted, but the checkLang gate is never reached — `[[` is already an ordinary word under posix (see "test clause" block above), so the whole line is a CallExpr and `=~` is just another literal argument', () => {
    const file = parseSync('[[ a =~ b ]]', { dialect: 'posix' });
    expect(file.stmts[0]?.cmd?.type).toBe('CallExpr');
  });
});

describe('dialect matrix — array literal `a=(1 2 3)` (parser.go:1501/1929, checkLang: langBashLike|LangMirBSDKorn|LangZsh)', () => {
  it.each(['bash', 'mksh', 'bats', 'zsh'] as const)(
    '%s: array literal parses, producing an ArrayExpr assign value',
    (dialect) => {
      const file = parseSync('a=(1 2 3)', { dialect });
      const cmd = file.stmts[0]?.cmd as {
        assigns: { array: { type: string; elems: unknown[] } }[];
      };
      expect(cmd.assigns[0]?.array).toMatchObject({ type: 'ArrayExpr' });
      expect(cmd.assigns[0]?.array.elems).toHaveLength(3);
    },
  );

  it("posix: array literal throws — arrays are not in posix's checkLang set", () => {
    expect(() => parseSync('a=(1 2 3)', { dialect: 'posix' })).toThrow(/arrays/);
  });
});

describe('dialect matrix — process substitution `<()` (lexer.go:601-605, LEXER-level gate: langBashLike|LangZsh — note: mksh excluded, unlike most other bash-family gates)', () => {
  it.each(['bash', 'bats', 'zsh'] as const)(
    '%s: `cat <(echo hi)` parses, producing a ProcSubst word part',
    (dialect) => {
      const file = parseSync('cat <(echo hi)', { dialect });
      const cmd = file.stmts[0]?.cmd as {
        args: { parts: { type: string }[] }[];
      };
      expect(cmd.args[1]?.parts[0]?.type).toBe('ProcSubst');
    },
  );

  it.each(['posix', 'mksh'] as const)(
    '%s: `cat <(echo hi)` throws — `<(` is never tokenized as a process substitution opener outside langBashLike|LangZsh, so it falls back to a bare `<` redirect looking for a word',
    (dialect) => {
      expect(() => parseSync('cat <(echo hi)', { dialect })).toThrow(/must be followed by a word/);
    },
  );
});

describe('dialect matrix — brace expansion `{a,b}` (never gated: syntax.SplitBraces is a separate, opt-in mvdan/sh pass the shim does not invoke)', () => {
  // Unlike the constructs above, brace expansion is not parsed into a `BraceExp` node by
  // this bridge in ANY dialect — mvdan/sh only produces `BraceExp` nodes when the caller
  // explicitly runs `syntax.SplitBraces()` as a post-processing step over the parsed tree,
  // which `shim/main.go` does not do. So `{a,b}` is always a plain `Lit` word part,
  // identically across all five dialects, and never errors.
  it.each(DIALECTS)(
    '%s: `echo {a,b}` parses without error, `{a,b}` stays a single Lit',
    (dialect) => {
      const file = parseSync('echo {a,b}', { dialect });
      const cmd = file.stmts[0]?.cmd as { args: { parts: { type: string; value: string }[] }[] };
      expect(cmd.args[1]?.parts).toMatchObject([{ type: 'Lit', value: '{a,b}' }]);
      expect(cmd.args[1]?.parts).toHaveLength(1);
    },
  );
});

describe('dialect matrix — `function` keyword (parser.go:2166 SILENT gate for the `function name { ... }` form: langBashLike|LangMirBSDKorn|LangZsh; parser.go:2845 checkLang for the fallback error message: langBashLike)', () => {
  it.each([
    ['bash', 'FuncDecl'],
    ['mksh', 'FuncDecl'],
    ['bats', 'FuncDecl'],
    ['zsh', 'FuncDecl'],
  ] as const)('%s: `function f { echo hi; }` parses as %s', (dialect, expectedType) => {
    const file = parseSync('function f { echo hi; }', { dialect });
    expect(file.stmts[0]?.cmd?.type).toBe(expectedType);
  });

  it('posix: `function f { echo hi; }` throws — "function" falls through to an ordinary word under posix, then hits the checkLang(langBashLike) fallback error once it is immediately followed by "{"', () => {
    expect(() => parseSync('function f { echo hi; }', { dialect: 'posix' })).toThrow(
      /"function" builtin/,
    );
  });
});

describe('dialect matrix — c-style for `for (( ; ; ))` (parser.go:2414, checkLang: langBashLike|LangZsh)', () => {
  it.each(['bash', 'bats', 'zsh'] as const)('%s: c-style for parses as ForClause', (dialect) => {
    const file = parseSync('for ((i=0;i<3;i++)); do echo $i; done', { dialect });
    expect(file.stmts[0]?.cmd?.type).toBe('ForClause');
  });

  it.each(['posix', 'mksh'] as const)(
    '%s: c-style for throws — not in the langBashLike|LangZsh checkLang set (mksh excluded, unlike its usual bash/mksh/zsh grouping)',
    (dialect) => {
      expect(() => parseSync('for ((i=0;i<3;i++)); do echo $i; done', { dialect })).toThrow(
        /c-style fors/,
      );
    },
  );
});

describe('dialect matrix — extended glob `@(a|b)` (lexer.go:404-420 gates tokenization; parser.go:1363, checkLang: langBashLike|LangMirBSDKorn)', () => {
  // Isolated as a bare command argument (`ls @(a|b)`) — not nested inside a `case` pattern
  // or preceded by `shopt`, which would conflate this construct with case-pattern parsing
  // that isn't gated the same way.
  it.each(['bash', 'mksh', 'bats'] as const)(
    '%s: `ls @(a|b)` parses, producing an ExtGlob word part',
    (dialect) => {
      const file = parseSync('ls @(a|b)', { dialect });
      const cmd = file.stmts[0]?.cmd as { args: { parts: { type: string }[] }[] };
      expect(cmd.args[1]?.parts[0]?.type).toBe('ExtGlob');
    },
  );

  it('posix: `ls @(a|b)` throws — not in the langBashLike|LangMirBSDKorn checkLang set', () => {
    expect(() => parseSync('ls @(a|b)', { dialect: 'posix' })).toThrow(/extended globs/);
  });

  it("zsh: `ls @(a|b)` parses WITHOUT error but WITHOUT an ExtGlob node — zsh's lexer (lexer.go:404-411) never tokenizes `@(` as an extended-glob opener at all (to avoid ambiguity with zsh glob qualifiers like `*(N)`), so `@(a|b)` stays two plain Lit word parts and the checkLang gate is never reached", () => {
    const file = parseSync('ls @(a|b)', { dialect: 'zsh' });
    const cmd = file.stmts[0]?.cmd as { args: { parts: { type: string }[] }[] };
    expect(cmd.args[1]?.parts.map((p) => p.type)).toEqual(['Lit', 'Lit']);
  });
});

describe('dialect matrix — herestring `<<<` (parser.go:2036, checkLang: langBashLike|LangMirBSDKorn|LangZsh)', () => {
  it.each(['bash', 'mksh', 'bats', 'zsh'] as const)(
    '%s: `cat <<< hi` parses, producing a single Redirect',
    (dialect) => {
      const file = parseSync('cat <<< hi', { dialect });
      const stmt = file.stmts[0] as { redirs: { word: { parts: { value: string }[] } }[] };
      expect(stmt.redirs).toHaveLength(1);
      expect(stmt.redirs[0]?.word.parts[0]?.value).toBe('hi');
    },
  );

  it("posix: `cat <<< hi` throws — herestrings are not in posix's checkLang set", () => {
    expect(() => parseSync('cat <<< hi', { dialect: 'posix' })).toThrow(/herestrings/);
  });
});

describe('dialect matrix — `let` clause (parser.go:2166, SILENT gate: langBashLike|LangMirBSDKorn|LangZsh)', () => {
  // Symmetric with the `[[` test clause above: no checkLang call guards this case, so
  // outside the gated dialects `let` falls through to ordinary word/command parsing
  // instead of erroring.
  it.each([
    ['bash', 'LetClause'],
    ['mksh', 'LetClause'],
    ['bats', 'LetClause'],
    ['zsh', 'LetClause'],
  ] as const)('%s: `let x=1` parses as %s', (dialect, expectedType) => {
    const file = parseSync('let x=1', { dialect });
    expect(file.stmts[0]?.cmd?.type).toBe(expectedType);
  });

  it('posix: `let x=1` is ACCEPTED-BY-DESIGN, parsing as a CallExpr calling "let"', () => {
    const file = parseSync('let x=1', { dialect: 'posix' });
    const cmd = file.stmts[0]?.cmd as {
      type: string;
      args: { parts: { type: string; value: string }[] }[];
    };
    expect(cmd.type).toBe('CallExpr');
    expect(cmd.args[0]?.parts[0]).toMatchObject({ type: 'Lit', value: 'let' });
  });
});

describe('dialect matrix — cross-cutting: every parse error is a ShParseError, never a different error type', () => {
  it.each([
    ['posix', 'a=(1 2 3)'],
    ['mksh', '[[ a =~ b ]]'],
    ['posix', 'cat <(echo hi)'],
    ['posix', 'function f { echo hi; }'],
    ['mksh', 'for ((i=0;i<3;i++)); do echo $i; done'],
    ['posix', 'ls @(a|b)'],
    ['posix', 'cat <<< hi'],
  ] as const)('%s / %s throws ShParseError', (dialect, source) => {
    expect.assertions(1);
    try {
      parseSync(source, { dialect });
      throw new Error('expected parseSync to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ShParseError);
    }
  });
});
