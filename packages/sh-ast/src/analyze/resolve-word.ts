import type { ShNode } from '../types.js';
import { decodeAnsiCString } from './ansi-c-escapes.js';
import { decodeDblQuotedLit, decodeUnquotedLit } from './decode-lit.js';

/**
 * Why a {@link resolveWord} result is `static: false`: the word's exact
 * text cannot be determined from source alone.
 *
 * - `'expansion'` — the word contains a `ParamExp` (`$x`, `${x}`), a
 *   `CmdSubst` (command substitution, either `$(...)` or backtick form), an
 *   `ArithmExp` (`$((expr))`), or a `ProcSubst` (`<(cmd)`/`>(cmd)`) part:
 *   its value depends on program state (variables, command output, process
 *   substitution) that only exists at run time.
 * - `'tilde'` — the word begins with an unquoted, unescaped `~`
 *   (Bash Reference Manual §3.5.2, "Tilde Expansion"): statically shaped,
 *   but its value depends on the filesystem/environment (`$HOME`, NSS user
 *   database lookups) at run time.
 * - `'glob'` — the word contains an unquoted, unescaped glob metacharacter
 *   (`*`/`?`) or an `ExtGlob` part (Bash Reference Manual §3.5.8,
 *   "Filename Expansion"): its value depends on which filesystem entries
 *   exist at run time.
 * - `'brace'` — the word contains a `BraceExp` part (`{a,b}`/`{1..10}`,
 *   Bash Reference Manual §3.5.1, "Brace Expansion"). mvdan/sh v3.13.1 only
 *   ever produces this node type when its caller applies `syntax.SplitBraces`
 *   to the parsed tree; this bridge's shim does not call it, so today a
 *   brace expression like `{a,b}` reaches {@link resolveWord} as an
 *   ordinary `Lit` (indistinguishable, in the AST this bridge produces,
 *   from literal `{`/`,`/`}` characters) rather than as a `BraceExp` part.
 *   This reason is handled here for forward-compatibility with that node
 *   type and is not reachable through {@link resolveWord} today.
 *
 * This union may grow (new mvdan/sh word-part node types, new
 * statically-shaped-but-dynamic categories); it is deliberately not sealed
 * against extension elsewhere in the codebase.
 *
 * @public
 */
export type WordResolutionReason = 'expansion' | 'tilde' | 'glob' | 'brace';

/**
 * The result of statically resolving a `Word` node's text. Reports facts
 * only — never a safety verdict, never a hardcoded command/wrapper list.
 * `static: false` ("unknowable") is a first-class, valid result, not an
 * error condition.
 *
 * @public
 */
export type WordResolution =
  | {
      /** The word is a compile-time-known string. */
      readonly static: true;
      /** The word's exact resolved text (quotes and escapes removed). */
      readonly text: string;
    }
  | {
      /** The word's value depends on program state, the environment, or the filesystem. */
      readonly static: false;
      /** Why this word cannot be statically resolved. */
      readonly reason: WordResolutionReason;
    };

interface PartOk {
  readonly ok: true;
  readonly text: string;
}
interface PartFail {
  readonly ok: false;
  readonly reason: WordResolutionReason;
}
type PartResult = PartOk | PartFail;

function isShNodeShape(value: unknown): value is ShNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function nodeArray(value: unknown): readonly ShNode[] {
  return Array.isArray(value) ? value.filter(isShNodeShape) : [];
}

function stringField(node: ShNode, field: string): string {
  const value = node[field];
  return typeof value === 'string' ? value : '';
}

/**
 * True iff `raw` (a `Lit` part's *undecoded* value) begins with a literal
 * `~` character. Only meaningful when checked against a `Word`'s very
 * first part: Bash tilde expansion (§3.5.2) triggers only at the start of
 * a word, so `a~b` (mid-word) and `\~foo` (escaped — `raw` starts with a
 * backslash, not `~`) are correctly excluded, while `~"foo"` (a leading
 * unquoted `~` followed by a separately-quoted part) is correctly
 * included, since it is still a distinct first `Lit` part starting with an
 * unquoted `~`.
 */
function startsWithUnescapedTilde(raw: string): boolean {
  return raw.startsWith('~');
}

function resolvePart(part: ShNode, context: 'unquoted' | 'dblquoted'): PartResult {
  switch (part.type) {
    case 'Lit': {
      const raw = stringField(part, 'value');
      if (context === 'dblquoted') {
        return { ok: true, text: decodeDblQuotedLit(raw) };
      }
      const { text, hasGlob } = decodeUnquotedLit(raw);
      if (hasGlob) return { ok: false, reason: 'glob' };
      return { ok: true, text };
    }
    case 'SglQuoted': {
      const raw = stringField(part, 'value');
      // ANSI-C quoting ($'...') is flagged by SglQuoted.Dollar (mvdan/sh
      // v3.13.1's `syntax.SglQuoted.Dollar bool`); plain single-quoted
      // text ('...') never has any escapes interpreted at all.
      if (part.dollar === true) {
        return { ok: true, text: decodeAnsiCString(raw) };
      }
      return { ok: true, text: raw };
    }
    case 'DblQuoted': {
      let text = '';
      for (const inner of nodeArray(part.parts)) {
        const result = resolvePart(inner, 'dblquoted');
        if (!result.ok) return result;
        text += result.text;
      }
      return { ok: true, text };
    }
    case 'ParamExp':
    case 'CmdSubst':
    case 'ArithmExp':
    case 'ProcSubst':
      return { ok: false, reason: 'expansion' };
    case 'ExtGlob':
      return { ok: false, reason: 'glob' };
    case 'BraceExp':
      // See WordResolutionReason's 'brace' doc: unreachable via this
      // bridge's parser today, handled for forward-compatibility.
      return { ok: false, reason: 'brace' };
    default:
      // Any word-part node type this module doesn't specifically know
      // about. "Unknowable" must stay a first-class result for well-formed
      // input rather than a thrown error — 'expansion' is the closest
      // neutral bucket (some run-time-dependent mechanism) until the type
      // is specifically handled.
      return { ok: false, reason: 'expansion' };
  }
}

/**
 * Determines whether a `Word` node is statically a known string, and if
 * so, what that string is — the atom of shell-AST static analysis (e.g.
 * "is this word literally `rm`"). A word is static iff every part is a
 * literal after shell unquoting: a bare `Lit` (backslash escapes
 * processed), a `SglQuoted` (including `$'...'` ANSI-C escapes decoded),
 * or a `DblQuoted` containing only literal parts — including concatenations
 * of these (`'r'm` resolves to `"rm"`). A word containing any expansion
 * (`ParamExp`, `CmdSubst`, `ArithmExp`, `ProcSubst`), a leading unquoted
 * `~`, or an unquoted glob metacharacter/`ExtGlob` is `static: false` with
 * a reason — never an error, and never a safety judgment (see
 * {@link WordResolution}).
 *
 * @param word - A `Word` node, e.g. `parseSync(...).stmts[0].cmd.args[0]`.
 * @throws TypeError if `word.type` is not `"Word"` — a programmer-error
 * misuse of the API, not a "malformed shell source" case (well-formed
 * shell source, however dynamic, never throws; see {@link WordResolution}).
 *
 * @public
 */
export function resolveWord(word: ShNode): WordResolution {
  if (word.type !== 'Word') {
    throw new TypeError(`resolveWord expects a "Word" node, got "${word.type}"`);
  }
  const parts = nodeArray(word.parts);
  if (parts.length === 0) {
    return { static: true, text: '' };
  }
  // `parts.length === 0` returned above, so `parts[0]` is a real element.
  const first = parts[0];
  if (first.type === 'Lit' && startsWithUnescapedTilde(stringField(first, 'value'))) {
    return { static: false, reason: 'tilde' };
  }
  let text = '';
  for (const part of parts) {
    const result = resolvePart(part, 'unquoted');
    if (!result.ok) {
      return { static: false, reason: result.reason };
    }
    text += result.text;
  }
  return { static: true, text };
}
