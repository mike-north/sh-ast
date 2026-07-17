export { parseSync } from './parse.js';
export {
  ShBridgeError,
  ShBridgeInternalError,
  ShInvalidDialectError,
  ShParseError,
} from './errors.js';
export type { ShParseErrorInfo } from './errors.js';
export type { ParseOptions, Position, ShellDialect, ShFile, ShNode } from './types.js';
export { visitorKeys } from './visitor-keys.js';
export { walk } from './walk.js';

/**
 * Strongly-typed `ShNode` subtypes for every mvdan/sh node type — generated
 * by `tools/gen-visitor-keys` alongside {@link visitorKeys} (see
 * design/ARCHITECTURE.md, "The schema table is generated, not
 * hand-written"). {@link ShNode}'s index signature remains the base
 * contract; these are an additive, opt-in stronger typing for consumers
 * that want e.g. `ShNodes.ShCallExprNode` instead of a generic `ShNode`.
 *
 * @public
 */
export type * as ShNodes from '../generated/node-types.js';
