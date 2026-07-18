/**
 * Decodes `$'...'` (Bash ANSI-C Quoting) escape sequences.
 *
 * mvdan/sh's parser does **not** perform this decoding: for a `SglQuoted`
 * word part with `dollar: true`, the normalized `value` field is the raw,
 * un-decoded source text between the quotes (verified empirically against
 * mvdan.cc/sh/v3 v3.13.1 — see `test/analyze-resolve-word.test.ts`'s module
 * comment for how this was confirmed). This module fills that gap using the
 * escape table the Bash Reference Manual documents, independently of
 * whatever mvdan/sh itself does or doesn't decode.
 *
 * @see https://www.gnu.org/software/bash/manual/bash.html#ANSI_002dC-Quoting
 * @internal
 */

/**
 * Hex digit predicate for `\xHH`/`\uHHHH`/`\UHHHHHHHH`. `ch` is expected to
 * come from `String.prototype.charAt`, which returns `''` (never
 * `undefined`) past the end of the string — `''` correctly fails this test,
 * so callers don't need a separate bounds check.
 */
function isHexDigit(ch: string): boolean {
  return /^[0-9a-fA-F]$/.test(ch);
}

/** Octal digit predicate for `\nnn`; see {@link isHexDigit}'s `charAt` note. */
function isOctalDigit(ch: string): boolean {
  return ch.length === 1 && ch >= '0' && ch <= '7';
}

/**
 * The highest Unicode scalar value `\uHHHH`/`\UHHHHHHHH` can validly decode
 * to. `\uHHHH` (max 4 hex digits, i.e. `0xFFFF`) can never exceed this, but
 * `\UHHHHHHHH` (up to 8 hex digits, i.e. up to `0xFFFFFFFF`) routinely does.
 *
 * The Bash Reference Manual's ANSI-C Quoting table documents `\UHHHHHHHH`
 * only as "the Unicode ... character whose value is the hexadecimal value
 * HHHHHHHH" — it does not say what happens when that value has no
 * corresponding Unicode character (i.e. is greater than `U+10FFFF`, the
 * highest code point Unicode defines). Real bash's behavior for this case
 * is undocumented and not a reasonable decode target: it falls back to a
 * pre-RFC-3629, up-to-6-byte "UTF-8-like" bit-packing with no range
 * validation (confirmed empirically — e.g. `$'\U00110000'` produces the
 * raw byte sequence `f4 90 80 80`, which is not valid UTF-8 text, and
 * `$'\UFFFFFFFF'` produces no output at all, exit 0). Neither of those is
 * representable as an exact JavaScript string, so this module does **not**
 * fall back to treating the escape as literal, un-decoded text the way it
 * does for other unrecognized escapes — that would silently claim a
 * `static: true` exact text that real bash never produces (a false
 * static). Instead, {@link decodeAnsiCString} reports an out-of-range
 * `\u`/`\U` as *unrepresentable* via {@link AnsiCDecodeResult}, and
 * `resolveWord` propagates that as `{ static: false, reason: 'unsupported' }`
 * for the whole word — never `String.fromCodePoint`, which throws
 * `RangeError` for any value over this limit and would violate
 * `resolveWord`'s "never throw for well-formed input" contract.
 *
 * @see https://www.gnu.org/software/bash/manual/bash.html#ANSI_002dC-Quoting
 */
const MAX_UNICODE_CODE_POINT = 0x10ffff;

/**
 * Greedily consumes up to `maxDigits` hex digits starting at `start`,
 * returning the parsed numeric value and how many digits were consumed (`0`
 * if none were valid).
 */
function readHexDigits(
  source: string,
  start: number,
  maxDigits: number,
): { readonly value: number; readonly length: number } {
  let digits = '';
  let index = start;
  while (digits.length < maxDigits) {
    const ch = source.charAt(index);
    if (!isHexDigit(ch)) break;
    digits += ch;
    index += 1;
  }
  return { value: digits.length > 0 ? parseInt(digits, 16) : 0, length: digits.length };
}

/**
 * Greedily consumes up to `maxDigits` octal digits starting at `start`,
 * returning the parsed numeric value and how many digits were consumed.
 */
function readOctalDigits(
  source: string,
  start: number,
  maxDigits: number,
): { readonly value: number; readonly length: number } {
  let digits = '';
  let index = start;
  while (digits.length < maxDigits) {
    const ch = source.charAt(index);
    if (!isOctalDigit(ch)) break;
    digits += ch;
    index += 1;
  }
  return { value: digits.length > 0 ? parseInt(digits, 8) : 0, length: digits.length };
}

/**
 * The result of {@link decodeAnsiCString}: either the fully decoded text,
 * or `ok: false` when the raw text contains a `\u`/`\U` escape whose value
 * has no corresponding Unicode character (see {@link MAX_UNICODE_CODE_POINT}'s
 * doc comment for why that case can't be decoded to an exact JavaScript
 * string, and can't be left as literal un-decoded text either without
 * claiming a false `static: true` result). Never throws — callers (see
 * `resolveWord`'s `SglQuoted` handling) turn `ok: false` into
 * `{ static: false, reason: 'unsupported' }` for the whole word.
 *
 * @internal
 */
export type AnsiCDecodeResult =
  { readonly ok: true; readonly text: string } | { readonly ok: false };

/**
 * Decodes the raw inner text of a `$'...'` (ANSI-C quoted) string per Bash
 * Reference Manual §3.1.2.4, "ANSI-C Quoting". `raw` is the text between
 * the quotes (mvdan/sh's `SglQuoted.Value` for a `Dollar: true` node),
 * exactly as it appears in source — not yet interpreted in any way.
 *
 * Recognized escapes: `\a \b \e \E \f \n \r \t \v \\ \' \" \?`, octal
 * `\nnn` (one to three digits), hex `\xHH` (one or two digits), Unicode
 * `\uHHHH` (one to four digits) and `\UHHHHHHHH` (one to eight digits), and
 * control-character `\cX`. An unrecognized backslash sequence (not in this
 * table, and not a recognized numeric escape) is left as-is — Bash's own
 * decoding is best-effort for malformed input, and this function mirrors
 * that rather than throwing, matching {@link resolveWord}'s "never throw
 * for well-formed input" contract at the string level too. A `\u`/`\U`
 * whose value *is* well-formed but has no corresponding Unicode character
 * is a different case — see {@link AnsiCDecodeResult}.
 *
 * @internal
 */
export function decodeAnsiCString(raw: string): AnsiCDecodeResult {
  let text = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch !== '\\' || i + 1 >= raw.length) {
      // `i < raw.length` (the while guard) means indexing here is always
      // in-bounds and `ch` is a real character, not `undefined`.
      text += ch;
      i += 1;
      continue;
    }
    // `i + 1 < raw.length` was just confirmed above, so this index is safe.
    const next = raw[i + 1];
    switch (next) {
      case 'a':
        text += '\x07';
        i += 2;
        break;
      case 'b':
        text += '\x08';
        i += 2;
        break;
      case 'e':
      case 'E':
        text += '\x1b';
        i += 2;
        break;
      case 'f':
        text += '\x0c';
        i += 2;
        break;
      case 'n':
        text += '\n';
        i += 2;
        break;
      case 'r':
        text += '\r';
        i += 2;
        break;
      case 't':
        text += '\t';
        i += 2;
        break;
      case 'v':
        text += '\x0b';
        i += 2;
        break;
      case '\\':
        text += '\\';
        i += 2;
        break;
      case "'":
        text += "'";
        i += 2;
        break;
      case '"':
        text += '"';
        i += 2;
        break;
      case '?':
        text += '?';
        i += 2;
        break;
      case 'x': {
        const { value, length } = readHexDigits(raw, i + 2, 2);
        if (length > 0) {
          text += String.fromCharCode(value);
          i += 2 + length;
        } else {
          text += ch;
          i += 1;
        }
        break;
      }
      case 'u': {
        const { value, length } = readHexDigits(raw, i + 2, 4);
        if (length === 0) {
          text += ch;
          i += 1;
          break;
        }
        // `\uHHHH` allows at most 4 hex digits (max 0xFFFF), which can
        // never exceed MAX_UNICODE_CODE_POINT (0x10FFFF) — this check is
        // purely defensive, mirroring the `\U` case below, and is
        // unreachable today (see MAX_UNICODE_CODE_POINT's doc comment).
        if (value > MAX_UNICODE_CODE_POINT) {
          return { ok: false };
        }
        text += String.fromCodePoint(value);
        i += 2 + length;
        break;
      }
      case 'U': {
        const { value, length } = readHexDigits(raw, i + 2, 8);
        if (length === 0) {
          // Not a recognized numeric escape (no valid hex digit at all):
          // leave un-decoded, same as any other unrecognized escape.
          text += ch;
          i += 1;
          break;
        }
        if (value > MAX_UNICODE_CODE_POINT) {
          // Well-formed 8-digit hex value, but out of Unicode's range (see
          // MAX_UNICODE_CODE_POINT's doc comment): bash's real output for
          // this case can't be represented as an exact JS string, so this
          // is not the same as an "unrecognized escape" — signal failure
          // for the whole string rather than claiming a false literal.
          return { ok: false };
        }
        text += String.fromCodePoint(value);
        i += 2 + length;
        break;
      }
      case 'c': {
        const controlChar = raw.charAt(i + 2);
        if (controlChar !== '') {
          // Bash's control-character formula: the char XOR 0x40 (e.g. 'A'
          // 0x41 ^ 0x40 = 0x01). See ANSI-C Quoting's "\cx" entry.
          const code = (controlChar.toUpperCase().charCodeAt(0) ^ 0x40) & 0xff;
          text += String.fromCharCode(code);
          i += 3;
        } else {
          text += ch;
          i += 1;
        }
        break;
      }
      default:
        if (isOctalDigit(next)) {
          const { value, length } = readOctalDigits(raw, i + 1, 3);
          text += String.fromCharCode(value);
          i += 1 + length;
        } else {
          // Not a recognized escape: leave the backslash (and whatever
          // follows) untouched, one character at a time.
          text += ch;
          i += 1;
        }
    }
  }
  return { ok: true, text };
}
