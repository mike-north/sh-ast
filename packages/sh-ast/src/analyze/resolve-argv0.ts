import { nodeArray } from './node-helpers.js';
import type { CommandSite } from './enumerate-commands.js';
import type { WordResolution } from './resolve-word.js';

/**
 * A data-only description of one "transparent wrapper" — a command whose
 * own argv0 is not the *effective* command actually run, because it just
 * locates and re-execs another command (`env`, `sudo`, `nohup`, …).
 * {@link resolveArgv0} interprets every field here structurally (skip N
 * words, recognize this literal flag, …); adding a new `WrapperSpec` never
 * requires a code change to {@link resolveArgv0} itself — that's what makes
 * {@link DEFAULT_TRANSPARENT_WRAPPERS} data rather than a set of hardcoded
 * `if (name === 'env')` branches, and what lets a caller extend or replace
 * the table with their own project-specific wrappers (e.g. a `with-retry`
 * helper).
 *
 * Every flag/operand-recognizing field is checked against a word's
 * *statically resolved* text only (its `.text` on a {@link WordResolution}
 * `static: true` result) — a dynamic word can never be identified as one of
 * a wrapper's own flags or operands (see {@link resolveArgv0}'s doc comment
 * for why an unrecognizable word always ends the chain rather than being
 * guessed through).
 *
 * This shape may grow new optional fields in a **minor** release as this
 * bridge models more wrapper flag conventions; existing fields' meaning
 * never changes.
 *
 * @public
 */
export interface WrapperSpec {
  /**
   * The literal, exact argv0 text (after quote/escape removal) that
   * identifies this wrapper — e.g. `['env']`. Matched only against a
   * `static: true` word; see {@link WrapperSpec}'s doc comment.
   */
  readonly names: readonly string[];

  /**
   * When `true`, a `NAME=value`-shaped operand (an unquoted identifier
   * followed by `=`, e.g. `A=1`) appearing after the wrapper name is
   * skipped — this is `env`'s and `sudo`'s own `VAR=val` *operand*
   * mechanism (setting variables in the wrapped command's environment),
   * which is a distinct, per-wrapper concept from the shell-level
   * `CallExpr.assigns` prefixes {@link Argv0Resolution.assignmentsSkipped}
   * counts.
   */
  readonly skipAssignmentOperands?: boolean;

  /** Exact flag tokens that take no operand of their own (e.g. `-i`, `-c`). */
  readonly noArgFlags?: readonly string[];

  /**
   * A regular expression matched against a whole flag-position word for
   * flag *shapes* that aren't fixed strings — e.g. `nice`'s legacy attached
   * adjustment form (`nice -10 cmd`). Consumes no separate operand word,
   * like {@link WrapperSpec.noArgFlags}.
   */
  readonly noArgFlagPattern?: RegExp;

  /**
   * Exact flag tokens that take the *following* word as their operand
   * (e.g. `-u user`, `-n 10`) — both the flag and its operand word are
   * skipped. A `--long-flag=value` attached form (single word) is also
   * recognized for any entry here that starts with `--`, consuming only
   * that one word.
   */
  readonly argFlags?: readonly string[];

  /**
   * The number of plain (non-flag, non-assignment-operand) words this
   * wrapper requires *before* the wrapped command word — e.g. `timeout`'s
   * mandatory `DURATION` operand (`timeout 10 rm -rf x`).
   */
  readonly positionalOperandsBeforeCommand?: number;
}

/**
 * `sh-ast/analyze`'s default {@link WrapperSpec} table — every entry's
 * flag/operand handling is hand-derived from that wrapper's own manual
 * page (or, for shell builtins, the Bash Reference Manual/POSIX Shell &
 * Utilities volume), cited per entry below. This table is *data*, not
 * policy: it names no "dangerous" commands, makes no safety judgment, and
 * a caller can freely replace or extend it via
 * {@link ResolveArgv0Options.transparentWrappers} (see
 * {@link resolveArgv0}'s criterion-4-style configurability guarantee).
 *
 * `xargs` is deliberately **excluded**: unlike every entry here, `xargs`
 * doesn't simply re-exec a single wrapped command word it can point to
 * statically — it invokes `command [initial-arguments]` once per *batch*
 * of additional arguments assembled from its own stdin at run time
 * (batched per `-n`/`-L`/line-splitting rules, GNU xargs(1)). Treating it
 * as transparent would misrepresent what's actually invoked: the "wrapped
 * command" is only ever a syntactic *prefix* of the real, stdin-dependent
 * argv, and that prefix can itself be entirely absent (bare `xargs` reruns
 * each stdin-derived line as its own command). No `WrapperSpec` shape here
 * can honestly express that, so `xargs` is left for a caller to model
 * explicitly if their use case calls for it, rather than shipped as a
 * silently-wrong default.
 *
 * @see https://www.gnu.org/software/bash/manual/bash.html#Bourne-Shell-Builtins — `command`, `exec` (Bash Reference Manual §4.1)
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/utilities/command.html — POSIX `command`
 * @see https://www.gnu.org/software/coreutils/manual/html_node/env-invocation.html — GNU coreutils `env`
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/utilities/env.html — POSIX `env`
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/utilities/nohup.html — POSIX `nohup`
 * @see https://www.gnu.org/software/coreutils/manual/html_node/nice-invocation.html — GNU coreutils `nice`
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/utilities/nice.html — POSIX `nice`
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/utilities/time.html — POSIX `time` utility (distinct from the bash `time` *reserved word*, which mvdan/sh models as a transparent `TimeClause` — see {@link WrapperSpec}'s `time` entry below)
 * @see https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html — GNU coreutils `timeout`
 * @see https://www.sudo.ws/docs/man/sudo.man/ — `sudo(8)`
 * @see https://www.gnu.org/software/findutils/manual/html_node/find_html/xargs-options.html — GNU `xargs` (why it's excluded, above)
 * @public
 */
export const DEFAULT_TRANSPARENT_WRAPPERS: readonly WrapperSpec[] = [
  // `command [-pVv] command_name [argument ...]` — Bash Reference Manual
  // §4.1 / POSIX `command`. `-p`, `-v`, `-V` all take no operand.
  { names: ['command'], noArgFlags: ['-p', '-v', '-V'] },

  // `exec [-cl] [-a name] [command [arguments]]` — Bash Reference Manual
  // §4.1. `-c`/`-l` take no operand; `-a name` supplies argv0 for the
  // wrapped command and takes `name` as its operand.
  { names: ['exec'], noArgFlags: ['-c', '-l'], argFlags: ['-a'] },

  // `env [-i0v] [-u name] [-C dir] [-S string] [name=value]... [utility
  // [argument...]]` — POSIX `env` (`-i`) plus GNU coreutils env(1)'s
  // commonly documented long/short forms. `VAR=val` operands preceding the
  // utility are `env`'s own environment-setting mechanism (distinct from
  // `CallExpr.assigns`).
  {
    names: ['env'],
    skipAssignmentOperands: true,
    noArgFlags: ['-i', '--ignore-environment', '-0', '--null', '-v', '--debug'],
    argFlags: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'],
  },

  // `nohup utility [argument...]` — POSIX `nohup`. No documented options
  // besides the utility itself; the word right after `nohup` is always
  // the wrapped command.
  { names: ['nohup'] },

  // `nice [-n adjustment] utility [argument...]` (GNU coreutils nice(1))
  // or the POSIX legacy attached form `nice -increment utility` (POSIX
  // `nice`, e.g. `nice -19 cmd`). `noArgFlagPattern` recognizes the
  // attached numeric form; `-n`/`--adjustment` take the adjustment as a
  // separate operand word.
  {
    names: ['nice'],
    argFlags: ['-n', '--adjustment'],
    noArgFlagPattern: /^-\d+$/,
  },

  // `time [-p] utility [argument...]` — the *standalone* `time(1)` utility
  // (POSIX), not bash's `time` reserved word: mvdan/sh always parses a
  // statement-initial, unquoted `time` as a `TimeClause` node (see
  // `enumerate-commands.ts`'s doc comment — `enumerateCommands` treats it
  // as transparent and never emits a `CallExpr`/`CommandSite` for it), so
  // this entry only ever matches an argv0 word reading literally `time`
  // that reached `CallExpr.args` some other way (quoted — `"time" cmd`
  // suppresses reserved-word recognition — or as another wrapper's
  // operand, e.g. `env time cmd`). `-p` (POSIX) and GNU time(1)'s
  // `--verbose`/`--portability` take no operand; `-o file`/`-f format`
  // (GNU) take one.
  {
    names: ['time'],
    noArgFlags: ['-p', '--verbose', '--portability'],
    argFlags: ['-o', '--output', '-f', '--format'],
  },

  // `timeout [OPTION] DURATION COMMAND [ARG]...` — GNU coreutils
  // timeout(1). `--preserve-status`/`--foreground`/`-v` take no operand;
  // `-k`/`-s` take one; `DURATION` is a single mandatory positional
  // operand before the wrapped command, regardless of how many flags
  // precede it.
  {
    names: ['timeout'],
    noArgFlags: ['--preserve-status', '--foreground', '-v', '--verbose'],
    argFlags: ['-k', '--kill-after', '-s', '--signal'],
    positionalOperandsBeforeCommand: 1,
  },

  // sudo(8). Only option forms that are documented to still be followed
  // by a command are modeled: `-A`/`-b`/`-E`/`-H`/`-k`/`-n`/`-P`/`-S` take
  // no operand; `-g group`/`-p prompt`/`-u user` take one. Deliberately
  // excludes `-e`/`-i`/`-l`/`-s`/`-v`/`-K` — sudo(8) documents these as
  // changing sudo's *mode* (edit, login shell, list, shell, validate,
  // reset) such that no ordinary "wrapped command" word necessarily
  // follows at all; modeling them as transparent would risk guessing a
  // command that isn't really there. `VAR=value` operands before the
  // command are sudo's own environment-setting mechanism, "similar to
  // env" per sudo(8).
  {
    names: ['sudo'],
    skipAssignmentOperands: true,
    noArgFlags: ['-A', '-b', '-E', '-H', '-k', '-n', '-P', '-S'],
    argFlags: ['-g', '-p', '-u'],
  },
];

/**
 * Options accepted by {@link resolveArgv0}.
 *
 * @public
 */
export interface ResolveArgv0Options {
  /**
   * The transparent-wrapper table to follow. Defaults to
   * {@link DEFAULT_TRANSPARENT_WRAPPERS}. Pass a replacement array to drop
   * a default entry entirely (that wrapper is then treated as an ordinary,
   * non-transparent effective command), or add project-specific entries
   * (e.g. a `with-retry` wrapper) — the table is plain data, not baked-in
   * policy.
   */
  readonly transparentWrappers?: readonly WrapperSpec[];
}

/**
 * The result of following a {@link CommandSite}'s argv0 through zero or
 * more transparent wrappers to the effective command actually invoked.
 * Facts only — no safety verdict; see {@link resolveArgv0}'s doc comment.
 *
 * @public
 */
export interface Argv0Resolution {
  /**
   * Every word resolved along the way, outermost wrapper first, ending
   * with {@link Argv0Resolution.effective} — e.g. for
   * `nohup env A=1 command rm x` this is the four resolutions for
   * `nohup`, `env`, `command`, `rm`, in that order. Always has at least
   * one element.
   */
  readonly chain: readonly WordResolution[];

  /**
   * The last element of {@link Argv0Resolution.chain} — the effective
   * command, or, if resolution hit a statically-unknowable word anywhere
   * along the chain (an expansion, a glob, …), that unknowable
   * `static: false` result itself. **A `static: false` word is never
   * guessed through**: the moment one is reached (whether at argv0 or
   * several wrappers deep), it becomes `effective` and the chain stops —
   * this is the security-relevant guarantee that makes
   * `sudo -u x "$prog"` report an unknowable effective command rather
   * than silently treating `sudo` itself as the answer.
   */
  readonly effective: WordResolution;

  /**
   * The number of `VAR=val` shell-assignment prefixes on the `CallExpr`
   * itself (`CommandSite.node.assigns`, e.g. the `FOO=bar` in
   * `FOO=bar rm x`) that were skipped to reach argv0. This is a distinct
   * mechanism from a wrapper's own `VAR=val` *operands* (e.g. `env`'s or
   * `sudo`'s, see {@link WrapperSpec.skipAssignmentOperands}) — always
   * exactly `CommandSite.node.assigns`'s length, independent of the
   * wrapper chain found afterward.
   */
  readonly assignmentsSkipped: number;
}

/** `true` iff `text` is shaped like a shell assignment operand (`NAME=...`). */
function isAssignmentShapedText(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(text);
}

/** `true` iff `text` is a `--long-flag=value` attached form of one of `argFlags`. */
function matchesAttachedLongFlag(text: string, argFlags: readonly string[]): boolean {
  return argFlags.some((flag) => flag.startsWith('--') && text.startsWith(`${flag}=`));
}

function findWrapperSpec(wrappers: readonly WrapperSpec[], text: string): WrapperSpec | undefined {
  return wrappers.find((spec) => spec.names.includes(text));
}

/**
 * Walks `argv` forward from `startIndex`, skipping every word this
 * `spec` structurally recognizes as its own flag, flag-operand,
 * `VAR=val` operand, or required positional operand, and returns the
 * index of the next word — either the wrapped command, or (if reached
 * first) a word this spec doesn't recognize at all, which the caller
 * treats as the wrapped command candidate regardless (see
 * {@link resolveArgv0}'s doc comment on never guessing through a
 * dynamic word). Returns `undefined` if `spec`'s own words run past the
 * end of `argv` with no wrapped-command word found (a malformed or
 * truncated invocation, e.g. bare `env` with nothing else).
 */
function advancePastWrapperOperands(
  argv: readonly WordResolution[],
  startIndex: number,
  spec: WrapperSpec,
): number | undefined {
  let index = startIndex;
  let positionalSeen = 0;
  const requiredPositional = spec.positionalOperandsBeforeCommand ?? 0;
  while (index < argv.length) {
    // `index < argv.length` just checked above, so this is a real element.
    const word = argv[index];
    if (!word.static) {
      // Can't be identified as this wrapper's own flag/operand text at
      // all — never guessed through, so this word itself is the next
      // chain element (the caller's loop will see it's unresolvable and
      // stop there).
      return index;
    }
    const text = word.text;
    if (text === '--') {
      index += 1;
      continue;
    }
    if (spec.skipAssignmentOperands === true && isAssignmentShapedText(text)) {
      index += 1;
      continue;
    }
    if (spec.noArgFlags?.includes(text) === true) {
      index += 1;
      continue;
    }
    if (spec.noArgFlagPattern?.test(text) === true) {
      index += 1;
      continue;
    }
    if (spec.argFlags?.includes(text) === true) {
      index += 2;
      continue;
    }
    if (spec.argFlags !== undefined && matchesAttachedLongFlag(text, spec.argFlags)) {
      index += 1;
      continue;
    }
    if (positionalSeen < requiredPositional) {
      positionalSeen += 1;
      index += 1;
      continue;
    }
    return index;
  }
  return undefined;
}

/**
 * Follows `site`'s argv0 through zero or more *transparent wrappers* —
 * commands whose own argv0 isn't the command actually run, because they
 * just locate and re-exec another command (`env FOO=1 rm -rf /`,
 * `command rm`, `nohup rm`, `sudo -u x "$prog"`) — to the **effective**
 * command: the one a permission/policy check must actually judge, since
 * argv0 alone is trivially spoofable through any of these.
 *
 * The wrapper table ({@link ResolveArgv0Options.transparentWrappers},
 * defaulting to {@link DEFAULT_TRANSPARENT_WRAPPERS}) is plain data: each
 * {@link WrapperSpec} declares how to locate the word it wraps, and
 * neither this function nor the table encodes any safety judgment about
 * *which* commands are dangerous — matching {@link CommandSite}'s and
 * {@link resolveWord}'s "facts only" posture. A caller can drop a default
 * entry (that name then resolves as an ordinary, non-transparent
 * command) or add their own (e.g. a project's `with-retry` helper) and
 * both directions are followed identically to any built-in entry.
 *
 * **A statically-unknowable word is never guessed through.** The moment
 * `argv0` or any wrapper's located word resolves `static: false` (an
 * expansion, tilde, glob, …), that unknowable result becomes
 * {@link Argv0Resolution.effective} immediately and the chain stops —
 * this function never falls back to treating the wrapper itself, or any
 * other guess, as the effective command once a dynamic word is reached.
 * `sudo -u x "$prog"` therefore reports `effective: { static: false, ... }`
 * with `chain: [<sudo>, <"$prog">]`, not `rm`/`sudo`/anything static.
 *
 * `VAR=val` shell-assignment prefixes on the `CallExpr` itself
 * (`CommandSite.node.assigns`, e.g. `FOO=bar rm x`) are always skipped and
 * counted in {@link Argv0Resolution.assignmentsSkipped} — a mechanism
 * distinct from a wrapper's own `VAR=val` *operands* (`env A=1 rm x`,
 * `sudo A=1 rm x`), which {@link WrapperSpec.skipAssignmentOperands}
 * handles per-wrapper.
 *
 * @param site - A {@link CommandSite}, typically from {@link enumerateCommands}.
 * @param options - See {@link ResolveArgv0Options}.
 * @throws TypeError if `site.argv` is empty — a programmer-error misuse of
 * the API (every `CommandSite` `enumerateCommands` ever produces has at
 * least one argv word; see its doc comment), not a "malformed shell
 * source" case.
 * @public
 */
export function resolveArgv0(site: CommandSite, options?: ResolveArgv0Options): Argv0Resolution {
  if (site.argv.length === 0) {
    throw new TypeError('resolveArgv0 expects a CommandSite with at least one argv word');
  }
  const wrappers = options?.transparentWrappers ?? DEFAULT_TRANSPARENT_WRAPPERS;
  const assignmentsSkipped = nodeArray(site.node.assigns).length;
  const argv = site.argv;
  const chain: WordResolution[] = [];
  let index = 0;
  while (index < argv.length) {
    // `index < argv.length` just checked above, so this is a real element.
    const word = argv[index];
    chain.push(word);
    if (!word.static) break;
    const spec = findWrapperSpec(wrappers, word.text);
    if (spec === undefined) break;
    const nextIndex = advancePastWrapperOperands(argv, index + 1, spec);
    if (nextIndex === undefined) break;
    index = nextIndex;
  }
  // `site.argv.length > 0` is checked above, so the loop above always runs
  // at least one iteration and pushes `argv[0]` before any `break` — chain
  // always has at least one element.
  const effective = chain[chain.length - 1];
  return { chain, effective, assignmentsSkipped };
}
