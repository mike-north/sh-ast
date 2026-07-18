/**
 * Decodes `Lit` word-part text and detects unquoted glob metacharacters.
 * mvdan/sh's `Lit.Value` is raw source text — backslashes are never
 * removed, escape sequences are never interpreted (verified empirically;
 * see `test/analyze-resolve-word.test.ts`) — so this module performs the
 * two context-dependent decodings Bash itself defines for a `Lit`
 * depending on whether it is a direct child of a `Word` ("unquoted") or
 * nested inside a `DblQuoted` ("double-quoted").
 *
 * @see https://www.gnu.org/software/bash/manual/bash.html#Escape-Character
 * @see https://www.gnu.org/software/bash/manual/bash.html#Double-Quotes
 * @see https://www.gnu.org/software/bash/manual/bash.html#Pattern-Matching
 * @internal
 */

/**
 * Unquoted glob metacharacters this module detects: `*` (any string) and
 * `?` (any single character) — Bash Reference Manual §3.5.8.1, "Pattern
 * Matching". `[` (bracket expressions) is deliberately **not** included:
 * whether an unquoted `[` is glob-significant depends on POSIX
 * bracket-expression grammar (a later matching `]`, `[!...]`/`[^...]`
 * negation, `[:class:]` forms) — `a[bc` with no closing bracket is a
 * *literal* filename in Bash, while `a[bc]` is a pattern. Approximating
 * that grammar with a plain character scan risks both false positives and
 * false negatives, which is exactly the kind of hand-rolled shell semantics
 * this package exists to avoid; bracket-expression detection is left as a
 * documented follow-up rather than shipped half-correct.
 */
const GLOB_METACHARACTERS: ReadonlySet<string> = new Set(['*', '?']);

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
}

/**
 * Decodes a `Lit` part's raw value when it is an unquoted, direct child of
 * a `Word` (not nested inside `DblQuoted`). Per Bash Reference Manual
 * §3.1.2.1, "Escape Character": a non-quoted backslash preserves the
 * literal value of the very next character, with one exception — a
 * backslash immediately followed by a newline is a line continuation and
 * produces no output at all. Escaping a glob metacharacter suppresses its
 * special meaning, so `hasGlob` is only set for an *unescaped* occurrence.
 *
 * @internal
 */
export function decodeUnquotedLit(raw: string): UnquotedLitResult {
  let text = '';
  let hasGlob = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === '\n') {
        // Line continuation: backslash-newline disappears entirely.
        i += 2;
        continue;
      }
      text += next;
      i += 2;
      continue;
    }
    if (GLOB_METACHARACTERS.has(ch)) {
      hasGlob = true;
    }
    text += ch;
    i += 1;
  }
  return { text, hasGlob };
}

/** Characters after which a backslash retains special meaning inside double quotes. */
const DBLQUOTED_ESCAPABLE: ReadonlySet<string> = new Set(['$', '`', '"', '\\']);

/**
 * Decodes a `Lit` part's raw value when nested inside a `DblQuoted`. Per
 * Bash Reference Manual §3.1.2.3, "Double Quotes": inside double quotes, a
 * backslash retains its special meaning only when followed by `$`, `` ` ``,
 * `"`, `\`, or newline; any other backslash is preserved literally (both
 * the backslash and the following character remain in the result).
 * Quoting always suppresses pattern matching (Filename Expansion never
 * applies to quoted text), so double-quoted `Lit` text never contributes to
 * a word's glob classification — this function has no `hasGlob` output.
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
      if (next === '\n') {
        i += 2;
        continue;
      }
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
