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
 * no observation, including every node in a structuredClone of the syntax tree.
 * Clone File or a Node subtree, not this function-bearing lookup. Copied position
 * fields retain their values but do not transfer snapshot identity.
 * The index never calls WASM or recalculates edited node bounds.
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
/** Each sparse failure belongs to one occurrence and two independently observed bounds. */
type BoundErrors = readonly [GoString | null, GoString | null];

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
 * Visits child-bearing fields in the writer's lexical preorder, including children
 * of auxiliary records. The complete File boundary has already been validated.
 * Ordering is internal transport correlation, not the public Walk protocol.
 */
function visitNodes(file: File, observe: (node: Node) => void): void {
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

/**
 * Child-bearing (struct or interface) field names per record type, in schema
 * order. The generated schema is immutable, so each list is derived once rather
 * than re-filtering every field of every visited record.
 */
const CHILD_FIELDS = new Map<string, readonly string[]>();

/** Returns the cached child field names for a type known to be in the schema. */
function childFields(type: string): readonly string[] {
  let names = CHILD_FIELDS.get(type);
  if (names === undefined) {
    names = Object.entries(SYNTAX_SCHEMA[type].fields)
      .filter(([, field]) => field.kind === 'struct' || field.kind === 'interface')
      .map(([name]) => name);
    CHILD_FIELDS.set(type, names);
  }
  return names;
}

/** Own byte-bearing failures so neither transport holders nor catchers can alter captures. */
function copyError(error: GoString): GoString {
  return typeof error === 'string' ? error : error.slice();
}

/** Reconstruct a bound only after checking flags and the unchanged SyntaxPos contract. */
function readBound(raw: readonly unknown[], offset: number, failed: boolean): SyntaxPos {
  const Offset = raw[offset];
  const Line = raw[offset + 1];
  const Col = raw[offset + 2];
  const flags = raw[offset + 3];
  if (typeof flags !== 'number' || !Number.isInteger(flags) || flags < 0 || flags > 7) {
    throw new ShInternalError('The syntax snapshot contains invalid position flags');
  }
  const position = {
    Offset,
    Line,
    Col,
    IsValid: (flags & 1) !== 0,
    IsRecovered: (flags & 2) !== 0,
    OffsetOverflow: (flags & 4) !== 0,
  };
  if (
    !isSyntaxPos(position) ||
    (failed && (Offset !== 0 || Line !== 0 || Col !== 0 || flags !== 0))
  ) {
    throw new ShInternalError('The syntax snapshot contains an invalid position observation');
  }
  return position;
}

/**
 * Validates complete compact coverage and independent bound outcomes, then stores
 * immutable observations in a weak identity map. No fallback calls can disguise
 * malformed transport. The File must already pass the full boundary validator.
 * @internal
 */
export function createPositionSnapshot(
  file: File,
  raw: unknown,
  rawErrors: unknown,
): PositionSnapshot {
  if (!Array.isArray(raw) || raw.length % 8 !== 0 || !Array.isArray(rawErrors)) {
    throw new ShInternalError('The syntax snapshot has invalid compact metadata');
  }
  const count = raw.length / 8;
  const failures = new Map<number, BoundErrors>();
  for (const row of rawErrors) {
    if (!Array.isArray(row) || row.length !== 3) {
      throw new ShInternalError('The syntax snapshot contains an invalid failure row');
    }
    const values: readonly unknown[] = row;
    const [index, pos, end] = values;
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= count ||
      failures.has(index) ||
      !(pos === null || isGoString(pos)) ||
      !(end === null || isGoString(end)) ||
      (pos === null && end === null)
    ) {
      throw new ShInternalError('The syntax snapshot contains an invalid failure observation');
    }
    failures.set(index, [
      pos === null ? null : copyError(pos),
      end === null ? null : copyError(end),
    ]);
  }
  const observations = new WeakMap<Node, CapturedPositions>();
  let index = 0;
  visitNodes(file, (node) => {
    if (index >= count) throw new ShInternalError('The syntax snapshot omitted parsed nodes');
    const errors = failures.get(index);
    const posError = errors?.[0] ?? null;
    const endError = errors?.[1] ?? null;
    // Both bounds are validated even when get will replay the other bound's error.
    const Pos = readBound(raw, index * 8, posError !== null);
    const End = readBound(raw, index * 8 + 4, endError !== null);
    const error = posError ?? endError;
    observations.set(
      node,
      error !== null
        ? { error }
        : {
            positions: Object.freeze({ Pos: Object.freeze(Pos), End: Object.freeze(End) }),
          },
    );
    index++;
  });
  if (index !== count)
    throw new ShInternalError('The syntax snapshot contains excess observations');
  return Object.freeze({
    get(node: Node): NodePositions | undefined {
      const observation = observations.get(node);
      if (observation === undefined) return undefined;
      if ('error' in observation) throw new InputError(copyError(observation.error));
      return observation.positions;
    },
  });
}
