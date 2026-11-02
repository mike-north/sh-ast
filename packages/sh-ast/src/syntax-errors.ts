/**
 * Error adaptation for the upstream syntax interface. Exceptions retain the Go
 * error's structured information and partial result; JavaScript's display message
 * is never the only copy of a byte-bearing upstream value.
 */
import type { File, GoString, SyntaxPos } from '../generated/syntax-types.js';
import { ShAstError } from './errors.js';

/**
 * A source grammar error reported by mvdan/sh, with the partial parsed file.
 * @public
 */
export class ParseError extends ShAstError {
  /** Identifies a source grammar failure independently of its display text. */
  readonly code = 'SH_AST_SYNTAX_PARSE';

  /**
   * Keeps the original Go fields. Message is the formatted upstream error;
   * Text is its unformatted diagnostic, and File is the result returned with it.
   */
  constructor(
    readonly Message: GoString,
    readonly Filename: GoString,
    readonly Pos: SyntaxPos,
    readonly Text: GoString,
    readonly Incomplete: boolean,
    readonly File: File | null,
  ) {
    super(displayMessage(Message));
    this.name = 'ParseError';
  }
}

/**
 * A syntax feature rejected for the selected upstream language variant.
 * @public
 */
export class LangError extends ShAstError {
  /** Identifies a dialect-specific syntax failure. */
  readonly code = 'SH_AST_SYNTAX_LANG';

  /** Preserves the feature, permitted variants, actual variant and partial tree. */
  constructor(
    readonly Message: GoString,
    readonly Filename: GoString,
    readonly Pos: SyntaxPos,
    readonly Feature: GoString,
    readonly Langs: readonly number[],
    readonly LangUsed: number,
    readonly File: File | null,
  ) {
    super(displayMessage(Message));
    this.name = 'LangError';
  }
}

/**
 * An argument cannot be represented by the binding or violates an upstream
 * operation's input constraint. It is distinct from malformed shell source.
 * @public
 */
export class InputError extends ShAstError {
  /** Identifies caller input that cannot be passed faithfully to the operation. */
  readonly code = 'SH_AST_SYNTAX_INPUT';

  /** Retains exact upstream message bytes even when Error.message needs text. */
  constructor(readonly Message: GoString) {
    super(displayMessage(Message));
    this.name = 'InputError';
  }
}

/**
 * Error.message is a human-readable rendering only. The public Message property
 * retains original bytes when the Go value is not valid UTF-8.
 */
function displayMessage(value: GoString): string {
  return typeof value === 'string' ? value : new TextDecoder().decode(value);
}
