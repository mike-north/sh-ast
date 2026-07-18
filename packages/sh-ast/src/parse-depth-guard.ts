import { ShParseMaxDepthError } from './errors.js';

/**
 * The maximum estimated structural nesting depth {@link assertParseDepthWithinLimit}
 * accepts before refusing to hand `text` to the WASM parser at all. A single
 * hard-coded, non-configurable safe default — see that function's doc comment
 * for the empirical justification.
 *
 * Measured empirically (this repo's `vitest` environment, Node 24, the
 * committed linux/amd64 `sh-ast.wasm` shim — which runs identically on
 * darwin, since WASM bytecode is host-portable even though the *build* of
 * that `.wasm` is not; see `shim/`'s rebuild-match CI job): feeding
 * `parseSync` a flat top-level script consisting of `N` genuinely nested
 * frames hits a raw, uncatchable-from-inside-the-shim
 * `RangeError: Maximum call stack size exceeded` (thrown from `wasm-function`
 * stack frames — i.e. inside mvdan/sh's own recursive-descent parser,
 * running inside the WASM instance) at these depths, depending on which
 * syntax construct supplies the nesting:
 *
 * | construct                                   | first crash observed at N = |
 * | -------------------------------------------- | ---------------------------- |
 * | `$(...)` command substitution (worst case)   | 252                          |
 * | `${a:-${a:-...}}` nested parameter expansion | ~400–600                     |
 * | `f(){ ... }` nested function definitions     | ~300–350                     |
 * | `case`/`esac` nesting                        | ~350–400                     |
 * | `while`/`done` nesting                       | ~450–800                     |
 * | `$((...))` nested arithmetic expansion       | ~450–800                     |
 * | `(...)` nested subshells                     | ~1,000–1,500                 |
 * | `\|`/`&&`/`\|\|` chained pipeline/list stages | ~1,000                        |
 * | `if`/`fi`, `for`/`done`, `{ }` block nesting  | ~1,000                        |
 *
 * `$(...)` command substitution is the tightest bound by a wide margin —
 * each level costs the parser noticeably more native stack than a bare
 * subshell paren — so the limit below is sized against *that* vector, not
 * the more forgiving ones. The exact crash point is a hard native-stack
 * limit, not a clean threshold, and it shrinks further the deeper the
 * *caller's own* JS call stack already is when it invokes `parseSync`
 * (measured: with as little as ~50–1,000 frames of unrelated pre-existing
 * recursion already on the stack, the same 252-deep `$(...)` input that
 * succeeds from a fresh top-level script instead crashes at a noticeably
 * lower depth) — exactly the situation a real embedding (an ESLint rule, a
 * CLI, a permission hook) is in, never a pristine empty stack.
 *
 * 150 leaves roughly 100 frames (⁓1.7x) of headroom below the *lowest*
 * observed native-crash depth (252, `$(...)`) measured from a fresh stack,
 * and was independently confirmed safe with as much as 3,000 frames of
 * *additional*, unrelated caller-stack depth already consumed before the
 * pathological input is scanned — comfortably past what any realistic
 * caller stack looks like. It is not a round, "generous"-sounding number
 * like 10,000 for the same reason `MAX_STRUCTURAL_DEPTH` (in
 * `analyze/enumerate-commands.ts`) isn't: a limit that high would never
 * actually fire before the real, uncatchable crash does. 150 also
 * comfortably exceeds any realistic hand-written script's nesting — this
 * is pathological-input protection, not a normal-usage ceiling (a
 * deliberately deep-but-legitimate ~100-level script is still accepted;
 * see `parse-depth-guard.test.ts`).
 */
const MAX_PARSE_NESTING_DEPTH = 150;

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

/**
 * Characters that end a bare (unquoted) word during the word-boundary scan
 * `estimateMaxNestingDepth` uses to recognize `if`/`for`/`while`/`until`/
 * `case`/`select` (openers) and `fi`/`done`/`esac` (closers). Deliberately
 * broader than strict shell tokenization needs to be — the goal is never to
 * *merge* two words that should be separate (which could hide a keyword),
 * not to perfectly reject non-keyword-boundary characters.
 */
const WORD_DELIMITERS = new Set([
  ';',
  '|',
  '&',
  '(',
  ')',
  '{',
  '}',
  '<',
  '>',
  '`',
  '"',
  "'",
  '#',
  '\\',
  ' ',
  '\t',
  '\n',
  '\r',
]);

/**
 * Keywords that open a genuinely-nested structural region, other than
 * `case` (see {@link CASE_OPENER_KEYWORD} — it needs a distinct
 * {@link ScanContext} kind, not this generic one, to avoid a case arm's
 * pattern-terminating `)` being misread as this region's own closing
 * paren). Paired with {@link STRUCTURAL_CLOSER_KEYWORDS}.
 */
const STRUCTURAL_OPENER_KEYWORDS = new Set(['if', 'for', 'while', 'until', 'select']);
/** Keywords that close a genuinely-nested structural region opened by {@link STRUCTURAL_OPENER_KEYWORDS}. */
const STRUCTURAL_CLOSER_KEYWORDS = new Set(['fi', 'done']);
/**
 * `case` needs its own {@link ScanContext} kind (`'case'`), distinct from
 * the generic `'other'` used for `(`/`{`/`if`/`for`/`while`/`until`/
 * `select`: each `case` arm is terminated by a bare `)` —
 * `case WORD in PATTERN)` — that is **not** a closing paren for anything.
 * If `case` pushed a generic `'other'` region, the first arm's `)` would
 * blind-pop-close that region immediately (see {@link estimateMaxNestingDepth}'s
 * "never matches specific opener/closer pairs" design), silently
 * *under-counting* the case body's real nesting contribution for every
 * arm after the first — the one direction this estimator must never be
 * wrong in. A `'case'` region instead ignores a bare `)` outright (a
 * pattern terminator, not a real closer) and is only closed by the
 * word-boundary `esac` keyword; a *real* nested paren opened inside an
 * arm's action list (e.g. `case x in a) (subshell) ;; esac`) still pushes
 * its own `'other'` region on top of `'case'` and is closed by its own
 * `)` exactly as usual, since that `)` pops the (different) top-of-stack
 * entry, never the `'case'` entry beneath it.
 */
const CASE_OPENER_KEYWORD = 'case';
const CASE_CLOSER_KEYWORD = 'esac';

function isWordChar(ch: string | undefined): ch is string {
  return ch !== undefined && !WORD_DELIMITERS.has(ch);
}

type ScanContext = 'dquote' | 'backtick' | 'case' | 'heredoc' | 'other';

/** A `<<`/`<<-` heredoc redirect queued by {@link estimateMaxNestingDepth}, not yet started (its body begins at the next newline). */
interface PendingHeredoc {
  /** The heredoc delimiter word, with any surrounding quotes/backslashes already stripped. */
  readonly delimiter: string;
  /** Whether `<<-` (rather than plain `<<`) introduced this heredoc — strips leading tabs from body/delimiter lines before comparison. */
  readonly stripLeadingTabs: boolean;
}

/**
 * Conservatively upper-bounds the structural nesting depth mvdan/sh's
 * parser will recurse through for `text`, via a single left-to-right
 * character scan — **without** actually parsing the shell grammar. This is
 * a heuristic, not a real shell tokenizer: see the module doc comment for
 * the false-positive risk this trades for correctness.
 *
 * Combines two running counters into one "effective depth" (`bracketDepth +
 * chainLen`), checked against `limit` after every increment:
 *
 * - `bracketDepth`, incremented for each of: an unquoted `(` or `{` (covers
 *   subshells, brace groups, function bodies, `$(...)` command/`$((...))`
 *   arithmetic substitution, process substitution, and — doubly, which
 *   only makes the estimate *more* conservative — each paren of
 *   `$((...))`), an unquoted backtick command-substitution open, and a
 *   word-boundary `if`/`for`/`while`/`until`/`case`/`select` keyword; and
 *   decremented for the corresponding `)`, `}`, closing backtick, or
 *   `fi`/`done`/`esac` keyword. **Never** matches specific opener/closer
 *   *pairs* — any closer decrements whatever is currently open, and a
 *   closer seen with nothing open is simply ignored (never lets the
 *   counter go negative) — so a malformed/mismatched-bracket input can
 *   only ever make this estimate *more* conservative (higher), never miss
 *   real nesting.
 * - `chainLen`, tracking how many `|`/`|&`/`&&`/`\|\|` pipeline/list-operator
 *   tokens are chained in the *current* statement — mvdan/sh's parser
 *   recurses per chain link the same way it does per bracket, so a long
 *   flat `a|a|a|...` chain is just as much a real stack-depth risk as
 *   nested subshells are (measured: ~1,000 stages — see
 *   `MAX_PARSE_NESTING_DEPTH`'s doc comment), even though it is *not*
 *   nested tree structure. Reset to `0` on a statement boundary (`;`, an
 *   unescaped newline, or an unpaired `&`), and saved/restored (not
 *   dropped) around a bracket/keyword region so a chain that continues
 *   after a nested subshell (`a | (b) | c`) still accumulates its full
 *   length rather than silently restarting.
 *
 * Skips (does not count structure inside): single-quoted strings, `$'...'`
 * ANSI-C-quoted strings, `#`-comments (only recognized at a word boundary,
 * matching shell comment syntax), and backslash-escaped characters — none
 * of these can contain an expansion mvdan/sh recurses into. Double-quoted
 * strings are handled more carefully: their *literal* content (including
 * multibyte characters — scanning is by JS string index, i.e. UTF-16 code
 * unit, which never misaligns with a surrogate pair or any ASCII structural
 * character) is skipped, but a `$(...)` command substitution or backtick
 * expansion **nested inside** a double-quoted string is still a real,
 * depth-bearing recursion in mvdan/sh's grammar and is still counted; once
 * that nested region closes, scanning correctly resumes in "inside a
 * double-quoted string" mode rather than losing track of the enclosing
 * quote.
 *
 * Known, accepted false-positive sources (all documented here rather than
 * papered over — see the module doc comment's "may over-estimate, must
 * never under-estimate" rule):
 * - A keyword word (`if`, `done`, …) used as a plain *argument*
 *   (`echo if`) is indistinguishable from real command-position syntax by
 *   this scanner and is still counted, since this scanner never tracks
 *   grammatical position — only real parsing does that.
 * - A bare `(`/`{` inside a double-quoted string is correctly *not*
 *   counted (see above), but the same characters appearing entirely
 *   outside of any quoting are always counted even in contexts a full
 *   parser might not treat as nesting.
 * - A pipeline/list chain that runs many *unrelated* statements in a row,
 *   each separated by `;`/newline, correctly resets `chainLen` between
 *   them — but a script with an unusually long *single* chain of harmless
 *   `true | true | true | …` well past what any real script would ever
 *   write is rejected exactly like a genuinely pathological one, since
 *   this scanner cannot distinguish "long but benign" from "adversarial"
 *   chain length any more than it can for bracket nesting.
 *
 * Heredoc bodies (`<<EOF` / `<<-EOF` / `<<'EOF'` through the matching
 * delimiter line) are tracked, not merely skipped as ordinary text: a
 * heredoc body is scanned line-by-line for its terminating delimiter, and
 * — critically — a `$(...)` or backtick expansion appearing *inside* the
 * body (still real recursion in mvdan/sh's grammar for an unquoted
 * heredoc) is still counted, exactly as inside a double-quoted string.
 * This is deliberate, not incidental: without heredoc-aware handling, a
 * heredoc body containing plausible-looking closer text (stray `)`/`}`/
 * `fi`/`done`/`esac` — completely inert as far as the real parser is
 * concerned, since it's just heredoc body data) would blind-pop-close
 * *real* open regions from **outside** the heredoc, silently
 * *under-counting* genuine nesting split across a `<<EOF ... EOF` boundary
 * — exactly the failure this estimator must never produce.
 *
 * Stops scanning and returns as soon as the running depth exceeds `limit`
 * (returning `limit + 1`, not necessarily the "true" final maximum) — this
 * keeps the guard itself cheap even against a very large adversarial input,
 * since only "did it exceed the limit" is ever needed by
 * {@link assertParseDepthWithinLimit}.
 *
 * Not exported beyond this module — {@link assertParseDepthWithinLimit} is
 * the only caller; exercised indirectly, through `parseSync`, by
 * `test/parse-depth-guard.test.ts`.
 */
function estimateMaxNestingDepth(text: string, limit: number): number {
  let bracketDepth = 0;
  let chainLen = 0;
  let maxDepth = 0;
  const contextStack: ScanContext[] = [];
  const chainLenStack: number[] = [];
  const heredocInfoStack: PendingHeredoc[] = [];
  const pendingHeredocs: PendingHeredoc[] = [];
  const n = text.length;
  let i = 0;

  function noteDepth(): void {
    const total = bracketDepth + chainLen;
    if (total > maxDepth) maxDepth = total;
  }
  function open(): void {
    bracketDepth++;
    noteDepth();
  }
  function close(): void {
    if (bracketDepth > 0) bracketDepth--;
  }
  function pushRegion(kind: ScanContext): void {
    contextStack.push(kind);
    chainLenStack.push(chainLen);
    chainLen = 0;
  }
  function popRegion(kind: ScanContext): void {
    if (contextStack.length > 0 && contextStack[contextStack.length - 1] === kind) {
      contextStack.pop();
      chainLen = chainLenStack.pop() ?? 0;
    }
  }
  function toggleBacktick(): void {
    if (contextStack.length > 0 && contextStack[contextStack.length - 1] === 'backtick') {
      popRegion('backtick');
      close();
    } else {
      pushRegion('backtick');
      open();
    }
  }
  function resetChain(): void {
    chainLen = 0;
  }
  function chainLink(): void {
    chainLen++;
    noteDepth();
  }
  function startNextHeredocIfAny(): void {
    const next = pendingHeredocs.shift();
    if (next) {
      pushRegion('heredoc');
      heredocInfoStack.push(next);
    }
  }

  while (i < n) {
    if (maxDepth > limit) return maxDepth;

    const topKind = contextStack.length > 0 ? contextStack[contextStack.length - 1] : undefined;
    const ch = text[i];

    if (topKind === 'heredoc') {
      const atLineStart = i === 0 || text[i - 1] === '\n';
      // `heredocInfoStack` is pushed/popped in lockstep with every
      // `'heredoc'` entry in `contextStack` (see `startNextHeredocIfAny`
      // and the delimiter-match branch below) — `topKind === 'heredoc'`
      // here already guarantees a corresponding entry exists.
      const info = heredocInfoStack[heredocInfoStack.length - 1];
      if (atLineStart) {
        let lineEnd = i;
        while (lineEnd < n && text[lineEnd] !== '\n') lineEnd++;
        const lineRaw = text.slice(i, lineEnd);
        const compareLine = info.stripLeadingTabs ? lineRaw.replace(/^\t+/, '') : lineRaw;
        if (compareLine === info.delimiter) {
          popRegion('heredoc');
          heredocInfoStack.pop();
          i = lineEnd < n ? lineEnd + 1 : lineEnd;
          startNextHeredocIfAny();
          continue;
        }
      }
      // Heredoc body content, not the terminator line: `$(...)`/backtick
      // are still real recursion (see the module doc comment); everything
      // else — including a bare `(`/`{`/keyword-looking text and multibyte
      // characters — is inert body data.
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '$' && text[i + 1] === '(') {
        pushRegion('other');
        open();
        i += 2;
        continue;
      }
      if (ch === '`') {
        toggleBacktick();
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (topKind === 'dquote') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        contextStack.pop();
        i++;
        continue;
      }
      if (ch === '$' && text[i + 1] === '(') {
        pushRegion('other');
        open();
        i += 2;
        continue;
      }
      if (ch === '`') {
        toggleBacktick();
        i++;
        continue;
      }
      // Literal double-quoted content — including multibyte characters —
      // never affects depth.
      i++;
      continue;
    }

    // "code" scanning mode (top-level, or inside an already-open paren/
    // brace/keyword/backtick region — all of those contain ordinary shell
    // code, so they share this same scanning mode).
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '#') {
      const prev = i > 0 ? text[i - 1] : undefined;
      if (prev === undefined || WHITESPACE.has(prev) || WORD_DELIMITERS.has(prev)) {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      i++;
      continue;
    }
    if (ch === "'") {
      i++;
      while (i < n && text[i] !== "'") i++;
      if (i < n) i++;
      continue;
    }
    if (ch === '$' && text[i + 1] === "'") {
      i += 2;
      while (i < n && text[i] !== "'") {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        i++;
      }
      if (i < n) i++;
      continue;
    }
    if (ch === '"') {
      contextStack.push('dquote');
      i++;
      continue;
    }
    if (ch === '`') {
      toggleBacktick();
      i++;
      continue;
    }
    if (ch === '(' || ch === '{') {
      pushRegion('other');
      open();
      i++;
      continue;
    }
    if (ch === ')') {
      // A bare `)` directly inside a `case` region (no intervening real
      // opener) is that arm's pattern terminator, not a closing paren —
      // see CASE_OPENER_KEYWORD's doc comment. Leave the region open.
      if (contextStack.length > 0 && contextStack[contextStack.length - 1] === 'case') {
        i++;
        continue;
      }
      popRegion('other');
      close();
      i++;
      continue;
    }
    if (ch === '}') {
      popRegion('other');
      close();
      i++;
      continue;
    }
    if (ch === '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
      // A `<<`/`<<-` heredoc redirect — queue its delimiter; the body
      // itself starts at the *next* newline (there may be more of this
      // line — another redirect, another heredoc, the rest of the command
      // — still to scan first).
      let j = i + 2;
      let stripLeadingTabs = false;
      if (text[j] === '-') {
        stripLeadingTabs = true;
        j++;
      }
      while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
      let delimiter = '';
      if (text[j] === "'" || text[j] === '"') {
        const quote = text[j];
        j++;
        while (j < n && text[j] !== quote) {
          delimiter += text[j];
          j++;
        }
        if (j < n) j++;
      } else {
        while (j < n && isWordChar(text[j])) {
          if (text[j] === '\\') {
            j++;
            if (j < n) {
              delimiter += text[j];
              j++;
            }
            continue;
          }
          delimiter += text[j];
          j++;
        }
      }
      pendingHeredocs.push({ delimiter, stripLeadingTabs });
      i = j;
      continue;
    }
    if (ch === ';') {
      resetChain();
      i++;
      continue;
    }
    if (ch === '\n') {
      resetChain();
      i++;
      startNextHeredocIfAny();
      continue;
    }
    if (ch === '&' && text[i + 1] === '&') {
      chainLink();
      i += 2;
      continue;
    }
    if (ch === '|' && text[i + 1] === '|') {
      chainLink();
      i += 2;
      continue;
    }
    if (ch === '|' && text[i + 1] === '&') {
      chainLink();
      i += 2;
      continue;
    }
    if (ch === '|') {
      chainLink();
      i++;
      continue;
    }
    if (ch === '&') {
      // An unpaired `&` (background-job separator) ends the current
      // pipeline/list the same way `;` does.
      resetChain();
      i++;
      continue;
    }
    if (isWordChar(ch)) {
      let j = i + 1;
      while (j < n && isWordChar(text[j])) j++;
      const word = text.slice(i, j);
      if (STRUCTURAL_OPENER_KEYWORDS.has(word)) {
        pushRegion('other');
        open();
      } else if (STRUCTURAL_CLOSER_KEYWORDS.has(word)) {
        popRegion('other');
        close();
      } else if (word === CASE_OPENER_KEYWORD) {
        pushRegion('case');
        open();
      } else if (word === CASE_CLOSER_KEYWORD) {
        popRegion('case');
        close();
      }
      i = j;
      continue;
    }

    // Whitespace or another shell metacharacter with no structural meaning
    // for this scanner's purposes (`<`, `>`).
    i++;
  }

  return maxDepth;
}

/**
 * Throws {@link ShParseMaxDepthError} if `text`'s conservatively-estimated
 * structural nesting depth (see {@link estimateMaxNestingDepth}) exceeds
 * {@link MAX_PARSE_NESTING_DEPTH} — called by {@link parseSync} *before* it
 * ever hands `text` to the WASM shim, so pathological input never reaches
 * (and never risks crashing) the shared WASM instance in the first place.
 *
 * @internal
 */
export function assertParseDepthWithinLimit(text: string): void {
  const estimated = estimateMaxNestingDepth(text, MAX_PARSE_NESTING_DEPTH);
  if (estimated > MAX_PARSE_NESTING_DEPTH) {
    throw new ShParseMaxDepthError(MAX_PARSE_NESTING_DEPTH, estimated);
  }
}
