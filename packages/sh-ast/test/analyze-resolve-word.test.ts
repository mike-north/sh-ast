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

/**
 * A placeholder `range`/`loc` for hand-built synthetic `ShNode`s below
 * (`Position`/`range` values `resolveWord` never inspects) — every real
 * `ShNode` carries these fields, so satisfying the type requires *some*
 * value even where the position is meaningless for the test.
 */
const PLACEHOLDER_LOC: ShNode['loc'] = {
  start: { line: 1, column: 1 },
  end: { line: 1, column: 1 },
};

/** Builds a minimal, otherwise-empty `ShNode` of the given `type` for synthetic-input tests. */
function syntheticNode(type: string, fields: Readonly<Record<string, unknown>> = {}): ShNode {
  return { type, range: [0, 0], loc: PLACEHOLDER_LOC, ...fields };
}

/**
 * Parses `<assignSrc>` (e.g. `PATH=/foo:~/bar`) as a bare assignment
 * statement and returns the real `Assign` node's `value` — a `Word` node —
 * for `resolveWord`'s `context: 'assignment-value'` tests. Unlike
 * {@link argWord}, this does *not* wrap the source in a `cmd` prefix: an
 * assignment with no following command is itself the whole simple command.
 */
function assignValueWord(assignSrc: string, dialect: ShellDialect = 'bash'): ShNode {
  const file = parseSync(assignSrc, { dialect });
  const stmt = assertDefined(file.stmts[0], `no statement parsed from: ${assignSrc}`);
  const cmd = stmt.cmd as { readonly assigns?: readonly ShNode[] };
  const assign = assertDefined(cmd.assigns?.[0], `no assignment parsed from: ${assignSrc}`);
  return assertDefined(
    (assign as { readonly value?: ShNode }).value,
    `assignment has no value: ${assignSrc}`,
  );
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
    { label: '$\\u0041 (Unicode BMP -> "A")', src: sh`$'\u0041'`, text: 'A' },
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
  // (undocumented, confirmed empirically against bash 5.3.9) falls back to
  // a pre-RFC-3629 byte-packing scheme with no range validation:
  // $'\U00110000' emits the raw byte sequence f4 90 80 80 (structurally
  // UTF-8-shaped but not valid UTF-8 text, since U+110000 exceeds
  // RFC 3629's U+10FFFF ceiling), and $'\UFFFFFFFF' emits no bytes at all
  // (exit 0). Neither of those is representable as an exact JavaScript
  // string. `decodeAnsiCString` previously called `String.fromCodePoint`
  // unconditionally, which throws `RangeError` for any value above
  // `0x10FFFF` — a real defect, since $'\UFFFFFFFF' is well-formed shell
  // input and resolveWord must never throw for that (see this module's
  // "facts, not verdicts: never throws" describe block below). An earlier
  // fix attempt patched the throw by falling back to literal, un-decoded
  // text (the same rule this decoder uses for other unrecognized escapes)
  // — but that is itself wrong: it claims `static: true` with an *exact*
  // text (`'\\UFFFFFFFF'`) that real bash never produces, a false static.
  // The correct fix reports the whole word as
  // `{ static: false, reason: 'unsupported' }` instead of either throwing
  // or fabricating a literal.
  it("does not throw for $'\\UFFFFFFFF' (code point far above U+10FFFF)", () => {
    expect(() => resolve(sh`$'\UFFFFFFFF'`)).not.toThrow();
  });

  it("resolves $'\\UFFFFFFFF' as unsupported, not a false literal", () => {
    expect(resolve(sh`$'\UFFFFFFFF'`)).toEqual({ static: false, reason: 'unsupported' });
  });

  it("resolves $'\\U00110000' (one past the max valid code point) as unsupported too", () => {
    expect(resolve(sh`$'\U00110000'`)).toEqual({ static: false, reason: 'unsupported' });
  });

  it("still decodes the in-range boundary $'\\U0010FFFF' (the highest valid code point)", () => {
    expect(resolve(sh`$'\U0010FFFF'`)).toEqual({ static: true, text: '\u{10ffff}' });
  });

  it("still decodes $'\\U0001F389' (in-range astral code point, already in the positive table) correctly", () => {
    expect(resolve(sh`$'\U0001F389'`)).toEqual({ static: true, text: '🎉' });
  });

  // $'\uD800' is an in-range (per MAX_UNICODE_CODE_POINT, 4 hex digits can
  // never exceed 0x10FFFF) but lone UTF-16 surrogate code point — pinned
  // here as a deliberately-unchanged boundary: JavaScript strings can
  // represent an unpaired surrogate (String.fromCodePoint(0xd800) does not
  // throw), so this is not the same "unrepresentable" case as an
  // out-of-range \U value, and stays static.
  it("still resolves the lone-surrogate $'\\uD800' as static (in-range, JS-representable)", () => {
    const result = resolve(sh`$'\uD800'`);
    expect(result).toEqual({ static: true, text: '\ud800' });
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

    // Bracket expressions, POSIX 2.13.1 / Bash Reference Manual §3.5.8.1 —
    // an unquoted `[` with a *later* unquoted `]` in the same word is a
    // pattern (verified against real bash 5.3.9: `a[bc]d` in a directory
    // containing files `abd`/`acd` expands to both).
    { label: 'a[bc]d (bracket expression mid-word)', src: 'a[bc]d', reason: 'glob' },
    { label: '[abc] (bracket expression, whole word)', src: '[abc]', reason: 'glob' },
    { label: '[!abc] (negated bracket expression, "!" form)', src: '[!abc]', reason: 'glob' },
    { label: '[^abc] (negated bracket expression, "^" form)', src: '[^abc]', reason: 'glob' },
    // The `]` closing a bracket expression may live in a different,
    // concatenated `Lit` word-part than the opening `[` — here mvdan/sh
    // splits `a["b"]` into a `Lit "a["`, a `DblQuoted "b"`, and a
    // `Lit "]"`. Quoting the character between the brackets doesn't
    // suppress the *brackets themselves* being unquoted (verified against
    // real bash: `a["b"]` in a directory containing `ab` expands to it).
    {
      label: 'a["b"] (bracket expression split by a quoted inner part)',
      src: sh`a["b"]`,
      reason: 'glob',
    },
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

  it('an unquoted "[" with no later "]" in the word is not a bracket expression (stays literal)', () => {
    // Verified against real bash: `a[bc` (no closing bracket) prints
    // literally — there's no complete bracket-expression grammar to match.
    expect(resolve('a[bc')).toEqual({ static: true, text: 'a[bc' });
  });

  it('an unquoted "]" with no earlier "[" in the word is not a bracket expression (stays literal)', () => {
    // Verified against real bash: `a]b` (no opening bracket) prints
    // literally.
    expect(resolve('a]b')).toEqual({ static: true, text: 'a]b' });
  });

  it('a fully-quoted bracket pair is not a bracket expression (quoting suppresses it)', () => {
    // Both `[` and `]` are inside single quotes here — mvdan/sh parses
    // `a'['bc']'d` as `Lit "a"`, `SglQuoted "["`, `Lit "bc"`,
    // `SglQuoted "]"`, `Lit "d"`. Verified against real bash: this prints
    // literally as `a[bc]d`, not expanded, even in a directory containing
    // files that `a[bc]d` (unquoted) would match.
    expect(resolve(`a'['bc']'d`)).toEqual({ static: true, text: 'a[bc]d' });
  });
});

describe('resolveWord — locale translation ($"...")', () => {
  // Bash Reference Manual §3.1.2.5, "Locale-Specific Translation": a
  // double-quoted string preceded by a `$` is translated according to the
  // current locale via gettext at run time — its value can differ between
  // invocations even though its source text never changes.
  it('a plain $"..." string with no expansions is "locale", not "static"', () => {
    expect(resolve(sh`$"hello"`)).toEqual({ static: false, reason: 'locale' });
  });

  it('an ordinary (non-$) double-quoted string with the same text is still static', () => {
    expect(resolve('"hello"')).toEqual({ static: true, text: 'hello' });
  });

  it('a $"..." string containing a ParamExp is "locale", not "expansion" (locale takes precedence)', () => {
    // §3.1.2.5's translation applies to the whole construct regardless of
    // its contents — resolveWord checks DblQuoted.Dollar before
    // descending into children, so 'locale' deterministically wins over
    // any 'expansion' the contents would otherwise report.
    expect(resolve(sh`$"hi $x"`)).toEqual({ static: false, reason: 'locale' });
  });
});

describe('resolveWord — options.context: assignment-value colon-tilde expansion (§3.5.2)', () => {
  // Bash Reference Manual §3.5.2, "Tilde Expansion": beyond the
  // word-initial trigger, an assignment statement's value additionally
  // tilde-expands an unquoted `~` immediately following an unquoted `:`
  // (e.g. `PATH=/foo:~/bar` expands the `~/bar` segment) — verified
  // against real bash 5.3.9: `bash -c 'PATH=/foo:~/bar; echo $PATH'`
  // prints `/foo:<actual $HOME>/bar`.
  it('a real Assign.value word with no options reports "tilde" (conservative default)', () => {
    const word = assignValueWord('PATH=/foo:~/bar');
    expect(resolveWord(word)).toEqual({ static: false, reason: 'tilde' });
  });

  it('the same Assign.value word with explicit context: "assignment-value" also reports "tilde"', () => {
    const word = assignValueWord('PATH=/foo:~/bar');
    expect(resolveWord(word, { context: 'assignment-value' })).toEqual({
      static: false,
      reason: 'tilde',
    });
  });

  it('an assignment value with no colon-adjacent tilde stays static regardless of context', () => {
    const word = assignValueWord('PATH=/foo/bar');
    expect(resolveWord(word)).toEqual({ static: true, text: '/foo/bar' });
    expect(resolveWord(word, { context: 'command-argument' })).toEqual({
      static: true,
      text: '/foo/bar',
    });
  });

  // `echo a:~b`'s argument word is *not* an assignment — real bash leaves
  // it entirely literal (verified: `bash -c 'echo a:~b'` prints `a:~b`).
  // resolveWord can't see that grammatical context from a bare Word node,
  // so its documented conservative default (omitted options) still reports
  // "tilde" here — this is the one place in this suite where the
  // conservative default's result differs from real bash's behavior for
  // that word's actual grammatical position, by design (see
  // `ResolveWordOptions.context`'s doc comment).
  it('an ordinary command-argument word with a colon-adjacent tilde reports "tilde" when no context is given (conservative default)', () => {
    const word = argWord('a:~b');
    expect(resolveWord(word)).toEqual({ static: false, reason: 'tilde' });
  });

  it('the same command-argument word with explicit context: "command-argument" is static (matches real bash)', () => {
    const word = argWord('a:~b');
    expect(resolveWord(word, { context: 'command-argument' })).toEqual({
      static: true,
      text: 'a:~b',
    });
  });

  it('word-initial tilde still triggers "tilde" under context: "command-argument" (unchanged existing behavior)', () => {
    const word = argWord('~/bar');
    expect(resolveWord(word, { context: 'command-argument' })).toEqual({
      static: false,
      reason: 'tilde',
    });
  });

  it('an escaped colon does not enable colon-adjacent tilde expansion', () => {
    // `a\:~b`: the backslash escapes the colon, so it is not the unquoted
    // `:` §3.5.2 requires immediately before the triggering `~`.
    const word = argWord(sh`a\:~b`);
    expect(resolveWord(word)).toEqual({ static: true, text: 'a:~b' });
  });

  it('an escaped tilde after an unquoted colon does not trigger tilde expansion', () => {
    const word = argWord(sh`a:\~b`);
    expect(resolveWord(word)).toEqual({ static: true, text: 'a:~b' });
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

describe("resolveWord — synthetic-input edge cases (not producible by this bridge's real parser today)", () => {
  it('a synthetic BraceExp part reports "brace"', () => {
    // `BraceExp` is a real mvdan/sh node type, but is only ever produced
    // when a caller explicitly applies `syntax.SplitBraces` — this
    // bridge's shim never calls it (see `kitchen-sink.test.ts`'s
    // `KNOWN_UNREACHABLE_TYPES`, which already documents `BraceExp` as
    // unreachable through real parsing; verified empirically above too —
    // `echo a{b,c}`'s word normalizes to a single ordinary `Lit "a{b,c}"`,
    // not a `BraceExp`). This test constructs the node type by hand to
    // exercise `resolvePart`'s `BraceExp` branch directly, fails closed
    // (`static: false`) rather than silently skipping coverage of a real,
    // documented node type this module already handles.
    const word = syntheticNode('Word', {
      parts: [syntheticNode('BraceExp')],
    });
    expect(resolveWord(word)).toEqual({ static: false, reason: 'brace' });
  });

  it('an unrecognized word-part node type falls closed as "expansion", not an error', () => {
    // No real mvdan/sh word-part node type reaches `resolvePart`'s
    // `default` branch today — every type this module's `switch` doesn't
    // name explicitly is, as far as this package's parser is concerned,
    // hypothetical. This test exists to pin that the *fallback* itself is
    // safe: a well-formed `Word` containing a part type resolveWord has
    // never seen must still report a first-class `static: false` result
    // (never throw, never crash) so a future mvdan/sh node type this
    // module hasn't been taught yet degrades gracefully instead of
    // silently mis-resolving as static.
    const word = syntheticNode('Word', {
      parts: [syntheticNode('SomeFutureNodeTypeThisModuleDoesNotKnowAbout')],
    });
    expect(resolveWord(word)).toEqual({ static: false, reason: 'expansion' });
  });

  it('a Word with a genuinely empty parts array resolves to the empty static string', () => {
    // Real source always produces at least one part for any word with
    // *some* text (even `''` is a one-part `SglQuoted` with an empty
    // `value`) — a `Word` whose `parts` array is empty isn't something
    // this bridge's real parser is known to produce. Constructed by hand
    // to pin `resolveWord`'s explicit `parts.length === 0` fast path.
    const word = syntheticNode('Word', { parts: [] });
    expect(resolveWord(word)).toEqual({ static: true, text: '' });
  });
});

describe('resolveWord — consumer specifier: "sh-ast/analyze" subpath resolves like the test-relative import', () => {
  it('resolveWord imported from the "sh-ast/analyze" package specifier behaves identically', async () => {
    // Every other test in this file imports resolveWord via a
    // test-relative path (`../src/analyze/index.js`), which exercises the
    // module's logic but never the package's public subpath resolution
    // (`package.json#exports["./analyze"]`) that real consumers actually
    // go through. This test imports via the real public specifier instead
    // — the package "sh-ast" resolving to itself works here because this
    // is itself a workspace package, giving self-referencing subpath
    // resolution as close to a real external consumer's import as this
    // repo's test infra allows.
    const { resolveWord: publicResolveWord } = await import('sh-ast/analyze');
    const word = argWord('rm');
    expect(publicResolveWord(word)).toEqual({ static: true, text: 'rm' });
  });
});
