/** Test constructors supply complete upstream zero values; expected analysis outcomes stay explicit. */
import { SYNTAX_SCHEMA } from '../generated/syntax-schema.js';
import type { Node, SyntaxPos } from '../generated/syntax-types.js';

/** A position with no source identity, matching upstream's ordinary zero Pos. @internal */
const zeroPos: SyntaxPos = {
  Offset: 0,
  Line: 0,
  Col: 0,
  IsValid: false,
  IsRecovered: false,
  OffsetOverflow: false,
};

/**
 * Builds complete records for pathological trees that should not pass through
 * the parser. Schema defaults only fill uninteresting fields; every field that
 * determines a test outcome is provided explicitly at the call site.
 * @internal
 */
export function syntheticNode<T extends Exclude<Node['Type'], 'TypedNil'>>(
  Type: T,
  fields: Partial<Extract<Node, { Type: T }>> = {},
): Extract<Node, { Type: T }> {
  const values: Record<string, unknown> = { Type };
  for (const [key, field] of Object.entries(SYNTAX_SCHEMA[Type].fields)) {
    values[key] =
      field.nullable || field.slice
        ? null
        : field.kind === 'position'
          ? { ...zeroPos }
          : field.kind === 'boolean'
            ? false
            : field.kind === 'string'
              ? ''
              : field.kind === 'operator'
                ? 0
                : null;
  }
  // The generated schema describes this discriminator's complete data contract.
  return { ...values, ...fields } as unknown as Extract<Node, { Type: T }>;
}
