/**
 * Printing has two upstream failure modes: returned errors and panics raised by
 * the operation. Both retain exact message bytes; neither is a parser failure
 * or a claim that the transport itself malfunctioned.
 */
import type { GoString } from '../generated/syntax-types.js';
import { ShAstError } from './errors.js';

/**
 * An error returned by upstream Printer.Print, such as an unsupported root or
 * incompatible formatting options. No partial writer output is exposed.
 * @public
 */
export class PrintError extends ShAstError {
  /** Stable identity for an ordinary error returned by upstream Print. @public */
  readonly code = 'SH_AST_SYNTAX_PRINT';

  /** Exact upstream error bytes; Error.message is only a display rendering. @public */
  readonly Message: GoString;

  /** Retains the upstream error without interpreting its human-readable text. @public */
  constructor(message: GoString) {
    super(typeof message === 'string' ? message : new TextDecoder().decode(message));
    this.Message = message;
    this.name = 'PrintError';
  }
}

/**
 * Upstream Printer.Print panicked for a representable tree or option value.
 * Partial and typed-nil trees can trigger this independently of root support.
 * Catching the panic preserves reuse of the binding's shared runtime.
 * @public
 */
export class PrintPanicError extends ShAstError {
  /** Stable identity for an upstream panic caught at the Print operation. @public */
  readonly code = 'SH_AST_SYNTAX_PRINT_PANIC';

  /** Exact panic rendering from Go; Error.message is only a display rendering. @public */
  readonly Message: GoString;

  /** Retains the panic message separately from ordinary returned Print errors. @public */
  constructor(message: GoString) {
    super(typeof message === 'string' ? message : new TextDecoder().decode(message));
    this.Message = message;
    this.name = 'PrintPanicError';
  }
}
