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
 * - `'tilde'` — an unquoted, unescaped `~` triggers Bash tilde expansion
 *   (Bash Reference Manual §3.5.2, "Tilde Expansion") at the start of the
 *   word, or — when `resolveWord`'s `context` option is `'assignment-value'`
 *   or omitted — immediately after an unquoted `:` anywhere in the word too
 *   (§3.5.2 also documents this for assignment-statement values, e.g.
 *   `PATH=/foo:~/bar`). Either way: statically shaped, but its value
 *   depends on the filesystem/environment (`$HOME`, NSS user database
 *   lookups) at run time. See `resolveWord`'s `context` parameter doc for
 *   the full command-argument-vs-assignment-value distinction.
 * - `'glob'` — the word contains an unquoted, unescaped glob metacharacter
 *   (`*`/`?`), an unquoted bracket expression (`[...]` — an unquoted `[`
 *   with a later unquoted `]` in the same word, POSIX 2.13.1 / Bash
 *   Reference Manual §3.5.8.1, "Pattern Matching"), or an `ExtGlob` part
 *   (Bash Reference Manual §3.5.8, "Filename Expansion"): its value depends
 *   on which filesystem entries exist at run time.
 * - `'brace'` — the word contains a `BraceExp` part (`{a,b}`/`{1..10}`,
 *   Bash Reference Manual §3.5.1, "Brace Expansion"). mvdan/sh v3.13.1 only
 *   ever produces this node type when its caller applies `syntax.SplitBraces`
 *   to the parsed tree; this bridge's shim does not call it, so today a
 *   brace expression like `{a,b}` reaches {@link resolveWord} as an
 *   ordinary `Lit` (indistinguishable, in the AST this bridge produces,
 *   from literal `{`/`,`/`}` characters) rather than as a `BraceExp` part.
 *   This reason is handled here for forward-compatibility with that node
 *   type and is not reachable through {@link resolveWord} today.
 * - `'locale'` — the word contains a `$"..."` locale-translated string
 *   (Bash Reference Manual §3.1.2.5, "Locale-Specific Translation"): its
 *   value is looked up in the current locale's translation catalog at run
 *   time via `gettext`, regardless of whether its contents also contain an
 *   expansion. `'locale'` takes precedence over any `'expansion'` a
 *   `$"..."` word's *contents* would otherwise report — the `DblQuoted`
 *   node's own `dollar` flag is checked before its children are visited at
 *   all, so e.g. `$"hi $x"` reports `'locale'`, never `'expansion'`.
 * - `'unsupported'` — the word contains a `$'...'` (ANSI-C quoted) `\u`/`\U`
 *   escape whose value has no corresponding Unicode character (greater than
 *   `U+10FFFF`, e.g. `$'\UFFFFFFFF'`): real bash's output for this case is
 *   an undocumented, non-UTF-8 byte sequence with no exact representation
 *   as a JavaScript string (see `ansi-c-escapes.ts`'s
 *   `MAX_UNICODE_CODE_POINT` doc comment for the empirical detail) — this
 *   package declines to claim a `static: true` text bash never actually
 *   produces.
 *
 * This union may grow in a **minor** release — new mvdan/sh word-part node
 * types, or new statically-shaped-but-dynamic categories, can add new reason
 * strings without that being a breaking change. It is deliberately not
 * sealed against extension elsewhere in the codebase. A reason string this
 * version of the package doesn't yet know about only ever accompanies
 * `static: false`, never changes the meaning of `static: true`, so runtime
 * consumers that only branch on `.static` are safe by construction across
 * such additions; an exhaustive compile-time `switch` over `.reason` should
 * still include a `default` case to stay forward-compatible.
 *
 * @public
 */
export type WordResolutionReason =
  'expansion' | 'tilde' | 'glob' | 'brace' | 'locale' | 'unsupported';

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

/**
 * Options controlling {@link resolveWord}'s tilde-expansion detection.
 *
 * @public
 */
export interface ResolveWordOptions {
  /**
   * Which Bash grammar position `word` occupies — the two positions Bash
   * §3.5.2 ("Tilde Expansion") documents distinct tilde-expansion triggers
   * for:
   *
   * - `'command-argument'` — an ordinary simple-command argument word (e.g.
   *   `echo <word>`). Only a *word-initial* unquoted `~` triggers tilde
   *   expansion; an unquoted `~` elsewhere in the word (including right
   *   after a `:`) is an ordinary character (`echo a:~b` prints `a:~b`
   *   literally in real bash).
   * - `'assignment-value'` — the value side of a shell assignment (e.g.
   *   `PATH=<word>`, an `Assign` node's `value`). Bash additionally
   *   tilde-expands an unquoted `~` immediately following an unquoted `:`
   *   anywhere in the value (`PATH=/foo:~/bar` expands the `~/bar`
   *   segment) — this is documented for `PATH`-like colon-separated
   *   assignment values specifically.
   *
   * **Default: `'assignment-value'` semantics apply whenever this option is
   * omitted.** `resolveWord` takes a bare `Word` node with no grammar
   * context attached, so it cannot see whether its caller extracted that
   * word from a command argument or an assignment value — omitting this
   * option is deliberately treated as the *more conservative* of the two
   * (the one that reports `'tilde'` in more cases), so a caller that
   * doesn't know or care about the distinction never under-reports a real
   * tilde-expansion site. Pass `'command-argument'` explicitly to opt into
   * the narrower, word-initial-only check that matches real bash's
   * behavior for ordinary arguments.
   *
   * @see https://www.gnu.org/software/bash/manual/bash.html#Tilde-Expansion
   */
  readonly context?: 'command-argument' | 'assignment-value';
}

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

/**
 * True iff an unquoted, unescaped `~` immediately follows an unquoted,
 * unescaped `:` anywhere across `parts` — Bash §3.5.2's assignment-value
 * tilde-expansion trigger (e.g. the `~/bar` in `PATH=/foo:~/bar`).
 *
 * Only a `Word`'s top-level `Lit` parts carry unquoted text; any other
 * part type (`SglQuoted`, `DblQuoted`, `ParamExp`, …) breaks adjacency —
 * whatever text or expansion it represents sits between the `:` and any
 * following `~`, so they are no longer *immediately* adjacent. `:`/`~`
 * adjacency is tracked across concatenated `Lit` parts (state carried
 * between loop iterations), since concatenation joins parts with no
 * grammar-level separator between them.
 */
function hasUnquotedColonTilde(parts: readonly ShNode[]): boolean {
  let prevWasUnescapedColon = false;
  for (const part of parts) {
    if (part.type !== 'Lit') {
      prevWasUnescapedColon = false;
      continue;
    }
    const raw = stringField(part, 'value');
    let i = 0;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '\\' && i + 1 < raw.length) {
        // An escaped character (whatever it is) is never an unescaped `:`
        // or `~`, and breaks adjacency for the purposes of this scan.
        prevWasUnescapedColon = false;
        i += 2;
        continue;
      }
      if (prevWasUnescapedColon && ch === '~') {
        return true;
      }
      prevWasUnescapedColon = ch === ':';
      i += 1;
    }
  }
  return false;
}

/**
 * True iff `parts` contains an unquoted bracket expression: an unescaped
 * `[` with a later unescaped `]` anywhere in the same word (POSIX 2.13.1 /
 * Bash Reference Manual §3.5.8.1, "Pattern Matching"). `a[bc` (no closing
 * bracket) is a *literal* filename in Bash; `a[bc]d` is a pattern. The
 * closing `]` may live in a different, concatenated `Lit` part than the
 * opening `[` (`decodeUnquotedLit`'s `brackets` output is concatenated,
 * in part order, across every top-level `Lit` part first) — and content
 * *between* the two, even if it came from an unquoted or quoted part, does
 * not prevent them from forming a bracket expression (`a["b"]` matches
 * real bash's file `ab`, verified empirically: quoting `"b"` doesn't
 * suppress the surrounding unquoted `[`/`]`). Only `Lit` parts contribute
 * to the scan — `SglQuoted`/`DblQuoted` text is fully quoted and never
 * glob-significant (`a'['bc']'d`'s brackets are both quoted, so it stays
 * literal).
 */
function hasUnquotedBracketExpression(parts: readonly ShNode[]): boolean {
  let brackets = '';
  for (const part of parts) {
    if (part.type !== 'Lit') continue;
    brackets += decodeUnquotedLit(stringField(part, 'value')).brackets;
  }
  const openIndex = brackets.indexOf('[');
  if (openIndex === -1) return false;
  return brackets.includes(']', openIndex + 1);
}

function resolvePart(part: ShNode, quoting: 'unquoted' | 'dblquoted'): PartResult {
  switch (part.type) {
    case 'Lit': {
      const raw = stringField(part, 'value');
      if (quoting === 'dblquoted') {
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
        const decoded = decodeAnsiCString(raw);
        if (!decoded.ok) return { ok: false, reason: 'unsupported' };
        return { ok: true, text: decoded.text };
      }
      return { ok: true, text: raw };
    }
    case 'DblQuoted': {
      // Locale translation ($"...") is flagged by DblQuoted.Dollar
      // (mvdan/sh v3.13.1's `syntax.DblQuoted.Dollar bool`) and is checked
      // before descending into this node's children: the whole construct
      // is locale-dependent regardless of its contents (Bash Reference
      // Manual §3.1.2.5), so 'locale' deterministically takes precedence
      // over any 'expansion' (or other reason) its contents would
      // otherwise report — see WordResolutionReason's 'locale' doc.
      if (part.dollar === true) {
        return { ok: false, reason: 'locale' };
      }
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
 * or a `DblQuoted` containing only literal parts (and not itself a
 * `$"..."` locale translation) — including concatenations of these (`'r'm`
 * resolves to `"rm"`). A word containing any expansion (`ParamExp`,
 * `CmdSubst`, `ArithmExp`, `ProcSubst`), a triggering unquoted `~` (see
 * `options.context`), an unquoted glob metacharacter/bracket
 * expression/`ExtGlob`, a `$"..."` locale translation, or an unrepresentable
 * `$'\U...'` escape is `static: false` with a reason — never an error, and
 * never a safety judgment (see {@link WordResolution}).
 *
 * @param word - A `Word` node, e.g. `parseSync(...).stmts[0].cmd.args[0]`.
 * @param options - See {@link ResolveWordOptions}.
 * @throws TypeError if `word.type` is not `"Word"` — a programmer-error
 * misuse of the API, not a "malformed shell source" case (well-formed
 * shell source, however dynamic, never throws; see {@link WordResolution}).
 *
 * @public
 */
export function resolveWord(word: ShNode, options?: ResolveWordOptions): WordResolution {
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
  if (options?.context !== 'command-argument' && hasUnquotedColonTilde(parts)) {
    return { static: false, reason: 'tilde' };
  }
  if (hasUnquotedBracketExpression(parts)) {
    return { static: false, reason: 'glob' };
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
