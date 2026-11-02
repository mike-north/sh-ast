/** Shared failure classes for binding invariants, resource limits, and analysis contracts. */

/**
 * Common base for every package failure, including upstream syntax errors and
 * analysis errors. The stable code discriminator supports programmatic handling
 * without interpreting display messages. Only concrete subclasses are thrown.
 * @public
 */
export abstract class ShAstError extends Error {
  /** Stable machine-readable identity of the concrete failure kind. */
  abstract readonly code: string;
}

/**
 * Thrown by {@link parseSync} for failures that should never happen given a
 * correctly-behaving WASM shim: a malformed result envelope, an unexpected
 * root node type, or any other shim contract violation. Distinct from
 * {@link InputError} and {@link ParseError}, both of which
 * indicate a foreseeable, actionable user mistake rather than an internal
 * defect.
 *
 * @public
 */
export class ShInternalError extends ShAstError {
  readonly code = 'SH_AST_INTERNAL';

  constructor(message: string) {
    super(message);
    this.name = 'ShInternalError';
  }
}

/**
 * Thrown by `sh-ast/analyze`'s `enumerateCommands` when a tree's genuinely
 * nested structure — subshells within subshells, chained command/process
 * substitutions, deeply nested `if`/`case`/loop/function/`time`/`{ }`
 * bodies, deeply chained `elif` — exceeds its defensive recursion-depth
 * guard. **Not** thrown for a long *linear* chain (`|`/`|&`/`&&`/`||` of
 * any realistic length): `enumerateCommands` traverses those iteratively,
 * so chain length alone never grows this guard's depth counter — only
 * genuine tree nesting does.
 *
 * `enumerateCommands` deliberately fails closed here rather than returning
 * a truncated, partial result: a partial `CommandSite[]` silently omits
 * real command sites, which is a false negative for a permission-hook-style
 * consumer that treats "command not found in the enumeration" as "nothing
 * to worry about" — an explicit, documented throw is safer than a silent
 * under-report. Gate-style consumers should treat this error as `deny`,
 * not fall back to "no commands found, so allow".
 *
 * @public
 */
export class ShAnalyzeMaxDepthError extends ShAstError {
  readonly code = 'SH_AST_ANALYZE_MAX_DEPTH';
  /** The maximum nesting depth `enumerateCommands` supports; the same value every time (not caller-configurable). */
  readonly maxDepth: number;

  constructor(maxDepth: number) {
    super(
      `enumerateCommands: exceeded the maximum supported structural nesting depth (${String(maxDepth)} frames) — refusing to return a partial result. Treat this as a deny signal, not "no commands found".`,
    );
    this.name = 'ShAnalyzeMaxDepthError';
    this.maxDepth = maxDepth;
  }
}

/**
 * Thrown by {@link parseSync} when `text`'s conservatively estimated
 * structural nesting depth (subshells, command/process substitutions,
 * `if`/`case`/loop/function bodies, `{ }` blocks, backtick or `$(...)`
 * command substitution, `$((...))` arithmetic — see
 * `parse-depth-guard.ts`'s module doc for the exact heuristic) exceeds the
 * limit `parseSync` accepts. Thrown *before* `text` is ever handed to the
 * WASM shim: mvdan/sh's own recursive-descent parser has no recovery path
 * for exhausting its call stack on pathologically deep input (a stack
 * overflow deep inside the shared WASM instance is not a normal, catchable
 * JS error the way a parse syntax error is), so this bridge estimates the
 * risk up front and fails closed with a typed error instead of ever making
 * that call — the shared WASM instance is therefore never put at risk of
 * wedging on this class of input; a `parseSync` call right after catching
 * this error works exactly as it would if this input had never been
 * attempted.
 *
 * Like {@link ShAnalyzeMaxDepthError}, this is pathological-input
 * protection, not a normal-usage ceiling: a legitimately deep (but
 * realistic) script parses fine. The estimate can *over*-count relative to
 * mvdan/sh's real grammar (rejecting some legitimate-but-unusually-deep
 * input) but is designed to never *under*-count relative to it — see
 * `parse-depth-guard.ts` for the documented false-positive sources this
 * trades off against ever letting a genuinely crash-inducing input
 * through.
 *
 * @public
 */
export class ShParseMaxDepthError extends ShAstError {
  readonly code = 'SH_AST_PARSE_MAX_DEPTH';
  /** The maximum structural nesting depth `parseSync` accepts; the same value every time (not caller-configurable). */
  readonly maxDepth: number;
  /**
   * The conservatively estimated nesting depth that tripped the guard.
   * Not necessarily `text`'s "true" nesting depth under a real parse — see
   * {@link ShParseMaxDepthError}'s doc comment — only ever `> maxDepth`.
   */
  readonly estimatedDepth: number;

  constructor(maxDepth: number, estimatedDepth: number) {
    super(
      `parseSync: input's estimated structural nesting depth (${String(estimatedDepth)}+ frames) exceeds the maximum this bridge accepts (${String(maxDepth)}) — refusing to hand this input to the WASM parser, which would risk exhausting its call stack uncatchably. Treat this as a deny signal, not "input looks fine".`,
    );
    this.name = 'ShParseMaxDepthError';
    this.maxDepth = maxDepth;
    this.estimatedDepth = estimatedDepth;
  }
}

/**
 * Thrown by `sh-ast/analyze`'s `resolveArgv0` when a caller-supplied
 * `options.transparentWrappers` array contains a malformed `WrapperSpec`
 * entry — e.g. a non-array or empty `names`, or a flag field that isn't an
 * array of strings. Fails closed with a clear, specific message at the
 * point the malformed table is supplied, rather than letting the bad shape
 * reach flag-matching logic and surface as a confusing native `TypeError`
 * (or, worse, a silently wrong match) far from its actual cause.
 *
 * @public
 */
export class ShAnalyzeInvalidWrapperSpecError extends ShAstError {
  readonly code = 'SH_AST_ANALYZE_INVALID_WRAPPER_SPEC';

  constructor(message: string) {
    super(`resolveArgv0: invalid transparentWrappers entry — ${message}`);
    this.name = 'ShAnalyzeInvalidWrapperSpecError';
  }
}
