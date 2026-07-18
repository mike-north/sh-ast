import { deepFreeze } from './deep-freeze.js';
import { CHILD_TYPE_SCHEMA } from '../generated/child-type-schema.js';
import type { Position, ShNode } from './types.js';

/**
 * Frozen (including each per-type field record) so immutability of this
 * shared, module-scoped table is a contract, not just a convention any
 * importer happens to honor — mirrors {@link visitorKeys}'s freezing in
 * `visitor-keys.ts`.
 */
const FROZEN_CHILD_TYPE_SCHEMA: Readonly<Record<string, Readonly<Record<string, string | null>>>> =
  deepFreeze(CHILD_TYPE_SCHEMA);

/**
 * A JSON value as produced by `JSON.parse`.
 *
 * @internal
 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type JsonObject = Record<string, JsonValue>;

/**
 * A raw `Pos`/`End` value from mvdan/sh's typedjson tree: a byte offset plus
 * a 1-based line and (byte-counting) column.
 */
interface RawPos {
  Offset: number;
  Line: number;
  Col: number;
}

/**
 * Fields that hold positions or other named scalars, never child nodes.
 * mvdan/sh's typedjson tree surfaces several extra named positions
 * (`OpPos`, `ValuePos`, …) beyond the `Pos`/`End` pair every node carries;
 * see design/ARCHITECTURE.md open question 4 — they are dropped here rather
 * than exposed, matching the spike's behavior.
 */
const POS_KEYS: ReadonlySet<string> = new Set([
  'Pos',
  'End',
  'Position',
  'Semicolon',
  'OpPos',
  'ValuePos',
  'ValueEnd',
  'Hash',
  'Left',
  'Right',
  // NOTE: 'Do' is deliberately *not* here. mvdan/sh v3.13.1's `ForClause`
  // and `WhileClause` structs carry both `DoPos Pos` (a position — listed
  // below) and `Do []*Stmt` (the loop body statement list — a real child).
  // Denylisting the bare `Do` key here previously discarded that entire
  // statement list before the schema-driven child resolution in
  // `buildFields` ever saw it (see issue #2: normalizer drops
  // ForClause/WhileClause loop bodies).
  'DonePos',
  'Rparen',
  'Lparen',
  'Select',
  'InPos',
  'Dollar',
  'Esac',
  'Case',
  'Fi',
  'ThenPos',
  'FiPos',
  'WhilePos',
  'DoPos',
  'Until',
  'Unsigned',
  'TorF',
]);

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRawPos(value: JsonValue): value is JsonObject & RawPos {
  if (!isJsonObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    typeof value.Offset === 'number' &&
    typeof value.Line === 'number' &&
    typeof value.Col === 'number'
  );
}

function isRawNode(value: JsonValue): value is JsonObject {
  return isJsonObject(value) && isRawPos(value.Pos) && isRawPos(value.End);
}

/**
 * Builds a byte-offset -> UTF-16-index lookup for `text`. mvdan/sh reports
 * byte offsets; ESLint (and JavaScript strings generally) index by UTF-16
 * code unit, so every position needs this conversion. Throws if asked to
 * convert an offset that does not fall on a UTF-8 code-point boundary — an
 * invariant every offset the parser emits must satisfy (see
 * design/ARCHITECTURE.md's "Serialization contract").
 *
 * @internal
 */
export function makeByteToUtf16(text: string): (byteOffset: number) => number {
  const map = new Map<number, number>();
  let byte = 0;
  map.set(0, 0);
  for (let i = 0; i < text.length;) {
    const codePoint = text.codePointAt(i);
    // codePointAt(i) is always defined for i < text.length; this guards the
    // type only (strict null checks require it, not a reachable branch).
    if (codePoint === undefined) break;
    const units = codePoint > 0xffff ? 2 : 1;
    const bytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    byte += bytes;
    i += units;
    map.set(byte, i);
  }
  return (byteOffset: number): number => {
    const value = map.get(byteOffset);
    if (value === undefined) {
      throw new Error(`byte offset ${String(byteOffset)} is not a UTF-8 code point boundary`);
    }
    return value;
  };
}

interface LocInfo extends Position {
  index: number;
}

/**
 * The UTF-16 index of the start of each 1-based source line (`lineStarts[0]`
 * is line 1's start, always `0`).
 */
function computeLineStarts(text: string): number[] {
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  return lineStarts;
}

/**
 * Converts a byte offset and the 1-based line mvdan/sh already computed for
 * it into a 1-based, UTF-16-code-unit column — the same conversion
 * `normalize` applies to every node's `loc.start`/`loc.end` below, extracted
 * so a parse error's reported position (see `errors.ts`'s
 * `ShParseErrorInfo`) can use the identical algorithm instead of the raw
 * byte-counting column mvdan/sh itself reports. See design/ARCHITECTURE.md's
 * "Byte→UTF-16 conversion".
 *
 * @internal
 */
export function toUtf16Column(text: string, byteOffset: number, line: number): number {
  const index = makeByteToUtf16(text)(byteOffset);
  const lineStart = computeLineStarts(text)[line - 1] ?? 0;
  return index - lineStart + 1;
}

/**
 * Normalizes mvdan/sh's typedjson tree into the shape ESLint expects: every
 * node gets `type`, `range` (UTF-16), `loc` (1-based, UTF-16 columns), and
 * every other field copied over with its name lowercased. See
 * design/ARCHITECTURE.md's "Normalized node shape".
 *
 * Three of mvdan/sh's struct types — `Slice`, `Replace`, `Expansion`, all
 * reachable only via `ParamExp.Slice`/`.Repl`/`.Exp` — do not implement
 * `syntax.Node` (no `Pos()`/`End()`), so typedjson never gives them a `Pos`/
 * `End` pair, let alone a `Type` discriminator. They still hold real child
 * nodes (`Slice.Offset`/`.Length`, `Replace.Orig`/`.With`,
 * `Expansion.Word`), so dropping them would silently lose that subtree (see
 * issue #13 — `${USER:-nobody}`'s `nobody` literal). This function
 * synthesizes a `type`/`range`/`loc` for these from their own children's
 * already-computed positions instead, via `walkSynthetic` below.
 *
 * @internal
 */
export function normalize(root: JsonValue, text: string): ShNode {
  const toUtf16 = makeByteToUtf16(text);
  const lineStarts = computeLineStarts(text);

  const toLoc = (pos: RawPos): LocInfo => {
    const index = toUtf16(pos.Offset);
    const lineStart = lineStarts[pos.Line - 1] ?? 0;
    const column = index - lineStart + 1;
    return { line: pos.Line, column, index };
  };

  const startOf = (node: ShNode): LocInfo => ({
    index: node.range[0],
    line: node.loc.start.line,
    column: node.loc.start.column,
  });
  const endOf = (node: ShNode): LocInfo => ({
    index: node.range[1],
    line: node.loc.end.line,
    column: node.loc.end.column,
  });
  const earlier = (a: LocInfo, b: LocInfo): LocInfo => (a.index <= b.index ? a : b);
  const later = (a: LocInfo, b: LocInfo): LocInfo => (a.index >= b.index ? a : b);

  interface FieldsResult {
    fields: Record<string, unknown>;
    /** Every direct child `ShNode` this call produced, for a synthetic
     * caller (see `walkSynthetic`) to derive its own span from. */
    children: ShNode[];
  }

  /**
   * Builds `node`'s own lowercased field map, recursing into schema-declared
   * children (real or synthetic). `fallback` is the nearest enclosing *real*
   * node's start/end — used only if a synthetic child ends up with no
   * positioned children of its own to derive a span from (see
   * `walkSynthetic`).
   */
  function buildFields(
    node: JsonObject,
    type: string,
    fallback: { start: LocInfo; end: LocInfo },
  ): FieldsResult {
    const schema = FROZEN_CHILD_TYPE_SCHEMA[type] ?? {};
    const out: Record<string, unknown> = {};
    const children: ShNode[] = [];

    const resolve = (value: JsonValue, childType: string | null): JsonValue | ShNode => {
      if (isRawNode(value)) {
        const child = walkNode(value, childType);
        children.push(child);
        return child;
      }
      if (childType !== null && isJsonObject(value)) {
        const child = walkSynthetic(value, childType, fallback);
        children.push(child);
        return child;
      }
      return value;
    };

    for (const [key, value] of Object.entries(node)) {
      if (key === 'Type' || POS_KEYS.has(key)) continue;
      const outKey = key.toLowerCase();
      const childType = schema[key] ?? null;
      if (Array.isArray(value)) {
        out[outKey] = value.map((item) => resolve(item, childType));
      } else if (isRawNode(value) || (childType !== null && isJsonObject(value))) {
        out[outKey] = resolve(value, childType);
      } else if (!isRawPos(value)) {
        out[outKey] = value;
      }
    }
    return { fields: out, children };
  }

  function walkNode(node: JsonObject, staticType: string | null): ShNode {
    const rawType = node.Type;
    const type = typeof rawType === 'string' ? rawType : staticType;
    if (type === null) {
      throw new Error(`node without resolvable type: ${JSON.stringify(node).slice(0, 120)}`);
    }
    if (!isRawPos(node.Pos) || !isRawPos(node.End)) {
      throw new Error(`node of type ${type} is missing Pos/End`);
    }
    const start = toLoc(node.Pos);
    const end = toLoc(node.End);
    const { fields } = buildFields(node, type, { start, end });
    return {
      type,
      range: [start.index, end.index],
      loc: {
        start: { line: start.line, column: start.column },
        end: { line: end.line, column: end.column },
      },
      ...fields,
    };
  }

  /**
   * Normalizes a struct-typed field's value that has no `Pos`/`End` of its
   * own — one of mvdan/sh's three non-`Node` "auxiliary" structs (`Slice`,
   * `Replace`, `Expansion`). Its `range`/`loc` are synthesized from the
   * union of its own children's already-computed spans (the exact source
   * span its children cover — e.g. a `Replace`'s span is `Orig`'s start
   * through `With`'s end, which for `${var/foo/bar}` is exactly `foo/bar`).
   * Falls back to the nearest enclosing real node's span only when there
   * are no positioned children at all to derive one from — e.g.
   * `Expansion.Word` is nil (omitted from typedjson's output entirely, via
   * `omitempty`) for an empty default like `${a:-}`.
   */
  function walkSynthetic(
    node: JsonObject,
    type: string,
    fallback: { start: LocInfo; end: LocInfo },
  ): ShNode {
    const { fields, children } = buildFields(node, type, fallback);
    const start = children.length > 0 ? children.map(startOf).reduce(earlier) : fallback.start;
    const end = children.length > 0 ? children.map(endOf).reduce(later) : fallback.end;
    return {
      type,
      range: [start.index, end.index],
      loc: {
        start: { line: start.line, column: start.column },
        end: { line: end.line, column: end.column },
      },
      ...fields,
    };
  }

  if (!isRawNode(root)) {
    throw new Error('normalize: root value is not a node (missing Pos/End)');
  }
  return walkNode(root, 'File');
}
