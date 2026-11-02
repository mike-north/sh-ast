/**
 * Private fixture inspection for parser regressions. This structural enumeration
 * deliberately promises no upstream Walk ordering, pruning, or exit callbacks.
 * Assertions supply their own expected source and scalar values.
 */
import { nodeEnd, nodePos } from '../src/index.js';
import { isSyntaxNode } from '../src/syntax-wire.js';
import type { Node } from '../src/index.js';

/** Collects real upstream Nodes while looking through auxiliary records. @internal */
export function nodes(root: Node): Node[] {
  return nodeRelations(root).map(({ node }) => node);
}

/** Carries the closest real parent through auxiliary records for containment checks. @internal */
export function nodeRelations(root: Node): { node: Node; parent: Node | null }[] {
  const found: { node: Node; parent: Node | null }[] = [];
  const visit = (value: unknown, parent: Node | null): void => {
    if (value === null || typeof value !== 'object' || value instanceof Uint8Array) {
      return;
    }
    const node = isSyntaxNode(value) ? value : null;
    if (node) {
      found.push({ node, parent });
    }
    for (const child of Object.values(value)) {
      visit(child, node ?? parent);
    }
  };
  visit(root, null);
  return found;
}

/** Finds a required concrete node and narrows only after checking its discriminator. @internal */
export function firstNode<Type extends Node['Type']>(
  root: Node,
  type: Type,
): Extract<Node, { Type: Type }> {
  const found = nodes(root).find(
    (node): node is Extract<Node, { Type: Type }> => node.Type === type,
  );
  if (!found) {
    throw new Error(`Fixture has no ${type}`);
  }
  return found;
}

/** Reads original UTF-8 bytes at upstream-computed bounds; no UTF-16 adaptation. @internal */
export function sourceText(source: string, node: Node): string {
  return new TextDecoder().decode(
    new TextEncoder().encode(source).slice(nodePos(node).Offset, nodeEnd(node).Offset),
  );
}
