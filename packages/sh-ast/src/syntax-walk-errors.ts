/** Walk-specific panic adaptation keeps upstream failures distinct from caller exceptions. */
import type { GoString } from '../generated/syntax-types.js';
import { ShAstError } from './errors.js';

/**
 * A panic raised by upstream-equivalent traversal, such as a nil dereference or
 * unsupported concrete node. Exceptions thrown by callbacks are never wrapped.
 * @public
 */
export class WalkPanicError extends ShAstError {
  /** Stable discriminator for traversal panics. @public */
  readonly code = 'SH_AST_WALK_PANIC';

  /** Exact upstream panic bytes; Error.message is only a display rendering. @public */
  readonly Message: GoString;

  /** Retains the upstream panic text separately from its display rendering. @public */
  constructor(message: GoString) {
    super(typeof message === 'string' ? message : new TextDecoder().decode(message));
    this.Message = message;
    this.name = 'WalkPanicError';
  }
}

/** A concrete pointer dereference failed at the point upstream would access it. @internal */
export function nilDereference(): never {
  throw new WalkPanicError('runtime error: invalid memory address or nil pointer dereference');
}
