/**
 * A faithful synchronous interface to mvdan/sh syntax. The root exposes upstream
 * records, constants, parser controls, traversal, printing and position operations. Consumer-specific
 * source views and semantic analysis are separate responsibilities.
 */
import {
  SYNTAX_INTERFACES as interfaces,
  SYNTAX_SCHEMA as schema,
} from '../generated/syntax-schema.js';
import { deepFreeze } from './deep-freeze.js';

export {
  InputError,
  LangError,
  ParseError,
  newPos,
  nodeEnd,
  nodePos,
  parseSync,
  parseWithPositionsSync,
  rawOperator,
} from './syntax.js';
export type { ParseOptions, ParsedFile, PositionSnapshot, NodePositions } from './syntax.js';
export { splitBraces } from './syntax-braces.js';
export { printSync } from './syntax-print.js';
export type { PrintOptions } from './syntax-print.js';
export { PrintError, PrintPanicError } from './syntax-print-errors.js';
export { walk, WalkPanicError } from './syntax-walk.js';
export type * from '../generated/syntax-types.js';
export * from '../generated/syntax-constants.js';
export type { SyntaxFieldSchema, SyntaxRecordSchema } from '../generated/syntax-schema.js';
export { ShAstError, ShInternalError, ShParseMaxDepthError } from './errors.js';

/**
 * Complete upstream field metadata for validating or adapting syntax records.
 * Metadata order is not the upstream Walk visitation order. Shared records are
 * deeply frozen even though the syntax values they describe are mutable.
 * @public
 */
export const SYNTAX_SCHEMA = deepFreeze(schema);

/**
 * Concrete alternatives for upstream syntax interfaces. Auxiliary records are
 * absent from Node; consumers must preserve that distinction in their adapters.
 * @public
 */
export const SYNTAX_INTERFACES = deepFreeze(interfaces);
