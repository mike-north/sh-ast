import type { ShNode } from './types.js';

function isShNode(value: unknown): value is ShNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string' &&
    Array.isArray((value as { range?: unknown }).range)
  );
}

function walkNode(
  node: ShNode,
  parent: ShNode | null,
  visit: (node: ShNode, parent: ShNode | null) => void,
): void {
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (isShNode(value)) {
      walkNode(value, node, visit);
    } else if (Array.isArray(value)) {
      for (const item of value as unknown[]) {
        if (isShNode(item)) walkNode(item, node, visit);
      }
    }
  }
}

/**
 * Visits every node in a normalized tree, pre-order (parent before
 * children), starting at `node`.
 *
 * Children are discovered structurally: any field on a visited node whose
 * value is itself a normalized node (or an array of normalized nodes) is
 * treated as a child. This is deliberately not driven off {@link
 * visitorKeys} — the spike's hand-written visitor-keys table missed
 * `DeclClause.Variant` (see design/ARCHITECTURE.md) and silently
 * under-walked the tree, and `visitorKeys` remains hand-maintained pending a
 * schema generator (tracked separately). Walking structurally means this
 * function's completeness never depends on that table's accuracy.
 *
 * @public
 */
export function walk(node: ShNode, visit: (node: ShNode, parent: ShNode | null) => void): void {
  walkNode(node, null, visit);
}
