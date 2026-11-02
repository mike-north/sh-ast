/**
 * Correlates parse-time upstream position observations with the decoded syntax
 * records. Snapshots belong to one parse and never track later edits; live
 * nodePos/nodeEnd remain a separate responsibility. No traversal order or
 * visitor-control protocol is exposed by this lookup-only view.
 */
import { SYNTAX_INTERFACES, SYNTAX_SCHEMA } from '../generated/syntax-schema.js';
import type { File, GoString, Node, SyntaxPos } from '../generated/syntax-types.js';
import { ShInternalError } from './errors.js';
import { InputError } from './syntax-errors.js';
import { isGoString, isRecord, isSyntaxPos } from './syntax-wire.js';

/**
 * A node's upstream bounds as observed during parsing. These values refer to the
 * original source, even when the corresponding syntax record is later edited.
 * @public
 */
export interface NodePositions {
  /** Starting byte position observed for the original parsed node. */
  readonly Pos: Readonly<SyntaxPos>;
  /** Exclusive ending byte position observed for the original parsed node. */
  readonly End: Readonly<SyntaxPos>;
}

/**
 * Identity-based lookup of the original parse's bounds. A new or copied node has
 * no observation. The index never calls WASM or recalculates edited node bounds.
 * @public
 */
export interface PositionSnapshot {
  /**
   * Returns the captured pair for a node from this parse, or undefined for a
   * foreign node. If either upstream observation failed, throws the captured
   * InputError without changing the successfully parsed File. Use nodePos or
   * nodeEnd to request a live, independent bound from current edited fields.
   */
  get(node: Node): NodePositions | undefined;
}

/**
 * Mutable upstream syntax together with a separate source-bound position view.
 * Editing File never updates Positions; source consumers can retain original
 * spans while transformations query live nodePos/nodeEnd as needed.
 * @public
 */
export interface ParsedFile {
  /** The complete mutable upstream File; no bounds or consumer fields are added. */
  readonly File: File;
  /** Immutable original observations, keyed by this File's node identities. */
  readonly Positions: PositionSnapshot;
}

/** A captured failure is private so callers cannot mutate later error observations. */
type CapturedPositions = { positions: NodePositions } | { error: GoString };
/** Field names and slice indices locate one occurrence in the serialized tree. */
type SyntaxPath = readonly (string | number)[];

/**
 * Checks only node identity within an already fully validated File. Revalidating
 * each subtree here would reintroduce work proportional to all descendant sizes.
 */
function isNodeIdentity(value: Record<string, unknown>): value is Record<string, unknown> & Node {
  return (
    (typeof value.Type === 'string' && SYNTAX_INTERFACES.Node.includes(value.Type)) ||
    (value.Type === 'TypedNil' &&
      typeof value.Kind === 'string' &&
      SYNTAX_INTERFACES.Node.includes(value.Kind))
  );
}

/**
 * Indexes child-bearing fields once, including paths through auxiliary records.
 * Metadata order is irrelevant: paths correlate observations without inventing a
 * Walk order or equating auxiliary records with syntax.Node values.
 */
function nodesByPath(file: File): Map<string, Node> {
  const nodes = new Map<string, Node>();
  const visit = (value: unknown, path: SyntaxPath): void => {
    if (!isRecord(value) || typeof value.Type !== 'string') return;
    if (isNodeIdentity(value)) nodes.set(JSON.stringify(path), value);
    if (!Object.hasOwn(SYNTAX_SCHEMA, value.Type)) return;
    for (const [name, field] of Object.entries(SYNTAX_SCHEMA[value.Type].fields)) {
      if (field.kind !== 'struct' && field.kind !== 'interface') continue;
      const child = value[name];
      if (Array.isArray(child)) {
        child.forEach((item: unknown, index: number) => {
          visit(item, [...path, name, index]);
        });
      } else {
        visit(child, [...path, name]);
      }
    }
  };
  visit(file, []);
  return nodes;
}

/** Accepts the exact field/index domain used by the upstream observation sidecar. */
function isPath(value: unknown): value is SyntaxPath {
  return (
    Array.isArray(value) &&
    value.every(
      (component: unknown) =>
        typeof component === 'string' ||
        (typeof component === 'number' && Number.isSafeInteger(component) && component >= 0),
    )
  );
}

/** An upstream method produced exactly one position or one preserved failure. */
function isObservation(position: unknown, error: unknown): boolean {
  return (isSyntaxPos(position) && error === null) || (position === null && isGoString(error));
}

/**
 * Validates complete sidecar coverage once, then stores immutable observations in
 * a weak identity map. Missing or duplicate metadata is a transport defect; no
 * per-node live-position fallback may disguise it or multiply WASM transfers.
 * The File must already have passed the full syntax boundary validator.
 * @internal
 */
export function createPositionSnapshot(file: File, raw: unknown): PositionSnapshot {
  const nodes = nodesByPath(file);
  if (!Array.isArray(raw) || raw.length !== nodes.size)
    throw new ShInternalError('The syntax snapshot does not cover every parsed node');
  const observations = new WeakMap<Node, CapturedPositions>();
  const remaining = new Map(nodes);
  for (const entry of raw) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).length !== 5 ||
      !isPath(entry.Path) ||
      !isObservation(entry.Pos, entry.PosError) ||
      !isObservation(entry.End, entry.EndError)
    ) {
      throw new ShInternalError('The syntax snapshot contains an invalid position observation');
    }
    const path = JSON.stringify(entry.Path);
    const node = remaining.get(path);
    if (node === undefined)
      throw new ShInternalError('The syntax snapshot contains an unknown or duplicate node path');
    remaining.delete(path);
    if (isGoString(entry.PosError)) {
      observations.set(node, { error: entry.PosError });
    } else if (isGoString(entry.EndError)) {
      observations.set(node, { error: entry.EndError });
    } else if (isSyntaxPos(entry.Pos) && isSyntaxPos(entry.End)) {
      observations.set(node, {
        positions: Object.freeze({
          Pos: Object.freeze({ ...entry.Pos }),
          End: Object.freeze({ ...entry.End }),
        }),
      });
    } else {
      throw new ShInternalError('The syntax snapshot dropped an upstream method outcome');
    }
  }
  if (remaining.size !== 0)
    throw new ShInternalError('The syntax snapshot omitted parsed node observations');
  return Object.freeze({
    get(node: Node): NodePositions | undefined {
      const observation = observations.get(node);
      if (observation === undefined) return undefined;
      if ('error' in observation) {
        // An exception may be edited by its catcher; retain the captured bytes.
        throw new InputError(
          typeof observation.error === 'string' ? observation.error : observation.error.slice(),
        );
      }
      return observation.positions;
    },
  });
}
