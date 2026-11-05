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
 * A whole-file parse operation refused its preliminary estimate of recursive
 * parser work before entering WASM. The estimate combines structural nesting
 * with selected recursive operator chains, including arithmetic. Catching this
 * refusal leaves the parser untouched and available for a subsequent input.
 *
 * This is a binding resource constraint, not an upstream grammar restriction.
 * The lexical heuristic can reject unusually large valid inputs and is not a
 * complete bound on parser or serializer recursion. Its empirical margin assumes
 * an ordinary caller stack; arbitrary pre-existing JS recursion can exhaust that
 * margin. Estimated units are not a count of actual native or JS stack frames.
 *
 * @public
 */
export class ShParseMaxDepthError extends ShAstError {
  readonly code = 'SH_AST_PARSE_MAX_DEPTH';
  /** Fixed maximum estimated parser-work units; not caller-configurable. */
  readonly maxDepth: number;
  /**
   * The conservatively estimated nesting depth that tripped the guard.
   * Not necessarily `text`'s "true" nesting depth under a real parse — see
   * {@link ShParseMaxDepthError}'s doc comment — only ever `> maxDepth`.
   */
  readonly estimatedDepth: number;

  constructor(maxDepth: number, estimatedDepth: number) {
    super(
      `parseSync: input's estimated recursive parser work (${String(estimatedDepth)}+ units) exceeds the maximum this bridge accepts (${String(maxDepth)}) — refusing this input before entering the WASM parser.`,
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
