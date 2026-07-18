/**
 * Decodes `Lit` word-part text and detects unquoted glob metacharacters.
 * mvdan/sh's `Lit.Value` is raw source text for ordinary backslash escapes
 * — a non-quoted backslash and the character it escapes both remain in
 * `Lit.Value` exactly as written, undecoded (verified empirically; see
 * `test/analyze-resolve-word.test.ts`) — so this module performs the two
 * context-dependent decodings Bash itself defines for a `Lit` depending on
 * whether it is a direct child of a `Word` ("unquoted") or nested inside a
 * `DblQuoted` ("double-quoted"). The one exception is a backslash-newline
 * *line continuation*: mvdan/sh's lexer consumes and discards it before
 * `Lit.Value` is ever populated (verified empirically — parsing
 * `cmd a\` + newline + `s` yields a `Lit` whose `value` is `"as"`, with no
 * trace of the backslash or newline), so unlike ordinary escapes it never
 * reaches this module and there is nothing here left to decode for it.
 *
 * @see https://www.gnu.org/software/bash/manual/bash.html#Escape-Character
 * @see https://www.gnu.org/software/bash/manual/bash.html#Double-Quotes
 * @see https://www.gnu.org/software/bash/manual/bash.html#Pattern-Matching
 * @internal
 */

/**
 * Unquoted glob metacharacters this module detects directly, by a single
 * unescaped occurrence: `*` (any string) and `?` (any single character) —
 * Bash Reference Manual §3.5.8.1, "Pattern Matching". Bracket expressions
 * (`[...]`) are handled separately by {@link decodeUnquotedLit}'s
 * `brackets` output, since — per POSIX 2.13.1 and Bash §3.5.8.1 — a lone
 * unquoted `[` is only glob-significant when a later unquoted `]` closes
 * it (`a[bc` with no closing bracket is a *literal* filename in Bash,
 * while `a[bc]` is a pattern), and that closing `]` may live in a
 * different, concatenated `Lit` part of the same `Word` (see
 * `resolveWord`'s cross-part bracket scan).
 */
const GLOB_METACHARACTERS: ReadonlySet<string> = new Set(['*', '?']);

/** The two characters {@link decodeUnquotedLit} tracks for cross-part bracket-expression detection. */
const BRACKET_CHARACTERS: ReadonlySet<string> = new Set(['[', ']']);

/**
 * The result of decoding a `Lit` part that is a direct (unquoted) child of
 * a `Word`.
 *
 * @internal
 */
export interface UnquotedLitResult {
  /** The decoded literal text (escapes resolved, glob chars included verbatim). */
  readonly text: string;
  /** `true` iff an unescaped `*` or `?` appears in `raw`. */
  readonly hasGlob: boolean;
  /**
   * Every unescaped `[` or `]` in `raw`, concatenated in source order (e.g.
   * `raw`'s unescaped occurrences in `"a[b]c]"` yield `"[]]"`). A caller
   * assembling a `Word`'s full bracket-expression classification
   * concatenates this across all of a word's top-level `Lit` parts, in
   * part order, then checks for a `[` with a later `]` — see
   * `resolveWord`'s bracket scan and POSIX 2.13.1 / Bash §3.5.8.1.
   */
  readonly brackets: string;
}

/**
 * Decodes a `Lit` part's raw value when it is an unquoted, direct child of
 * a `Word` (not nested inside `DblQuoted`). Per Bash Reference Manual
 * §3.1.2.1, "Escape Character": a non-quoted backslash preserves the
 * literal value of the very next character. (A backslash-newline line
 * continuation never reaches this function at all — see this module's
 * doc comment — so there is no such case to handle here.) Escaping a glob
 * metacharacter or bracket character suppresses its special meaning, so
 * `hasGlob` and `brackets` only ever reflect *unescaped* occurrences.
 *
 * @internal
 */
export function decodeUnquotedLit(raw: string): UnquotedLitResult {
  let text = '';
  let hasGlob = false;
  let brackets = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      text += next;
      i += 2;
      continue;
    }
    if (GLOB_METACHARACTERS.has(ch)) {
      hasGlob = true;
    }
    if (BRACKET_CHARACTERS.has(ch)) {
      brackets += ch;
    }
    text += ch;
    i += 1;
  }
  return { text, hasGlob, brackets };
}

/** Characters after which a backslash retains special meaning inside double quotes. */
const DBLQUOTED_ESCAPABLE: ReadonlySet<string> = new Set(['$', '`', '"', '\\']);

/**
 * Decodes a `Lit` part's raw value when nested inside a `DblQuoted`. Per
 * Bash Reference Manual §3.1.2.3, "Double Quotes": inside double quotes, a
 * backslash retains its special meaning only when followed by `$`, `` ` ``,
 * `"`, `\`, or newline; any other backslash is preserved literally (both
 * the backslash and the following character remain in the result). (As
 * with {@link decodeUnquotedLit}, a backslash-newline line continuation
 * never reaches this function — mvdan/sh's lexer strips it before
 * `Lit.Value` is populated even inside double quotes, verified empirically:
 * parsing `"a\` + newline + `b"` yields two sibling `Lit` nodes, `"a"` and
 * `"b"`, with no `Lit` ever containing the backslash or newline — so there
 * is no such case for this function to decode.) Quoting always suppresses
 * pattern matching (Filename Expansion never applies to quoted text), so
 * double-quoted `Lit` text never contributes to a word's glob
 * classification — this function has no `hasGlob` output.
 *
 * @internal
 */
export function decodeDblQuotedLit(raw: string): string {
  let text = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (DBLQUOTED_ESCAPABLE.has(next)) {
        text += next;
        i += 2;
        continue;
      }
      // Not one of the escapable characters: the backslash stays literal.
      text += ch;
      i += 1;
      continue;
    }
    text += ch;
    i += 1;
  }
  return text;
}
