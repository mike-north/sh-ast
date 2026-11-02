/** Shared guards retain faithful node identity and omit only explicitly nil slice elements. */
import { SYNTAX_SCHEMA } from '../../generated/syntax-schema.js';
import type { Node } from '../../generated/syntax-types.js';

/**
 * Recognizes concrete upstream syntax.Node records without confusing auxiliary
 * records, typed nil interface tags, or token positions with records that have
 * traversable fields. It does not validate complete trees.
 * @internal
 */
export function isSyntaxNode(value: unknown): value is Exclude<Node, { Type: 'TypedNil' }> {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('Type' in value) ||
    typeof value.Type !== 'string'
  ) {
    return false;
  }
  return Object.hasOwn(SYNTAX_SCHEMA, value.Type) && SYNTAX_SCHEMA[value.Type].node;
}

/**
 * Retains slice order and object identity while exposing present records to
 * semantic traversal; nil slices and nil pointers contain no subtree to visit.
 * @internal
 */
export function nodeArray<T>(value: readonly (T | null)[] | null): T[] {
  return value?.filter((node): node is T => node !== null) ?? [];
}
