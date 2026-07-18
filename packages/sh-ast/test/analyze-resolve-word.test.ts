/**
 * Tests for {@link resolveWord} (`sh-ast/analyze`) against the acceptance
 * criteria in https://github.com/mike-north/eslint-sh/issues/3.
 *
 * All expected values in the positive/negative tables below are hand-derived
 * from the Bash Reference Manual (never captured from running this
 * implementation, nor from running real `bash` — see "Spec-First Test
 * Assertions" in this repo's testing conventions).
 *
 * One implementation detail worth recording here since it isn't obvious
 * from the manual alone and shaped this module's design: mvdan/sh v3.13.1's
 * parser does **not** decode `$'...'` (ANSI-C quoting) escapes itself — for
 * a `SglQuoted` word part with `Dollar: true`, the normalized `value` field
 * is the raw, un-decoded source text between the quotes (e.g. `$'\t'`
 * normalizes to a `SglQuoted` node whose `value` is the two characters
 * `\` `t`, not an actual tab). This was verified empirically by parsing
 * each escape form and inspecting the normalized tree (not by asserting
 * against that output — see `src/analyze/ansi-c-escapes.ts`'s decoder,
 * which supplies the Bash-documented decoding mvdan/sh itself doesn't
 * perform). Similarly, `SglQuoted.Dollar`/`DblQuoted.Dollar` (booleans
 * marking `$'...'`/`$"..."`) were previously discarded by this package's
 * `normalize.ts` — a real normalizer bug this issue's work surfaced and
 * fixed (see `normalize.ts`'s `POS_KEYS` comment for `'Dollar'`), since
 * without that flag `$'...'` is indistinguishable from plain `'...'` in the
 * normalized tree.
 *
 * @see https://www.gnu.org/software/bash/manual/bash.html#Quoting — §3.1.2 quoting overview
 * @see https://www.gnu.org/software/bash/manual/bash.html#Escape-Character — §3.1.2.1
 * @see https://www.gnu.org/software/bash/manual/bash.html#Double-Quotes — §3.1.2.3
 * @see https://www.gnu.org/software/bash/manual/bash.html#ANSI_002dC-Quoting — §3.1.2.4
 * @see https://www.gnu.org/software/bash/manual/bash.html#Tilde-Expansion — §3.5.2
 * @see https://www.gnu.org/software/bash/manual/bash.html#Pattern-Matching — §3.5.8.1
 * @see https://pkg.go.dev/mvdan.cc/sh/v3@v3.13.1/syntax — word-part node types (ground truth)
 */
import { describe, expect, it } from 'vitest';
import { resolveWord } from '../src/analyze/index.js';
import type { WordResolution } from '../src/analyze/index.js';
import { parseSync } from '../src/index.js';
import type { ShellDialect, ShNode } from '../src/index.js';

const sh = String.raw;

/**
 * Asserts `value` is defined (with `message` as the failure explanation)
 * and returns it narrowed to `T`, without a forbidden non-null assertion —
 * mirrors `kitchen-sink.test.ts`'s helper of the same name/shape.
 */
function assertDefined<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeDefined();
  if (value === undefined) throw new Error(message);
  return value;
}

/** Parses `src` and returns the first statement's `CallExpr.args`. */
function commandArgs(src: string, dialect: ShellDialect = 'bash'): readonly ShNode[] {
  const file = parseSync(src, { dialect });
  const stmt = assertDefined(file.stmts[0], `no statement parsed from: ${src}`);
  const cmd = stmt.cmd as { readonly args?: readonly ShNode[] };
  return cmd.args ?? [];
}

/**
 * Parses `cmd <word>` and returns the `Word` node for `<word>` (the second
 * command-line token) — a reusable helper so table rows below don't repeat
 * parse boilerplate. Using a fixed leading `cmd` token keeps every fixture
 * a normal simple-command argument, sidestepping the special-cased
 * assignment-like grammar a bare first word can trigger (e.g. `a[bc]` as a
 * command name is a parse error; as an argument it's an ordinary word).
 */
function argWord(wordSrc: string, dialect: ShellDialect = 'bash'): ShNode {
  const args = commandArgs(`cmd ${wordSrc}`, dialect);
  return assertDefined(args[1], `no argument word parsed from: cmd ${wordSrc}`);
}

function resolve(wordSrc: string, dialect?: ShellDialect): WordResolution {
  return resolveWord(argWord(wordSrc, dialect));
}

describe('resolveWord — criterion 1: positive (static) resolution table', () => {
  const rows: readonly { readonly label: string; readonly src: string; readonly text: string }[] = [
    // §3.1.2 "Quoting" overview: an unquoted word with no special
    // characters is already its own literal value.
    { label: 'plain word', src: 'rm', text: 'rm' },
    // §3.1.2.2 "Single Quotes": every character within single quotes is
    // preserved literally; single quotes cannot occur within.
    { label: 'single-quoted', src: "'rm'", text: 'rm' },
    // §3.1.2.3 "Double Quotes": with no `$`, backtick, or backslash
    // inside, double-quoted text is also just its literal characters.
    { label: 'double-quoted', src: '"rm"', text: 'rm' },
    // Concatenation: adjacent word parts (no whitespace between them)
    // join into one word — §3.1.2 groups quoting forms as parts of "a
    // word"; concatenation itself is just the absence of a word-splitting
    // space between parts.
    { label: "concatenated single-quoted + literal ('r'm)", src: "'r'm", text: 'rm' },
    { label: 'concatenated literal + double-quoted (r"m")', src: 'r"m"', text: 'rm' },
    {
      label: 'concatenated single-quoted + double-quoted + literal',
      src: `'r'"m"z`,
      text: 'rmz',
    },
    // §3.1.2.1 "Escape Character": a non-quoted backslash preserves the
    // literal value of the very next character.
    { label: 'backslash-escaped literal (r\\m)', src: 'r\\m', text: 'rm' },
    // An escaped space is not a word-splitting space — it's the literal
    // character, and the whole thing is still one word/token.
    { label: 'backslash-escaped space keeps single word', src: sh`rm\ -rf`, text: 'rm -rf' },
    // Escaping suppresses a glob metacharacter's special meaning too —
    // this is also covered by the glob negative-table's positive
    // counterpart, but included here since it's a "backslash-escaped"
    // case in its own right (§3.5.8.1 "Pattern Matching": "A \\ escapes
    // the following character").
    { label: 'backslash-escaped glob metacharacter (\\*)', src: sh`\*`, text: '*' },
    // §3.1.2.3: inside double quotes, backslash only keeps special
    // meaning before $, `, ", \, or newline — any other backslash+char
    // stays literally as both characters.
    {
      label: 'double-quoted backslash before ordinary char stays literal',
      src: sh`"a\qb"`,
      text: 'a\\qb',
    },
    { label: 'double-quoted escaped double-quote', src: sh`"a\"b"`, text: 'a"b' },
    { label: 'double-quoted escaped dollar', src: sh`"a\$b"`, text: 'a$b' },

    // §3.1.2.4 "ANSI-C Quoting" — the full documented escape table.
    { label: '$\\a (alert/bell)', src: sh`$'\a'`, text: '\x07' },
    { label: '$\\b (backspace)', src: sh`$'\b'`, text: '\x08' },
    { label: '$\\e (escape character)', src: sh`$'\e'`, text: '\x1b' },
    { label: '$\\E (escape character, alternate form)', src: sh`$'\E'`, text: '\x1b' },
    { label: '$\\f (form feed)', src: sh`$'\f'`, text: '\x0c' },
    { label: '$\\n (newline)', src: sh`$'\n'`, text: '\n' },
    { label: '$\\r (carriage return)', src: sh`$'\r'`, text: '\r' },
    { label: '$\\t (horizontal tab)', src: sh`$'\t'`, text: '\t' },
    { label: '$\\v (vertical tab)', src: sh`$'\v'`, text: '\x0b' },
    { label: '$\\\\ (backslash)', src: sh`$'\\'`, text: '\\' },
    { label: "$\\' (single quote)", src: sh`$'\''`, text: "'" },
    { label: '$\\" (double quote)', src: sh`$'\"'`, text: '"' },
    { label: '$\\? (question mark)', src: sh`$'\?'`, text: '?' },
    // \nnn: octal value, one to three digits. Octal 101 = decimal 65 = 'A'.
    { label: '$\\101 (octal, 3 digits -> "A")', src: sh`$'\101'`, text: 'A' },
    // Octal with a single digit: \0 is octal 0, the NUL character.
    { label: '$\\0 (octal, 1 digit -> NUL)', src: sh`$'\0'`, text: '\x00' },
    // \xHH: hex value, one or two digits. Hex 41 = decimal 65 = 'A'.
    { label: '$\\x41 (hex -> "A")', src: sh`$'\x41'`, text: 'A' },
    // \uHHHH: Unicode code point, one to four hex digits. U+0041 = 'A'.
    { label: '$\\u0041 (Unicode BMP -> "A")', src: sh`$'A'`, text: 'A' },
    // \UHHHHHHHH: Unicode code point, one to eight hex digits.
    // U+00000041 = 'A'; U+0001F389 = 🎉 (PARTY POPPER, astral plane).
    { label: '$\\U00000041 (Unicode, 8 digits -> "A")', src: sh`$'\U00000041'`, text: 'A' },
    {
      label: '$\\U0001F389 (Unicode astral code point -> emoji)',
      src: sh`$'\U0001F389'`,
      text: '\u{1F389}',
    },
    // \cx: control-x character. \cA = 0x41 ('A') XOR 0x40 = 0x01.
    { label: '$\\cA (control character)', src: sh`$'\cA'`, text: '\x01' },
    // Multiple escapes concatenated in one $'...' — decoding composes.
    { label: '$\\t\\n combined', src: sh`$'\t\n'`, text: '\t\n' },
    // A $'...' with no escapes at all is just its literal text (same as
    // plain single-quoted).
    { label: "$'...' with no escapes", src: sh`$'rm'`, text: 'rm' },
  ];

  it.each(rows)('$label', ({ src, text }) => {
    expect(resolve(src)).toEqual({ static: true, text });
  });
});

describe("resolveWord — regression: out-of-range $'\\U...' ANSI-C code point must not throw", () => {
  // $'\UHHHHHHHH' allows up to 8 hex digits (max 0xFFFFFFFF), but Unicode
  // only defines code points up to U+10FFFF. The Bash Reference Manual's
  // ANSI-C Quoting table documents no behavior for a \U value with no
  // corresponding Unicode character — real bash's actual behavior
  // (undocumented) falls back to a pre-RFC-3629 byte-packing scheme with no
  // range validation, which has no faithful representation as a UTF-16
  // JavaScript string. `decodeAnsiCString` previously called
  // `String.fromCodePoint` unconditionally, which throws `RangeError` for
  // any value above `0x10FFFF` — a real defect, since $'\UFFFFFFFF' is
  // well-formed shell input and resolveWord must never throw for that (see
  // this module's "facts, not verdicts: never throws" describe block
  // below). The fix leaves an out-of-range \U (or, defensively, \u —
  // though its 4-hex-digit max of 0xFFFF can never actually exceed
  // 0x10FFFF) un-decoded as literal text, matching this decoder's existing
  // "unrecognized escape stays literal" rule.
  it("does not throw for $'\\UFFFFFFFF' (code point far above U+10FFFF)", () => {
    expect(() => resolve(sh`$'\UFFFFFFFF'`)).not.toThrow();
  });

  it("resolves $'\\UFFFFFFFF' to its literal, un-decoded escape text", () => {
    expect(resolve(sh`$'\UFFFFFFFF'`)).toEqual({ static: true, text: '\\UFFFFFFFF' });
  });

  it("resolves $'\\U00110000' (one past the max valid code point) to literal text too", () => {
    expect(resolve(sh`$'\U00110000'`)).toEqual({ static: true, text: '\\U00110000' });
  });

  it("still decodes the in-range boundary $'\\U0010FFFF' (the highest valid code point)", () => {
    expect(resolve(sh`$'\U0010FFFF'`)).toEqual({ static: true, text: '\u{10ffff}' });
  });

  it("still decodes $'\\U0001F389' (in-range astral code point, already in the positive table) correctly", () => {
    expect(resolve(sh`$'\U0001F389'`)).toEqual({ static: true, text: '🎉' });
  });
});

describe('resolveWord — criterion 2: negative (non-static) resolution table', () => {
  const rows: readonly {
    readonly label: string;
    readonly src: string;
    readonly reason: 'expansion' | 'tilde' | 'glob';
  }[] = [
    // ParamExp — mvdan.cc/sh/v3's `syntax.ParamExp` node.
    { label: '$x (short ParamExp)', src: '$x', reason: 'expansion' },
    { label: '${x} (braced ParamExp)', src: '${x}', reason: 'expansion' },
    { label: '${x:-default} (ParamExp with modifier)', src: '${x:-default}', reason: 'expansion' },
    // CmdSubst — both syntactic forms mvdan/sh normalizes to `CmdSubst`.
    { label: '$(cmd) (CmdSubst, dollar-paren form)', src: '$(cmd)', reason: 'expansion' },
    // Plain (untagged) JS string: backticks need no escaping inside a
    // single-quoted JS string, unlike inside the `sh` (String.raw) tagged
    // template used elsewhere in this file, where a literal backtick must
    // be backslash-escaped to avoid ending the template — which would
    // itself become a *shell* backslash-escape, defeating the fixture.
    { label: 'backquoted `cmd` (CmdSubst, backquote form)', src: '`cmd`', reason: 'expansion' },
    // ArithmExp — always non-static, even for a literal-looking expression:
    // its result is a run-time arithmetic evaluation, not source text.
    { label: '$((1+1)) (ArithmExp)', src: '$((1+1))', reason: 'expansion' },
    {
      label: '$((RANDOM)) (ArithmExp referencing a variable)',
      src: '$((RANDOM))',
      reason: 'expansion',
    },
    // ProcSubst — process substitution, §3.5.6.
    { label: '<(cmd) (ProcSubst, input form)', src: '<(cmd)', reason: 'expansion' },
    { label: '>(cmd) (ProcSubst, output form)', src: '>(cmd)', reason: 'expansion' },
    // Expansion nested inside double quotes still makes the whole word
    // non-static — quoting suppresses word-splitting/globbing, not
    // expansion.
    { label: '"a$b" (ParamExp nested in DblQuoted)', src: sh`"a$b"`, reason: 'expansion' },
    { label: '"$(cmd)" (CmdSubst nested in DblQuoted)', src: sh`"$(cmd)"`, reason: 'expansion' },

    // Tilde expansion, §3.5.2 — only when unquoted and word-initial.
    { label: '~ (bare tilde)', src: '~', reason: 'tilde' },
    { label: '~user (tilde with username)', src: '~user', reason: 'tilde' },
    { label: '~/path (tilde with trailing path)', src: '~/path', reason: 'tilde' },
    { label: '~"foo" (unquoted leading tilde, rest quoted)', src: sh`~"foo"`, reason: 'tilde' },

    // Glob metacharacters, §3.5.8.1 "Pattern Matching" — unquoted and
    // unescaped.
    { label: '*.txt (star)', src: '*.txt', reason: 'glob' },
    { label: '? (bare question mark)', src: '?', reason: 'glob' },
    { label: 'a?b (question mark mid-word)', src: 'a?b', reason: 'glob' },
    { label: '@(foo|bar) (ExtGlob node)', src: '@(foo|bar)', reason: 'glob' },
  ];

  it.each(rows)('$label', ({ src, reason }) => {
    expect(resolve(src)).toEqual({ static: false, reason });
  });
});

describe('resolveWord — negative table: tilde vs. glob vs. expansion are distinguished, not lumped together', () => {
  it('a tilde-led word is reason "tilde", not "expansion" or "glob"', () => {
    const result = resolve('~');
    expect(result.static).toBe(false);
    if (!result.static) expect(result.reason).toBe('tilde');
  });

  it('a glob word is reason "glob", not "expansion" or "tilde"', () => {
    const result = resolve('*.txt');
    expect(result.static).toBe(false);
    if (!result.static) expect(result.reason).toBe('glob');
  });

  it('an expansion word is reason "expansion", not "glob" or "tilde"', () => {
    const result = resolve('$x');
    expect(result.static).toBe(false);
    if (!result.static) expect(result.reason).toBe('expansion');
  });
});

describe('resolveWord — negative-adjacent edge cases (escaping/position suppress the trigger)', () => {
  it('a mid-word tilde is not tilde expansion (only word-initial tildes trigger it)', () => {
    // §3.5.2: tilde expansion only applies "if a word begins with an
    // unquoted tilde character". `a~b` has no leading tilde.
    expect(resolve('a~b')).toEqual({ static: true, text: 'a~b' });
  });

  it('an escaped leading tilde is not tilde expansion', () => {
    expect(resolve(sh`\~foo`)).toEqual({ static: true, text: '~foo' });
  });

  it('a quoted tilde is not tilde expansion (quoting suppresses it)', () => {
    expect(resolve(sh`"~foo"`)).toEqual({ static: true, text: '~foo' });
  });

  it('an escaped glob metacharacter is not glob classification (already in the positive table, asserted again explicitly here)', () => {
    expect(resolve(sh`a\*b`)).toEqual({ static: true, text: 'a*b' });
    expect(resolve(sh`a\?b`)).toEqual({ static: true, text: 'a?b' });
  });

  it('a quoted glob metacharacter is not glob classification (quoting suppresses pattern matching)', () => {
    expect(resolve(`'*.txt'`)).toEqual({ static: true, text: '*.txt' });
    expect(resolve(`"*.txt"`)).toEqual({ static: true, text: '*.txt' });
  });
});

describe('resolveWord — criterion 3: multibyte fidelity', () => {
  it('resolves a word containing an emoji to the exact text', () => {
    expect(resolve('🎉')).toEqual({ static: true, text: '🎉' });
    // 🎉 (U+1F389) is a surrogate pair in UTF-16 — 2 code units, not 1.
    const result = resolve('🎉');
    expect(result.static && result.text.length).toBe(2);
  });

  it('resolves a word containing CJK characters to the exact text', () => {
    expect(resolve('你好')).toEqual({ static: true, text: '你好' });
  });

  it('resolves a word containing a combining mark to the exact text (decomposed form preserved)', () => {
    // "é" written as "e" + U+0301 COMBINING ACUTE ACCENT (decomposed), not
    // the precomposed U+00E9 — resolveWord must not normalize Unicode forms.
    const decomposedE = 'é';
    expect(resolve(decomposedE)).toEqual({ static: true, text: decomposedE });
    const result = resolve(decomposedE);
    expect(result.static && result.text.length).toBe(2);
  });

  it('resolves multibyte text through quoting and concatenation identically to the positive table', () => {
    expect(resolve(`'héllo'wörld`)).toEqual({ static: true, text: 'héllowörld' });
  });

  it("resolves an emoji decoded from a $'\\U...' ANSI-C escape to the exact character", () => {
    expect(resolve(sh`$'\U0001F389'`)).toEqual({ static: true, text: '🎉' });
  });
});

describe('resolveWord — facts, not verdicts: never throws for well-formed dynamic input', () => {
  it.each(['$x', '$(cmd)', '`cmd`', '$((1+1))', '<(cmd)', '~', '*.txt', '@(foo|bar)'])(
    'does not throw for %s',
    (src) => {
      expect(() => resolve(src)).not.toThrow();
    },
  );
});

describe('resolveWord — API contract: requires a "Word" node', () => {
  it('throws a TypeError when passed a non-Word node', () => {
    const file = parseSync('echo hi');
    expect(() => resolveWord(file)).toThrow(TypeError);
    expect(() => resolveWord(file)).toThrow(/expects a "Word" node/);
  });
});
