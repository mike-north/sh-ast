import type { ShellDialect } from './types.js';

/**
 * Common base class for every error this package throws — originally just
 * {@link parseSync}'s errors, now also the `sh-ast/analyze` layer's (see
 * {@link ShAnalyzeMaxDepthError}). Provides a stable, documented `code`
 * discriminator (e.g. `"ESLINT_SH_PARSE_ERROR"`) alongside the usual
 * `instanceof` narrowing, so consumers can branch on failure kind
 * programmatically without parsing `.message` strings. Never thrown
 * directly — only via its concrete subclasses ({@link ShParseError},
 * {@link ShInvalidDialectError}, {@link ShBridgeInternalError},
 * {@link ShAnalyzeMaxDepthError}).
 *
 * @public
 */
export abstract class ShBridgeError extends Error {
  /**
   * Stable, machine-readable discriminator for this error kind. Distinct
   * per subclass and will not change once published.
   */
  abstract readonly code: string;
}

/**
 * Position info attached to a {@link ShParseError}.
 *
 * @public
 */
export interface ShParseErrorInfo {
  /** 1-based line number, exactly as reported by mvdan/sh. */
  line: number;
  /**
   * 1-based column number, in **UTF-16 code units** — converted from
   * mvdan/sh's own byte-counting column so it agrees with
   * {@link ShNode.loc}'s columns (mvdan/sh reports `column` as a byte count
   * on the source line, not a UTF-16 code unit count; see
   * design/ARCHITECTURE.md's "Byte→UTF-16 conversion"). For ASCII-only
   * source text this is numerically identical to mvdan/sh's own column.
   */
  column: number;
  /** The filename used for the parse (see {@link ParseOptions.filename}). */
  filename: string;
}

/**
 * Thrown by {@link parseSync} when shell source fails to parse. Carries the
 * real position mvdan/sh reported — never 1:1 placeholders: `.line` is
 * 1-based exactly as mvdan/sh reports it, and `.column` is converted to
 * UTF-16 code units so it agrees with {@link ShNode.loc}'s columns (mvdan/sh
 * itself reports `column` as a byte count on the source line — see
 * {@link ShParseErrorInfo.column}). The unconverted, raw byte-column
 * position appears only inside `.message`, mvdan/sh's own formatted string,
 * verbatim.
 *
 * @public
 */
export class ShParseError extends ShBridgeError {
  readonly code = 'ESLINT_SH_PARSE_ERROR';
  readonly line: number;
  readonly column: number;
  readonly filename: string;

  constructor(message: string, info: ShParseErrorInfo) {
    super(message);
    this.name = 'ShParseError';
    this.line = info.line;
    this.column = info.column;
    this.filename = info.filename;
  }
}

/**
 * Thrown by {@link parseSync} when {@link ParseOptions.dialect} is not one
 * of the supported {@link ShellDialect} values. Carries the rejected value
 * as `.dialect`; `.message` lists the supported dialects. A foreseeable,
 * actionable user mistake — never an instance of {@link ShParseError}.
 *
 * @public
 */
export class ShInvalidDialectError extends ShBridgeError {
  readonly code = 'ESLINT_SH_INVALID_DIALECT';
  /** The rejected dialect value, exactly as passed to {@link parseSync}. */
  readonly dialect: string;

  constructor(dialect: string, supportedDialects: readonly ShellDialect[]) {
    super(
      `bridge: unrecognized shell dialect "${dialect}"; supported dialects are: ${supportedDialects.join(', ')}`,
    );
    this.name = 'ShInvalidDialectError';
    this.dialect = dialect;
  }
}

/**
 * Thrown by {@link parseSync} for failures that should never happen given a
 * correctly-behaving WASM shim: a malformed result envelope, an unexpected
 * root node type, or any other shim contract violation. Distinct from
 * {@link ShInvalidDialectError} and {@link ShParseError}, both of which
 * indicate a foreseeable, actionable user mistake rather than an internal
 * defect.
 *
 * @public
 */
export class ShBridgeInternalError extends ShBridgeError {
  readonly code = 'ESLINT_SH_BRIDGE_INTERNAL';

  constructor(message: string) {
    super(message);
    this.name = 'ShBridgeInternalError';
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
export class ShAnalyzeMaxDepthError extends ShBridgeError {
  readonly code = 'ESLINT_SH_ANALYZE_MAX_DEPTH';
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
