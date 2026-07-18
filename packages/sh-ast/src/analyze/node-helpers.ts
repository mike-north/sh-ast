import type { ShNode } from '../types.js';

/**
 * True iff `value` has the minimal shape every normalized {@link ShNode}
 * carries (an object, not an array, with a string `type` field). Used to
 * narrow `unknown` field values discovered while walking a node's own
 * properties — every node field on {@link ShNode} is typed `unknown` (see
 * its index signature), so any code that inspects a specific field's value
 * needs this runtime check before treating it as a child node.
 *
 * @internal
 */
export function isShNodeShape(value: unknown): value is ShNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/**
 * Filters `value` down to the {@link ShNode} elements of an array-shaped
 * field, discarding anything else — and returning `[]` for a non-array or
 * `undefined` field, so callers never need a separate `Array.isArray` guard.
 *
 * @internal
 */
export function nodeArray(value: unknown): readonly ShNode[] {
  return Array.isArray(value) ? value.filter(isShNodeShape) : [];
}

/**
 * Reads `node[field]` as a string, defaulting to `''` for any other shape
 * (missing field, non-string value).
 *
 * @internal
 */
export function stringField(node: ShNode, field: string): string {
  const value = node[field];
  return typeof value === 'string' ? value : '';
}
