/** Shared failure classes for syntax binding invariants and explicit resource limits. */

/**
 * Common base for syntax package failures, including upstream syntax errors
 * and binding resource refusals. The stable code discriminator supports
 * programmatic handling without interpreting display messages. Only concrete
 * subclasses are thrown.
 * @public
 */
export abstract class ShAstError extends Error {
  /** Stable machine-readable identity of the concrete failure kind. */
  abstract readonly code: string;
}

/**
 * A failure at the syntax binding/runtime boundary: a malformed result envelope,
 * an unexpected root type, or inability to transport or validate represented
 * values within host runtime resources. A bridge resource refusal can involve
 * valid upstream syntax; it does not mean the Go parser rejected the input.
 * Distinct from {@link InputError} and {@link ParseError}, which describe caller
 * representation errors and ordinary upstream parsing failures respectively.
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
 * A whole-file parse operation exceeded the binding's native node-nesting budget.
 * The maintained parser counts statement, word, and expression work, including
 * iterative construction of deep operator trees. A refusal returns no partial
 * File or position snapshot and leaves subsequent parse calls available.
 *
 * This is a binding resource constraint, not an upstream grammar restriction.
 * The fixed 128-unit policy can refuse valid deeply nested input. Units describe
 * native node work, not actual Go/JavaScript frames or necessarily final AST
 * depth. The empirical margin assumes an ordinary caller stack; arbitrary
 * pre-existing JavaScript recursion can exhaust it. This does not establish
 * safety for arbitrary caller-constructed trees or other recursive operations.
 *
 * @public
 */
export class ShParseMaxDepthError extends ShAstError {
  readonly code = 'SH_AST_PARSE_MAX_DEPTH';
  /** Fixed maximum native node-nesting units; not caller-configurable. */
  readonly maxDepth: number;
  /**
   * Native node work at the rejected entry, greater than {@link ShParseMaxDepthError.maxDepth}.
   * Units describe native parser work, not a lexical estimate or a count of
   * runtime stack frames.
   */
  readonly estimatedDepth: number;

  constructor(maxDepth: number, estimatedDepth: number) {
    super(
      `parseSync: native parser node work (${String(estimatedDepth)} units) exceeds the maximum this bridge accepts (${String(maxDepth)}) — refusing this input without a partial result.`,
    );
    this.name = 'ShParseMaxDepthError';
    this.maxDepth = maxDepth;
    this.estimatedDepth = estimatedDepth;
  }
}
