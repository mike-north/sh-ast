/**
 * Resolves command-word provenance through caller-configurable wrapper grammars.
 * Only statically known operands may be skipped; syntax facts never imply that
 * a command is safe, permitted, installed, or guaranteed to execute successfully.
 */
import { ShAnalyzeInvalidWrapperSpecError } from '../errors.js';
import { deepFreeze } from '../deep-freeze.js';
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
   * The command name that identifies this wrapper — e.g. `['env']`.
   * Matched only against a `static: true` word; see {@link WrapperSpec}'s
   * doc comment.
   *
   * Matching first searches the entire table for an exact name. Only when
   * no exact entry exists does it try an absolute path's final segment:
   *
   * 1. Its entire resolved text (after quote/escape removal) equals one of
   *    `names`: `env`, or a path a caller listed verbatim. An exact path
   *    entry takes precedence over a plain-name entry even if listed later.
   * 2. It is an **absolute path** (starts with `/`) whose final segment
   *    equals one of `names`: `/usr/bin/env`, `/usr/bin/sudo`, `/opt/x/nice`
   *    and `/usr//bin/env` resolve as `env`, `sudo` and `nice`. The chain
   *    keeps the word as written, so a consumer still sees the path.
   *
   * Relative paths and paths with a trailing slash do not use the
   * final-segment fallback. They can still match an explicitly listed name,
   * such as `./with-retry` or `/opt/with-retry/`. Custom plain names also
   * acquire absolute-path aliases; a path-only name does not acquire aliases
   * for other paths with the same final segment.
   *
   * This is a lexical analysis assumption, not executable identity:
   * `PATH` is not consulted and the filesystem is not read. Without an
   * exact override, an unrelated executable named `/opt/mytools/env` uses
   * the `env` entry's grammar. The chain preserves the original path so
   * callers can apply their own policy. A word with an expansion
   * (`"$dir/env"`) is not `static` and is never matched.
   */
  readonly names: readonly string[];

  /**
   * Legacy shorthand for {@link WrapperSpec.assignmentOperands}'s
   * `'shell-identifier'` grammar: skip statically resolved `NAME=value`
   * words with an ASCII shell identifier before `--`. Options may follow
   * these operands. Quote removal has already happened during word resolution.
   * An explicit `assignmentOperands` takes precedence, even when this is false.
   * These operands never contribute to shell-prefix `assignmentsSkipped`.
   */
  readonly skipAssignmentOperands?: boolean;

  /**
   * Assignment-operand scanning grammar, independent of the wrapper's name.
   * Each preset defines both which static words are assignments and where
   * option scanning stops; it does not model the utility's other options.
   *
   * - `'shell-identifier'`: the legacy ASCII `NAME=value` rule before `--`;
   *   options may resume after an assignment.
   * - `'env'`: after options, consume words containing `=` (including after
   *   `--`). The first assignment ends option scanning permanently. Empty
   *   names (`=value`) produce `'ambiguous-assignment'` because GNU/glibc
   *   and BSD differ on whether they can be installed in the environment.
   * - `'sudo'`: before `--`, consume words containing `=` unless they start
   *   with `/` or `=`; option scanning may resume after each assignment.
   *
   * Active option parsing always takes precedence over utility assignments:
   * `--unset=NAME` is an option, whereas `env A=1 --unset=NAME cmd` treats
   * that same word as an assignment. This field overrides the legacy
   * {@link WrapperSpec.skipAssignmentOperands} boolean when present.
   */
  readonly assignmentOperands?: 'shell-identifier' | 'env' | 'sudo';

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
   * Exact flag tokens that take an operand (e.g. `-u user`, `-n 10`).
   * Recognized in every standard getopt-style form:
   *
   * - Separate word: `-u user` (both words skipped).
   * - Attached short form: `-uuser` (one word — everything after the flag
   *   character is the operand text, exactly like real getopt).
   * - Clustered with preceding no-operand short flags:
   *   `-Eu user`/`-Euuser` (`-E` from {@link WrapperSpec.noArgFlags},
   *   `-u` from here) — see {@link resolveArgv0}'s doc comment for the
   *   clustering algorithm.
   * - Attached long form (only for an entry starting with `--`):
   *   `--long-flag=value` (one word).
   *
   * Any of these forms is recognized without a separate `WrapperSpec`
   * field — the shapes are derived structurally from `argFlags` and
   * `noArgFlags` together, matching how real short-option parsing works,
   * rather than needing to be spelled out per wrapper.
   */
  readonly argFlags?: readonly string[];

  /**
   * Exact flag tokens (and, for a `--`-prefixed entry, its attached
   * `--flag=value` form; for a short `-X` entry, its attached `-Xvalue`
   * form) that make the **whole** {@link resolveArgv0} resolution
   * unresolvable the moment they're seen, rather than being skipped like
   * {@link WrapperSpec.argFlags} or ending the chain normally like an
   * unrecognized word. For a flag whose *value itself* structurally embeds
   * the real command in a way no `WrapperSpec` field can name a fixed
   * "the wrapped command is word N" position for — e.g. `env -S string`
   * splices `string`'s own words into argv, so the real command is
   * *inside* that operand, not identifiable as a separate word at all (see
   * `env`'s table entry). Reported via
   * {@link Argv0Resolution.effective}'s `'embedded-command'` reason.
   */
  readonly unresolvableFlags?: readonly string[];

  /**
   * Exact flag tokens whose mere presence means this wrapper's own
   * invocation *is* the effective command — nothing after it is ever the
   * wrapped command, regardless of what other words follow. E.g.
   * `command -v rm` doesn't execute `rm` at all; it prints whether `rm`
   * is a recognized command name (Bash Reference Manual §4.1). Checked
   * independently of word position (not "the Nth flag"), and takes
   * precedence the moment it's seen — see `command`'s table entry.
   */
  readonly stopsChainFlags?: readonly string[];

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
 * Utilities volume), cited per entry below, and cross-checked empirically
 * against the real utility where one was locally available (GNU coreutils
 * `env`/`nice` directly; `sudo` via `sudo -h`'s usage/option summary only
 * — never executed, per this package's "facts only" posture and basic
 * safety hygiene). This table is *data*, not policy: it names no
 * "dangerous" commands, makes no safety judgment, and a caller can freely
 * replace or extend it via {@link ResolveArgv0Options.transparentWrappers}
 * (see {@link resolveArgv0}'s criterion-4-style configurability guarantee).
 *
 * Frozen (including each entry object and its own array/regexp fields) so
 * immutability of this shared, module-scoped table is a contract, not just
 * a convention any importer happens to honor. Per-call wrapper options are
 * separate values and cannot mutate these shared defaults.
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
export const DEFAULT_TRANSPARENT_WRAPPERS: readonly WrapperSpec[] = deepFreeze([
  // `command [-pVv] command_name [argument ...]` — Bash Reference Manual
  // §4.1 / POSIX `command`. `-p` takes no operand and doesn't change what
  // runs. `-v`/`-V`, however, make `command` itself *print* information
  // about `command_name` (its path, or a human-readable description)
  // rather than execute it at all — so `command -v rm x` never runs `rm`;
  // the effective command is `command` itself, regardless of what follows
  // (`stopsChainFlags`, not `noArgFlags` — see `WrapperSpec.stopsChainFlags`'s
  // doc comment).
  { names: ['command'], noArgFlags: ['-p'], stopsChainFlags: ['-v', '-V'] },

  // `exec [-cl] [-a name] [command [arguments]]` — Bash Reference Manual
  // §4.1. `-c`/`-l` take no operand; `-a name` supplies argv0 for the
  // wrapped command and takes `name` as its operand.
  { names: ['exec'], noArgFlags: ['-c', '-l'], argFlags: ['-a'] },

  // `env [-i0v] [-u name] [-C dir] [name=value]... [utility
  // [argument...]]` — POSIX `env` (`-i`) plus GNU coreutils env(1)'s
  // commonly documented long/short forms. `VAR=val` operands preceding the
  // utility are `env`'s own environment-setting mechanism (distinct from
  // `CallExpr.Assigns`). `-S`/`--split-string` is deliberately *not* an
  // `argFlags` entry — see `unresolvableFlags` below.
  {
    names: ['env'],
    // GNU env v9.8 src/env.c and FreeBSD releng/14.3 usr.bin/env/env.c
    // scan strchr(word, '=') after getopt; options never resume afterward.
    // https://github.com/coreutils/coreutils/blob/v9.8/src/env.c#L797
    // https://github.com/freebsd/freebsd-src/blob/releng/14.3/usr.bin/env/env.c#L188
    assignmentOperands: 'env',
    noArgFlags: ['-i', '--ignore-environment', '-0', '--null', '-v', '--debug'],
    argFlags: ['-u', '--unset', '-C', '--chdir'],
    // GNU env(1) `-S`/`--split-string=S`: processes and splits `S` into
    // separate arguments, splicing them into the invoked command's argv
    // (documented use: shebang lines with multiple arguments) — verified
    // empirically: `env -S 'echo hello world'` runs `echo` with args
    // `hello`, `world`, not a command literally named by the operand text.
    // The real wrapped command therefore lives *inside* `S`'s own text,
    // not at a fixed "next word" position this table can name — reporting
    // *any* word here as effective (the flag, `S`'s value, or whatever
    // word happens to follow) would be a guess, not a fact. `resolveArgv0`
    // stops here with `reason: 'embedded-command'` instead.
    unresolvableFlags: ['-S', '--split-string'],
  },

  // `nohup utility [argument...]` — POSIX `nohup`. No documented options
  // besides the utility itself; the word right after `nohup` is always
  // the wrapped command.
  { names: ['nohup'] },

  // `nice [-n adjustment] utility [argument...]` (GNU coreutils nice(1))
  // or the POSIX legacy attached form `nice -increment utility` (POSIX
  // `nice`, e.g. `nice -19 cmd`). `noArgFlagPattern` recognizes the
  // attached numeric form; `-n`/`--adjustment` take the adjustment as a
  // separate operand word, or attached (`-n10`, verified empirically
  // against GNU coreutils nice(1) — `nice -n10 cmd` runs `cmd`).
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
  // that reached `CallExpr.Args` some other way (quoted — `"time" cmd`
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
  // sudo(8). Only option forms that are documented (verified against real
  // `sudo -h` usage/option output) to still be followed by a command are
  // modeled: `-A`/`-b`/`-E`/`-H`/`-k`/`-n`/`-P`/`-S` take no operand;
  // `-g group`/`-p prompt`/`-u user` take one, in any getopt-standard
  // attached/clustered form (e.g. `-ualice`, `-Eu alice`). Deliberately
  // excludes `-e`/`-i`/`-l`/`-s`/`-v`/`-K` — sudo(8) documents these as
  // changing sudo's *mode* (edit, login shell, list, shell, validate,
  // reset) such that no ordinary "wrapped command" word necessarily
  // follows at all; modeling them as transparent would risk guessing a
  // command that isn't really there. Also deliberately excludes
  // `-D`/`--chdir`, `-C`/`--close-from`, `-R`/`--chroot`,
  // `-T`/`--command-timeout`, `-h`/`--host`, `-U`/`--other-user`,
  // `--preserve-env[=list]`, and every other option `sudo -h` documents
  // that this table doesn't name above — an unrecognized flag-shaped word
  // now correctly makes the whole resolution unresolvable (see
  // `resolveArgv0`'s doc comment) rather than being silently misidentified
  // as the wrapped command, so leaving these unmodeled is safe, not a gap.
  // `VAR=value` operands before the command are sudo's own
  // environment-setting mechanism, "similar to env" per sudo(8).
  {
    names: ['sudo'],
    // is_envar rejects '/' and '=' prefixes; !got_end_of_args prevents
    // assignments after --, while the enclosing loop resumes getopt.
    // https://github.com/sudo-project/sudo/blob/v1.9.17p2/src/parse_args.c#L263
    assignmentOperands: 'sudo',
    noArgFlags: ['-A', '-b', '-E', '-H', '-k', '-n', '-P', '-S'],
    argFlags: ['-g', '-p', '-u'],
  },
]);

/**
 * A data-only description of one shell interpreter whose `-c` option makes the
 * next operand a command string run by that shell (`bash -c 'rm x'`). Like
 * `env -S`, the command that runs lives *inside* an operand, so
 * {@link resolveArgv0} reports `'embedded-command'` instead of the
 * interpreter's own name as the effective command.
 *
 * Only the option grammar needed to decide *whether `-c` is an option* is
 * described: which options consume an operand word (so that `-o c` or
 * `-o pipefail -c` are not misread) and where option parsing ends. Everything
 * else about the interpreter — what its other options mean, whether a given
 * option name is valid — is irrelevant to that decision and unmodeled; an
 * invalid invocation that a real shell would reject is still reported
 * conservatively, since nothing is guessed about what it would run.
 *
 * Option parsing ends at the first statically known word that is not an
 * option, at `--`, at a lone `-`, or at a table-defined terminator; afterwards
 * a word shaped like `-c` is an ordinary script operand. A dynamic word in
 * option position leaves the question undecidable, so scanning stops and the interpreter is reported
 * exactly as before (its own static name). In that case `static: true` means
 * only that the interpreter's name is known; it does not mean the command is a
 * plain shell invocation, because `bash "$f" -c x` runs `x` when `$f` is `-x`.
 *
 * This shape may grow new optional fields in a **minor** release; existing
 * fields' meaning never changes.
 *
 * @public
 */
export interface EmbeddedCommandInterpreterSpec {
  /**
   * The interpreter's name, matched against a static command word's final
   * path segment: `bash`, `/bin/bash` and `/usr/local/bin/bash` all match
   * `['bash']`. Only the command word is reduced to its final segment;
   * entries containing `/` (such as `['/bin/bash']`) are rejected with
   * {@link ShAnalyzeInvalidWrapperSpecError}. Use `['bash']` to recognize
   * path-qualified invocations. The first entry containing the segment wins.
   *
   * Unlike {@link WrapperSpec.names}, which tries exact names first and
   * falls back to the final segment only for absolute paths, interpreter
   * matching uses only the final segment, including for relative paths
   * such as `./bash`. The question here is whether a command string is
   * embedded, not which executable would be located.
   */
  readonly names: readonly string[];

  /**
   * Single option letters (without a sign) that take a name or value operand
   * under both `-` and `+`, e.g. `['o']` for `-o pipefail` / `+o pipefail`.
   * A letter listed here never selects the command string itself, so
   * `bash -o c script` keeps `c` as an option *name*.
   */
  readonly operandOptions: readonly string[];

  /**
   * How an {@link EmbeddedCommandInterpreterSpec.operandOptions} letter
   * receives its operand inside a clustered word:
   *
   * - `'separate-word'` — always the next word; remaining letters in the
   *   cluster are still options (`bash -oc errexit 'cmd'` is `-o errexit -c`).
   * - `'rest-of-cluster'` — the remainder of the word if any, else the next
   *   word; later letters in the same word are part of the operand
   *   (`zsh -oc` names an option `c`).
   */
  readonly operandAttachment: 'separate-word' | 'rest-of-cluster';

  /**
   * Letters from {@link EmbeddedCommandInterpreterSpec.operandOptions} whose
   * separate operand may be omitted before a word beginning with `-` or `+`.
   * An attached operand still belongs to the option. For example, ksh93u+
   * treats `-o -c cmd` and `+o -c cmd` as an operand-free option listing
   * followed by `-c`; bash, dash and zsh consume `-c` as the option name.
   * A dynamic potential operand makes this distinction undecidable.
   */
  readonly optionalOperandOptions?: readonly string[];

  /**
   * No-operand letters that end option scanning after the current cluster,
   * under either sign. Remaining letters in that cluster still take effect:
   * zsh's `-b -c script` runs the file `-c`, but `-bc cmd` selects a string.
   * These letters must not include `c` or an operand-taking letter.
   */
  readonly optionTerminatorLetters?: readonly string[];

  /**
   * Additional whole words that end option scanning, like zsh's `+` and `+-`.
   * The terminator is not a command string; an already-selected `-c` needs
   * a following word. `--` and a lone `-` are always terminators.
   */
  readonly optionTerminatorWords?: readonly string[];

  /**
   * Exact long-option words that take a separate operand, recognized before
   * short-option clusters regardless of prefix: bash's `--rcfile FILE` and
   * `-rcfile FILE`, or zsh's `--emulate sh`. A dynamic operand stops scanning
   * because its expansion may produce multiple actual arguments.
   */
  readonly operandLongOptions?: readonly string[];

  /**
   * Exact long-option words with no operand, recognized before short-option
   * clusters. Bash's `-restricted` and `-noprofile` are whole long options,
   * not clusters containing `c` or `o`. Unlisted `--name` / `+-name` words
   * are also treated as operand-free; option validity is not checked.
   */
  readonly noOperandLongOptions?: readonly string[];

  /**
   * `true` if the interpreter also treats `+c` as selecting the command
   * string. Some shells do and some ignore the sign for this letter.
   */
  readonly plusCSelectsCommand?: boolean;
}

/**
 * Bash's operand-free single-dash long options from the 5.3.9 and Apple 3.2.57
 * help listings. Their internal letters must not select `-c` or consume an
 * option-name operand. Bash-backed `sh` needs the same spelling recognition.
 */
const BASH_SINGLE_DASH_FLAGS = [
  '-debug',
  '-debugger',
  '-dump-po-strings',
  '-dump-strings',
  '-help',
  '-login',
  '-noediting',
  '-noprofile',
  '-norc',
  '-posix',
  '-pretty-print',
  '-protected',
  '-restricted',
  '-verbose',
  '-version',
  '-wordexp',
] as const;

/**
 * `sh-ast/analyze`'s default {@link EmbeddedCommandInterpreterSpec} table:
 * the shells whose `-c` option makes {@link resolveArgv0} report
 * `'embedded-command'`. Each entry's option grammar is hand-derived from the
 * cited manual. Basic clusters and required operands were cross-checked on
 * Linux bash 5.2.21, dash 0.5.12, zsh 5.9, ksh93u+m 1.0.8 and mksh R59.
 * Long-option, termination and omitted-operand cases were checked on macOS
 * bash 5.3.9 and 3.2.57 (also `/bin/sh`), Apple dash-16, zsh 5.9 and ksh93u+
 * AJM 2012-08-01. Omitted `-o`/`+o` operands before another signed option
 * were confirmed only on that ksh93u+ build, not ksh93u+m or mksh. Builds can
 * differ: macOS's ksh93u+ differs from the cited 93u+m for `ksh -o c "echo X"`.
 * The `sh` entry also models bash's long options because `sh` can be bash.
 * Named options that change the option grammar itself (such as zsh's
 * `shoptionletters`) are not interpreted; a custom table is needed for that
 * grammar. It is data, not policy:
 * it names no dangerous commands and a caller can replace or extend it via
 * {@link ResolveArgv0Options.embeddedCommandInterpreters}; an empty array
 * restores the behavior in which an interpreter is an ordinary effective
 * command.
 *
 * Frozen, including each entry and its arrays.
 *
 * @see https://www.gnu.org/software/bash/manual/bash.html#Invoking-Bash — bash
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/utilities/sh.html — POSIX `sh`
 * @see https://man7.org/linux/man-pages/man1/dash.1.html — dash(1)
 * @see https://zsh.sourceforge.io/Doc/Release/Invocation-and-Startup.html — zsh
 * @see https://github.com/ksh93/ksh — ksh93u+m `sh(1)`
 * @see https://man.mirbsd.org/mksh.1 — mksh(1)
 * @public
 */
export const DEFAULT_EMBEDDED_COMMAND_INTERPRETERS: readonly EmbeddedCommandInterpreterSpec[] =
  deepFreeze([
    // bash(1) INVOCATION/OPTIONS: `-o option` and `-O shopt_option` each take
    // the next word, and in a cluster the operands are taken in order from
    // the following words (`-oc errexit 'cmd'` runs `cmd`). `--rcfile` and
    // `--init-file` take a file. `+c` is accepted as `-c`.
    {
      names: ['bash'],
      operandOptions: ['o', 'O'],
      operandAttachment: 'separate-word',
      operandLongOptions: ['--rcfile', '--init-file', '-rcfile', '-init-file'],
      noOperandLongOptions: BASH_SINGLE_DASH_FLAGS,
      plusCSelectsCommand: true,
    },
    // POSIX `sh`: `-o option` is the only portable operand option. `sh` is
    // bash, dash or another shell depending on the system, so this entry
    // models the superset: `-O` and bash's `--rcfile`/`--init-file` take an
    // operand so that a bash-backed `sh -O extglob -c` or `sh --rcfile f -c`
    // is not misread (dash rejects them, and rejecting means nothing runs).
    {
      names: ['sh'],
      operandOptions: ['o', 'O'],
      operandAttachment: 'separate-word',
      operandLongOptions: ['--rcfile', '--init-file', '-rcfile', '-init-file'],
      noOperandLongOptions: BASH_SINGLE_DASH_FLAGS,
      plusCSelectsCommand: true,
    },
    // dash(1): `-o option` takes the next word, even within a cluster.
    {
      names: ['dash'],
      operandOptions: ['o'],
      operandAttachment: 'separate-word',
      plusCSelectsCommand: true,
    },
    // zsh 5.9: `-o option` takes an attached or separate name; --emulate
    // and +-emulate consume a mode. Native -b/+b end options after their
    // cluster; a stacked '-' and the whole words '+' / '+-' also end them.
    {
      names: ['zsh'],
      operandOptions: ['o'],
      operandAttachment: 'rest-of-cluster',
      operandLongOptions: ['--emulate', '+-emulate'],
      optionTerminatorLetters: ['b', '-'],
      optionTerminatorWords: ['+', '+-'],
      plusCSelectsCommand: true,
    },
    // ksh93u+ AJM 2012-08-01: a separate -o/+o name is omitted when the
    // next word starts with either sign. Attached names still consume the
    // rest of the cluster. This boundary was not rerun on ksh93u+m.
    {
      names: ['ksh', 'ksh93'],
      operandOptions: ['o'],
      operandAttachment: 'rest-of-cluster',
      optionalOperandOptions: ['o'],
      plusCSelectsCommand: true,
    },
    // mksh R59: -o names attach to the cluster or consume the next word;
    // +c does not select a command string. No omitted-operand rule is assumed.
    {
      names: ['mksh'],
      operandOptions: ['o'],
      operandAttachment: 'rest-of-cluster',
    },
  ]);

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
   *
   * Validated at the {@link resolveArgv0} boundary: a malformed entry (a
   * non-array `names`, an empty `names`, or a wrong-typed flag field)
   * throws {@link ShAnalyzeInvalidWrapperSpecError} immediately, rather
   * than failing later with a confusing native `TypeError` deep inside
   * flag matching.
   */
  readonly transparentWrappers?: readonly WrapperSpec[];

  /**
   * The shell interpreters whose `-c` operand is reported as an
   * `'embedded-command'`. Defaults to
   * {@link DEFAULT_EMBEDDED_COMMAND_INTERPRETERS}. Pass a replacement array to
   * add or drop interpreters; an empty array disables the behavior, so every
   * interpreter resolves as an ordinary effective command.
   *
   * Validated at the {@link resolveArgv0} boundary like
   * {@link ResolveArgv0Options.transparentWrappers}: a malformed entry throws
   * {@link ShAnalyzeInvalidWrapperSpecError}.
   */
  readonly embeddedCommandInterpreters?: readonly EmbeddedCommandInterpreterSpec[];
}

/**
 * Why {@link resolveArgv0} couldn't identify a single, definite effective
 * command — distinct from {@link WordResolutionReason}, which is about why
 * one *word*'s text is unknowable at the shell-syntax level (an expansion,
 * a glob, …). `Argv0UnresolvedReason` instead reflects `resolveArgv0`'s own
 * wrapper-table-driven analysis of an otherwise statically-known word:
 *
 * - `'unknown-flag'` — a statically known word shaped like a flag (starts
 *   with `-`, isn't exactly `--`) for the wrapper currently being
 *   followed, but that doesn't match any flag/operand shape
 *   {@link WrapperSpec} recognizes for it. Never guessed through as the
 *   wrapped command — see {@link resolveArgv0}'s doc comment.
 * - `'embedded-command'` — a wrapper flag whose value structurally embeds
 *   the real command rather than naming it as a separate word (e.g.
 *   `env -S 'rm -rf /'` — see {@link WrapperSpec.unresolvableFlags}'s doc
 *   comment), or a shell interpreter's `-c` option (`bash -c 'rm x'`, see
 *   {@link EmbeddedCommandInterpreterSpec}). In both cases the chain's
 *   second-to-last element is the wrapper or interpreter word, so its name
 *   stays available.
 * - `'ambiguous-assignment'` — a statically known assignment operand whose
 *   acceptance differs across supported utility implementations, such as
 *   `env =value cmd` (GNU/glibc accepts an empty name; BSD rejects it).
 *   Neither the following command nor the operand itself is guessed as
 *   the effective command.
 *
 * This union may grow in a **minor** release (mirroring
 * `WordResolutionReason`'s and `CommandContext`'s semver policy in
 * `resolve-word.ts`/`enumerate-commands.ts`) — a reason this version
 * doesn't yet know about only ever accompanies `static: false`; an
 * exhaustive `switch` should still include a `default` case.
 *
 * @public
 */
export type Argv0UnresolvedReason = 'unknown-flag' | 'embedded-command' | 'ambiguous-assignment';

/**
 * A word position {@link resolveArgv0} could not resolve to either a known
 * static text or one of {@link WordResolution}'s own `static: false`
 * reasons — see {@link Argv0UnresolvedReason}'s doc comment. Shares
 * `WordResolution`'s `static: false` discriminant shape by design, so a
 * consumer that only branches on `.static` treats it identically to any
 * other unresolvable word.
 *
 * @public
 */
export interface Argv0UnresolvedWord {
  readonly static: false;
  readonly reason: Argv0UnresolvedReason;
}

/**
 * The result of statically resolving one position in an
 * {@link Argv0Resolution.chain}: either an ordinary {@link WordResolution}
 * (from `resolveWord`) or an {@link Argv0UnresolvedWord} (a `resolveArgv0`-
 * level "we don't know", distinct from any reason `resolveWord` itself
 * would report).
 *
 * @public
 */
export type Argv0ChainWord = WordResolution | Argv0UnresolvedWord;

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
  readonly chain: readonly Argv0ChainWord[];

  /**
   * Indices into the input {@link CommandSite.argv}, one for each corresponding
   * {@link Argv0Resolution.chain} entry. The arrays always have the same nonzero
   * length. Ordinary entries identify their original word; synthesized failures
   * identify the triggering flag or ambiguous assignment operand instead.
   * Repeated word text does not collapse distinct argument positions.
   *
   * For a resolved effective command, its arguments are
   * `site.argv.slice(chainIndices.at(-1)! + 1)`. Sites from
   * {@link enumerateCommands} align argv directly with `site.node.Args`, retaining
   * null slots as unsupported word resolutions, so the same indices select syntax
   * Words. A synthetic failure does not identify a command or its arguments.
   * When wrapper scanning stops or runs out of operands, the existing result
   * remains the wrapper word and its index; no missing command is invented.
   */
  readonly chainIndices: readonly number[];

  /**
   * The last element of {@link Argv0Resolution.chain} — the effective
   * command, or, if resolution hit a statically-unknowable word anywhere
   * along the chain (an expansion, a glob, an unrecognized flag, an
   * embedded-command operand, …), that unknowable result itself.
   * **A `static: false` word is never guessed through**: the moment one is
   * reached (whether at argv0, several wrappers deep, or synthesized by
   * `resolveArgv0` itself for an unrecognized flag), it becomes
   * `effective` and the chain stops — this is the security-relevant
   * guarantee that makes `sudo -u x "$prog"` report an unknowable
   * effective command rather than silently treating `sudo` itself as the
   * answer, and makes `sudo -D /tmp rm x` (an unrecognized `sudo` flag)
   * report `'unknown-flag'` rather than misreporting `rm` — or, worse,
   * `/tmp` — as the effective command.
   */
  readonly effective: Argv0ChainWord;

  /**
   * The number of `VAR=val` shell-assignment prefixes on the `CallExpr`
   * itself (`CommandSite.node.Assigns`, e.g. the `FOO=bar` in
   * `FOO=bar rm x`) that were skipped to reach argv0. This is a distinct
   * mechanism from a wrapper's own `VAR=val` *operands* (e.g. `env`'s or
   * `sudo`'s, see {@link WrapperSpec.skipAssignmentOperands}) — always
   * exactly `CommandSite.node.Assigns`'s length, independent of the
   * wrapper chain found afterward.
   */
  readonly assignmentsSkipped: number;
}

/** `true` iff `text` is shaped like a shell assignment operand (`NAME=...`). */
function isAssignmentShapedText(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(text);
}

/** `true` iff `text` is a `--long-flag=value` attached form of one of `flags`. */
function matchesAttachedLongFlag(text: string, flags: readonly string[]): boolean {
  return flags.some((flag) => flag.startsWith('--') && text.startsWith(`${flag}=`));
}

/**
 * `true` iff `text` is shaped like a command-line flag: starts with `-`
 * but isn't exactly `--` (the end-of-options marker, handled separately)
 * or a bare `-` (POSIX reserves a lone `-` as an ordinary operand — e.g.
 * "read from stdin" — never an option, so it is not flag-shaped here
 * either).
 */
function looksLikeFlag(text: string): boolean {
  return text.length > 1 && text.startsWith('-') && text !== '--';
}

/**
 * `true` iff `text` matches one of `flags` for {@link WrapperSpec}'s
 * "whole-token or attached-value" fields ({@link WrapperSpec.unresolvableFlags},
 * {@link WrapperSpec.stopsChainFlags}): an exact match, a `--flag=value`
 * attached form for a `--`-prefixed entry, or a `-Xvalue` attached form
 * for a 2-character short entry. Unlike {@link WrapperSpec.argFlags}, this
 * does not participate in short-flag *clustering* (see
 * {@link matchShortFlagCluster}'s doc comment) — a flag combined into a
 * cluster with other short flags (e.g. hypothetically `-iS'cmd'` for
 * `env`) falls through to the generic unknown-flag path instead of this
 * more specific one; still fails closed, just with a less specific reason.
 */
function matchesWholeOrAttachedFlag(text: string, flags: readonly string[]): boolean {
  return flags.some((flag) => {
    if (text === flag) return true;
    if (flag.startsWith('--')) return text.startsWith(`${flag}=`);
    return flag.length === 2 && text.startsWith(flag) && text.length > flag.length;
  });
}

/**
 * Recognizes a short-option cluster/attached form for `text` against
 * `spec`'s `noArgFlags`/`argFlags` — the getopt-standard shapes
 * {@link WrapperSpec.argFlags}'s doc comment documents:
 *
 * - `-Xvalue` — a single `argFlags` character `X` with its operand
 *   attached directly (`-ualice`, `-n10`).
 * - `-ABX` / `-ABXvalue` — one or more `noArgFlags` characters (`A`, `B`,
 *   …) clustered before a final `argFlags` character `X`, whose operand is
 *   either attached (`-Eualice`) or the next separate word (`-Eu alice`).
 * - `-AB` — two or more `noArgFlags` characters clustered with no
 *   trailing `argFlags` character at all (`-iv`).
 *
 * Scans `text`'s characters left to right; the first character that is
 * neither a recognized `noArgFlags` nor `argFlags` entry (for that single
 * character, as `-X`) fails the whole match (`'no-match'`) — real getopt
 * clustering has the same "first bad option char aborts" behavior, and a
 * partially-matched guess would be worse than failing closed. Whole-token
 * exact matches and `--`-prefixed long flags are handled earlier by the
 * caller and never reach here (this function only ever sees text that
 * didn't already match `noArgFlags`/`argFlags`/`noArgFlagPattern`/attached
 * long-flag checks directly).
 *
 * Returns `'one'` if the whole `text` token is consumed with no further
 * operand word needed (the final flag was `noArgFlags`, or an `argFlags`
 * character had an attached operand), `'two'` if the next, separate word
 * is the final `argFlags` character's operand, or `'no-match'` if `text`
 * isn't a valid cluster/attached form for `spec` at all.
 */
function matchShortFlagCluster(text: string, spec: WrapperSpec): 'one' | 'two' | 'no-match' {
  if (!text.startsWith('-') || text.startsWith('--') || text.length < 2) {
    return 'no-match';
  }
  const chars = text.slice(1);
  for (let i = 0; i < chars.length; i += 1) {
    const flagToken = `-${chars[i]}`;
    if (spec.noArgFlags?.includes(flagToken) === true) {
      continue;
    }
    if (spec.argFlags?.includes(flagToken) === true) {
      return chars.slice(i + 1).length > 0 ? 'one' : 'two';
    }
    return 'no-match';
  }
  // Every character matched a noArgFlags entry — a pure no-operand
  // cluster (e.g. `-iv`).
  return 'one';
}

/**
 * The wrapper entry that recognizes `text`: an exact `names` match, else, for
 * an absolute path only, a match on its final path segment (see
 * {@link WrapperSpec.names}). A relative path is never matched by segment.
 */
function findWrapperSpec(wrappers: readonly WrapperSpec[], text: string): WrapperSpec | undefined {
  const exact = wrappers.find((spec) => spec.names.includes(text));
  if (exact !== undefined || !text.startsWith('/')) return exact;
  const name = text.slice(text.lastIndexOf('/') + 1);
  if (name === '') return undefined;
  return wrappers.find((spec) => spec.names.includes(name));
}

/** The outcome of {@link advancePastWrapperOperands} scanning `spec`'s own operands forward from a starting index. */
type AdvanceResult =
  | { readonly kind: 'next'; readonly index: number }
  | { readonly kind: 'truncated' }
  | {
      readonly kind: 'unresolvable';
      readonly reason: Argv0UnresolvedReason;
      /** Argument responsible for the synthetic failure, rather than a guessed command. */
      readonly index: number;
    };

/**
 * Walks `argv` forward from `startIndex`, skipping every word this `spec`
 * structurally recognizes as its own flag, flag-operand (in any
 * getopt-standard attached/clustered form — see
 * {@link matchShortFlagCluster}'s doc comment), `VAR=val` operand, or
 * required positional operand, and classifies what comes next:
 *
 * - `{ kind: 'next', index }` — either the wrapped command (an ordinary
 *   word not shaped like a flag), or a dynamic (`static: false`) word,
 *   which the caller's own loop already handles via `WordResolution`'s
 *   normal "never guessed through" rule.
 * - `{ kind: 'truncated' }` — `spec`'s own words ran past the end of
 *   `argv` with no wrapped-command word found (a malformed or truncated
 *   invocation, e.g. bare `env` with nothing else, or `sudo -u` with no
 *   operand for `-u`).
 * - `{ kind: 'unresolvable', reason, index }` — an ambiguous assignment, or a
 *   *statically known* word that
 *   looks like a flag for this wrapper (unquoted, unescaped `-` prefix,
 *   not `--`) but matches none of `spec`'s recognized flag/operand shapes,
 *   or matches one of `spec.unresolvableFlags` (see
 *   {@link WrapperSpec.unresolvableFlags}'s doc comment). Such a word is
 *   *never* treated as the wrapped command candidate: a flag-shaped word
 *   this table doesn't recognize is far more likely to be an
 *   unmodeled/unsupported option than a command literally named e.g.
 *   `-D` — see {@link resolveArgv0}'s doc comment.
 *
 * A literal `--` (the standard getopt(3)/getopt_long(3) end-of-options
 * marker — POSIX Utility Syntax Guidelines, guideline 10) is skipped like
 * any other recognized token, but — critically — everything *after* it is
 * no longer eligible for **any** flag recognition at all
 * (`noArgFlags`, `noArgFlagPattern`, `argFlags` in every form,
 * `unresolvableFlags`, `stopsChainFlags`, or the generic
 * flag-shape/`'unknown-flag'` check): once options end, a later word that
 * merely *looks* like a flag (e.g. `-u`) is an ordinary operand — real
 * `sudo(8)` documents this explicitly ("command line arguments after the
 * `--` are passed to the command as-is"), and it's the entire point of
 * `--` for every wrapper here. A wrapper's mandatory positional operand
 * (e.g. `timeout`'s `DURATION`) is a distinct, non-flag concept and is
 * still consumed normally after `--` — only *flag* recognition stops.
 * Assignment recognition follows the explicit grammar: `env` scans
 * assignments even after `--` and stops option parsing at its first
 * assignment; `sudo` and the legacy shell-identifier grammar recognize
 * assignments only before `--` and allow later options.
 */
function advancePastWrapperOperands(
  argv: readonly WordResolution[],
  startIndex: number,
  spec: WrapperSpec,
): AdvanceResult {
  let index = startIndex;
  let positionalSeen = 0;
  let optionsEnded = false;
  const assignmentGrammar =
    spec.assignmentOperands ??
    (spec.skipAssignmentOperands === true ? 'shell-identifier' : undefined);
  const requiredPositional = spec.positionalOperandsBeforeCommand ?? 0;
  while (index < argv.length) {
    // `index < argv.length` just checked above, so this is a real element.
    const word = argv[index];
    if (!word.static) {
      // Can't be identified as this wrapper's own flag/operand text at
      // all — never guessed through, so this word itself is the next
      // chain element (the caller's loop will see it's unresolvable and
      // stop there via `WordResolution`'s own `static: false`).
      return { kind: 'next', index };
    }
    const text = word.text;
    if (!optionsEnded && text === '--') {
      optionsEnded = true;
      index += 1;
      continue;
    }
    // An '=' in an active option (e.g. --unset=NAME) does not make it an
    // assignment. After env's option phase, however, even '-x=y' is one.
    const canRecognizeAssignment =
      (assignmentGrammar === 'env' || !optionsEnded) &&
      (assignmentGrammar === 'shell-identifier' || optionsEnded || !looksLikeFlag(text));
    if (canRecognizeAssignment && assignmentGrammar === 'env' && text.startsWith('=')) {
      // glibc putenv accepts an empty name, while FreeBSD setenv rejects
      // it. The grammar therefore cannot identify a portable invocation.
      return { kind: 'unresolvable', reason: 'ambiguous-assignment', index };
    }
    const isAssignment =
      assignmentGrammar === 'shell-identifier'
        ? isAssignmentShapedText(text)
        : text.includes('=') &&
          (assignmentGrammar === 'env' ||
            (assignmentGrammar === 'sudo' && !text.startsWith('/') && !text.startsWith('=')));
    if (canRecognizeAssignment && isAssignment) {
      if (assignmentGrammar === 'env') {
        optionsEnded = true;
      }
      index += 1;
      continue;
    }
    if (!optionsEnded) {
      if (
        spec.unresolvableFlags !== undefined &&
        matchesWholeOrAttachedFlag(text, spec.unresolvableFlags)
      ) {
        return { kind: 'unresolvable', reason: 'embedded-command', index };
      }
      if (
        spec.stopsChainFlags !== undefined &&
        matchesWholeOrAttachedFlag(text, spec.stopsChainFlags)
      ) {
        // This wrapper's own invocation is the effective command — the
        // caller must not advance past it at all. Modeled as "truncated":
        // the chain simply ends at the wrapper word already pushed, the
        // same outcome as a genuinely truncated invocation (see
        // `resolveArgv0`'s loop) — nothing more to skip or resolve.
        return { kind: 'truncated' };
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
      const clusterMatch = matchShortFlagCluster(text, spec);
      if (clusterMatch === 'one') {
        index += 1;
        continue;
      }
      if (clusterMatch === 'two') {
        index += 2;
        continue;
      }
      // A flag-shaped word this wrapper doesn't recognize is checked
      // *before* the positional-operand fallback below: real getopt-based
      // parsers reject an unrecognized option outright rather than
      // reinterpreting it as a positional operand (verified against GNU
      // timeout(1)'s getopt_long-based option parsing) — so a required
      // positional slot (e.g. `timeout`'s `DURATION`) may only ever be
      // filled by a non-flag-shaped word, never by an unrecognized `-x`.
      // None of this applies once `optionsEnded` — see this function's
      // doc comment.
      if (looksLikeFlag(text)) {
        return { kind: 'unresolvable', reason: 'unknown-flag', index };
      }
    }
    if (positionalSeen < requiredPositional) {
      positionalSeen += 1;
      index += 1;
      continue;
    }
    return { kind: 'next', index };
  }
  return { kind: 'truncated' };
}

/** The interpreter entry whose name matches `text`'s final path segment, if any. */
function findInterpreterSpec(
  interpreters: readonly EmbeddedCommandInterpreterSpec[],
  text: string,
): EmbeddedCommandInterpreterSpec | undefined {
  const name = text.slice(text.lastIndexOf('/') + 1);
  return interpreters.find((spec) => spec.names.includes(name));
}

/**
 * Scans an interpreter's option words from `startIndex` and returns the index
 * of the word that selects the `-c` command string, or `undefined` when none
 * does or no command-string operand follows it — the options ended first (see {@link EmbeddedCommandInterpreterSpec}),
 * a dynamic word made the grammar undecidable, or the words ran out.
 *
 * Mirrors real shell option parsing, verified against bash, dash, zsh, ksh93
 * and mksh: a cluster is read letter by letter; `c` selects the command
 * string; operand-taking letters consume words or the rest of their cluster.
 * Optional operands and option terminators come from the same table, so a
 * following flag remains visible when an operand is omitted, and a terminating
 * letter affects subsequent words without discarding the rest of its cluster.
 */
function findCommandStringOption(
  argv: readonly WordResolution[],
  startIndex: number,
  spec: EmbeddedCommandInterpreterSpec,
): number | undefined {
  let index = startIndex;
  // The word that selected `-c`; it only counts once an operand follows.
  let selected: number | undefined;
  while (index < argv.length) {
    const word = argv[index];
    // A dynamic word is the command string once `-c` is selected; before
    // that it makes the option grammar undecidable.
    if (!word.static) return selected;
    const text = word.text;
    // Terminator words end options in the modeled grammar, so only a
    // word after them can be the command string; a lone `+` and any
    // non-option word are the operand itself (a script path before `-c`
    // is selected, the command string after).
    const sign = text[0];
    if (text === '--' || text === '-' || spec.optionTerminatorWords?.includes(text) === true) {
      return selected !== undefined && index + 1 < argv.length ? selected : undefined;
    }
    if (text.length < 2 || (sign !== '-' && sign !== '+')) return selected;
    if (spec.operandLongOptions?.includes(text) === true) {
      // Even a quoted expansion such as "$@" can become several arguments.
      // Advancing by one syntactic word would guess where options resume.
      const operand = argv.at(index + 1);
      if (operand?.static !== true) return undefined;
      index += 2;
      continue;
    }
    if (
      spec.noOperandLongOptions?.includes(text) === true ||
      text.startsWith('--') ||
      text.startsWith('+-')
    ) {
      index += 1;
      continue;
    }
    // Separate operands belong to this cluster in encounter order. Keeping
    // their cursor explicit lets optional operands leave a following flag
    // available to the outer scan without hiding later required operands.
    let nextIndex = index + 1;
    let optionsEnded = false;
    for (let i = 1; i < text.length; i += 1) {
      const letter = text[i];
      if (letter === 'c') {
        if ((sign === '-' || spec.plusCSelectsCommand === true) && selected === undefined) {
          selected = index;
        }
      } else if (spec.operandOptions.includes(letter)) {
        if (spec.operandAttachment === 'rest-of-cluster' && i < text.length - 1) break;
        const operand = argv.at(nextIndex);
        // Required operands can expand to several fields too; neither their
        // argument count nor an optional operand's boundary can be guessed.
        if (operand?.static !== true) return undefined;
        if (spec.optionalOperandOptions?.includes(letter) === true) {
          if (operand.text.startsWith('-') || operand.text.startsWith('+')) continue;
        }
        nextIndex += 1;
      } else if (spec.optionTerminatorLetters?.includes(letter) === true) {
        optionsEnded = true;
      }
    }
    if (optionsEnded) {
      return selected !== undefined && nextIndex < argv.length ? selected : undefined;
    }
    index = nextIndex;
  }
  // Ran out of words: a selected `-c` has no command string (every modeled
  // shell rejects it: "option requires an argument") so nothing is embedded.
  return undefined;
}

/** `true` iff `value` is a non-empty array of non-empty strings. */
function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  );
}

/**
 * Validates one injected {@link WrapperSpec} entry's shape, throwing
 * {@link ShAnalyzeInvalidWrapperSpecError} on the first problem found —
 * see {@link ResolveArgv0Options.transparentWrappers}'s doc comment for
 * why this happens at the boundary rather than surfacing as a confusing
 * native `TypeError` deep inside flag matching.
 */
function validateWrapperSpec(spec: WrapperSpec, index: number): void {
  const context = `transparentWrappers[${String(index)}]`;
  if (!isNonEmptyStringArray(spec.names)) {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.names must be a non-empty array of non-empty strings`,
    );
  }
  const stringArrayFields: readonly (keyof WrapperSpec)[] = [
    'noArgFlags',
    'argFlags',
    'unresolvableFlags',
    'stopsChainFlags',
  ];
  for (const field of stringArrayFields) {
    const value = spec[field];
    if (
      value !== undefined &&
      !(Array.isArray(value) && value.every((item) => typeof item === 'string'))
    ) {
      throw new ShAnalyzeInvalidWrapperSpecError(
        `${context}.${field} must be an array of strings when present`,
      );
    }
  }
  if (
    spec.skipAssignmentOperands !== undefined &&
    typeof spec.skipAssignmentOperands !== 'boolean'
  ) {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.skipAssignmentOperands must be a boolean when present`,
    );
  }
  // JavaScript callers can bypass the declared union; validate raw boundary data.
  const assignmentOperands: unknown = spec.assignmentOperands;
  if (
    assignmentOperands !== undefined &&
    assignmentOperands !== 'shell-identifier' &&
    assignmentOperands !== 'env' &&
    assignmentOperands !== 'sudo'
  ) {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.assignmentOperands must be shell-identifier, env, or sudo when present`,
    );
  }
  if (spec.noArgFlagPattern !== undefined && !(spec.noArgFlagPattern instanceof RegExp)) {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.noArgFlagPattern must be a RegExp when present`,
    );
  }
  if (
    spec.positionalOperandsBeforeCommand !== undefined &&
    !(
      typeof spec.positionalOperandsBeforeCommand === 'number' &&
      Number.isInteger(spec.positionalOperandsBeforeCommand) &&
      spec.positionalOperandsBeforeCommand >= 0
    )
  ) {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.positionalOperandsBeforeCommand must be a non-negative integer when present`,
    );
  }
}

/**
 * Validates one injected {@link EmbeddedCommandInterpreterSpec}, throwing
 * {@link ShAnalyzeInvalidWrapperSpecError} on the first problem — the same
 * boundary rule as {@link validateWrapperSpec}, so a malformed JavaScript
 * caller's table fails loudly instead of as a native `TypeError` mid-scan.
 */
function validateInterpreterSpec(spec: EmbeddedCommandInterpreterSpec, index: number): void {
  const context = `embeddedCommandInterpreters[${String(index)}]`;
  // The declared type cannot constrain JavaScript callers. Validate the raw
  // entry before reading any fields, just as their raw field values are checked.
  const entry: unknown = spec;
  if (typeof entry !== 'object' || entry === null) {
    throw new ShAnalyzeInvalidWrapperSpecError(`${context} must be a non-null object`);
  }
  if (!isNonEmptyStringArray(spec.names)) {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.names must be a non-empty array of non-empty strings`,
    );
  }
  if (spec.names.some((name) => name.includes('/'))) {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.names must contain basenames without '/'`,
    );
  }
  if (
    !Array.isArray(spec.operandOptions) ||
    !spec.operandOptions.every((item) => typeof item === 'string' && item.length === 1)
  ) {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.operandOptions must be an array of single-character strings`,
    );
  }
  // JavaScript callers can bypass the declared union; validate raw boundary data.
  const attachment: unknown = spec.operandAttachment;
  if (attachment !== 'separate-word' && attachment !== 'rest-of-cluster') {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.operandAttachment must be separate-word or rest-of-cluster`,
    );
  }
  const letterFields = ['optionalOperandOptions', 'optionTerminatorLetters'] as const;
  for (const field of letterFields) {
    const value = spec[field];
    if (
      value !== undefined &&
      !(
        Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length === 1)
      )
    ) {
      throw new ShAnalyzeInvalidWrapperSpecError(
        `${context}.${field} must be an array of single-character strings`,
      );
    }
  }
  if (
    spec.optionalOperandOptions?.some((letter) => !spec.operandOptions.includes(letter)) === true
  ) {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.optionalOperandOptions must be a subset of operandOptions`,
    );
  }
  if (
    spec.optionTerminatorLetters?.some(
      (letter) => letter === 'c' || spec.operandOptions.includes(letter),
    ) === true
  ) {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.optionTerminatorLetters must contain only no-operand letters other than 'c'`,
    );
  }
  if (
    spec.optionTerminatorWords !== undefined &&
    !(
      Array.isArray(spec.optionTerminatorWords) &&
      spec.optionTerminatorWords.every((item) => typeof item === 'string' && item.length > 0)
    )
  ) {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.optionTerminatorWords must be an array of non-empty strings`,
    );
  }
  // Exact option spellings have the same representation whether or not
  // they consume an operand; validate both before scanning the table.
  for (const field of ['operandLongOptions', 'noOperandLongOptions'] as const) {
    const value = spec[field];
    if (
      value !== undefined &&
      !(Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0))
    ) {
      throw new ShAnalyzeInvalidWrapperSpecError(
        `${context}.${field} must be an array of non-empty strings when present`,
      );
    }
  }
  if (spec.plusCSelectsCommand !== undefined && typeof spec.plusCSelectsCommand !== 'boolean') {
    throw new ShAnalyzeInvalidWrapperSpecError(
      `${context}.plusCSelectsCommand must be a boolean when present`,
    );
  }
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
 * **A statically-unknowable word is never guessed through** — four
 * distinct cases all stop the chain immediately at that word rather than
 * falling back to any other guess:
 *
 * 1. `argv0` or any wrapper's located word itself resolves `static: false`
 *    (an expansion, tilde, glob, …) — `sudo -u x "$prog"` reports
 *    `effective: { static: false, reason: 'expansion' }` with
 *    `chain: [<sudo>, <"$prog">]`, not `rm`/`sudo`/anything static.
 * 2. A *statically known* word shaped like a flag (`-`-prefixed, not
 *    `--`) doesn't match any flag/operand shape the current
 *    {@link WrapperSpec} recognizes — `sudo -D /tmp rm x` (`-D` isn't
 *    modeled for `sudo`) reports an `effective` of `static: false` with
 *    `reason: 'unknown-flag'`, **not** `rm` (the pre-fix behavior: any
 *    unrecognized word, flag-shaped or not, was silently treated as the
 *    wrapped command — a false report that hid the real effective
 *    command behind a flag this table simply hadn't modeled yet).
 * 3. A recognized flag's value structurally embeds the real command
 *    rather than naming it as a separate word — `env -S 'rm -rf /'`
 *    reports `effective: { static: false, reason: 'embedded-command' }`
 *    (see {@link WrapperSpec.unresolvableFlags}'s doc comment).
 *
 * 4. The effective command is a shell interpreter
 *    ({@link DEFAULT_EMBEDDED_COMMAND_INTERPRETERS}) invoked with `-c` —
 *    `bash -c "$x"`, `sudo sh -ec ls` — and the command that runs is
 *    inside the string operand. The result is the same
 *    `'embedded-command'` shape `env -S` produces: the interpreter word is
 *    `chain.at(-2)` and `chainIndices.at(-1)` is the option word that
 *    selected `-c`. `bash script.sh`, `bash -e script.sh`, `bash -- -c`
 *    and `bash -o c` are not `-c` invocations and resolve to `bash` as
 *    before. A dynamic word in option position (`bash "$f" -c x`,
 *    `bash -c"$y" x`) is undecidable, so the interpreter stays a static
 *    `bash`: `static: true` then means only that the name is known, not that
 *    the command is a plain shell invocation. The `-c` string itself is never
 *    parsed.
 *
 * `VAR=val` shell-assignment prefixes on the `CallExpr` itself
 * (`CommandSite.node.Assigns`, e.g. `FOO=bar rm x`) are always skipped and
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
 * @throws {@link ShAnalyzeInvalidWrapperSpecError} if
 * `options.transparentWrappers` or `options.embeddedCommandInterpreters`
 * contains a malformed entry (see
 * {@link ResolveArgv0Options.transparentWrappers}'s doc comment).
 * @public
 */
export function resolveArgv0(site: CommandSite, options?: ResolveArgv0Options): Argv0Resolution {
  if (site.argv.length === 0) {
    throw new TypeError('resolveArgv0 expects a CommandSite with at least one argv word');
  }
  const wrappers = options?.transparentWrappers ?? DEFAULT_TRANSPARENT_WRAPPERS;
  if (options?.transparentWrappers !== undefined) {
    wrappers.forEach(validateWrapperSpec);
  }
  const interpreters =
    options?.embeddedCommandInterpreters ?? DEFAULT_EMBEDDED_COMMAND_INTERPRETERS;
  if (options?.embeddedCommandInterpreters !== undefined) {
    // Every declared slot must be valid, including sparse holes that would
    // otherwise bypass validation and later surface as native TypeErrors.
    for (const [index, spec] of interpreters.entries()) {
      validateInterpreterSpec(spec, index);
    }
  }
  const assignmentsSkipped = nodeArray(site.node.Assigns).length;
  const argv = site.argv;
  const chain: Argv0ChainWord[] = [];
  // Provenance is captured at discovery, so repeated text and skipped operands are unambiguous.
  const chainIndices: number[] = [];
  let index = 0;
  while (index < argv.length) {
    // `index < argv.length` just checked above, so this is a real element.
    const word = argv[index];
    chain.push(word);
    chainIndices.push(index);
    if (!word.static) break;
    const spec = findWrapperSpec(wrappers, word.text);
    if (spec === undefined) {
      const interpreter = findInterpreterSpec(interpreters, word.text);
      const optionIndex =
        interpreter === undefined
          ? undefined
          : findCommandStringOption(argv, index + 1, interpreter);
      if (optionIndex !== undefined) {
        chain.push({ static: false, reason: 'embedded-command' });
        chainIndices.push(optionIndex);
      }
      break;
    }
    const result = advancePastWrapperOperands(argv, index + 1, spec);
    if (result.kind === 'truncated') break;
    if (result.kind === 'unresolvable') {
      chain.push({ static: false, reason: result.reason });
      chainIndices.push(result.index);
      break;
    }
    index = result.index;
  }
  // `site.argv.length > 0` is checked above, so the loop above always runs
  // at least one iteration and pushes `argv[0]` before any `break` — chain
  // always has at least one element.
  const effective = chain[chain.length - 1];
  return { chain, chainIndices, effective, assignmentsSkipped };
}
