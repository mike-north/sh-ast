/**
 * TEST-ONLY REFERENCE: the original recursive snapshot node visitor, kept verbatim for
 * differential tests against the iterative implementation. Never exported from the package.
 */
import { SYNTAX_INTERFACES, SYNTAX_SCHEMA } from '../../generated/syntax-schema.js';
import type { File, Node } from '../../generated/syntax-types.js';
import { isRecord } from './recursive-syntax-wire.js';

/** Node identity within an already validated File, as the production visitor decides it. */
function isNodeIdentity(value: Record<string, unknown>): value is Record<string, unknown> & Node {
  return (
    (typeof value.Type === 'string' && SYNTAX_INTERFACES.Node.includes(value.Type)) ||
    (value.Type === 'TypedNil' &&
      typeof value.Kind === 'string' &&
      SYNTAX_INTERFACES.Node.includes(value.Kind))
  );
}

/** Child-bearing (struct or interface) field names per record type, in schema order. */
function childFields(type: string): string[] {
  return Object.entries(SYNTAX_SCHEMA[type].fields)
    .filter(([, field]) => field.kind === 'struct' || field.kind === 'interface')
    .map(([name]) => name);
}

/**
 * The original lexical-preorder visit, one native frame per tree level.
 * @internal
 */
export function visitNodes(file: File, observe: (node: Node) => void): void {
  const visit = (value: unknown): void => {
    if (!isRecord(value) || typeof value.Type !== 'string') return;
    if (isNodeIdentity(value)) observe(value);
    if (!Object.hasOwn(SYNTAX_SCHEMA, value.Type)) return;
    for (const name of childFields(value.Type)) {
      const child = value[name];
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(file);
}
