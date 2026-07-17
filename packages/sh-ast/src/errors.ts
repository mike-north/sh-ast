import type { ShellDialect } from './types.js';

/**
 * Common base class for every error {@link parseSync} can throw. Provides a
 * stable, documented `code` discriminator (e.g. `"ESLINT_SH_PARSE_ERROR"`)
 * alongside the usual `instanceof` narrowing, so consumers can branch on
 * failure kind programmatically without parsing `.message` strings. Never
 * thrown directly — only via its concrete subclasses ({@link ShParseError},
 * {@link ShInvalidDialectError}, {@link ShBridgeInternalError}).
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
