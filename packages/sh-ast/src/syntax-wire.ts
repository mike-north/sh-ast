/**
 * Lossless JSON adaptation at the JS/Go boundary. Go strings are byte sequences;
 * integer arguments may span 64 bits. Tagged encodings preserve those domains
 * without changing the public syntax records into a second tree model.
 */
import { InputError } from './syntax-errors.js';
import { ShInternalError } from './errors.js';
import { operatorMaximum } from './syntax-operator.js';
import {
  SYNTAX_INTERFACES,
  SYNTAX_SCHEMA,
  type SyntaxFieldSchema,
} from '../generated/syntax-schema.js';
import type { File, GoString, Node, SyntaxPos } from '../generated/syntax-types.js';

/** Values after JSON parsing have no inherited application behavior. @internal */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rejects unpaired UTF-16 surrogates before TextEncoder can replace them. Callers
 * with source bytes use Uint8Array and receive the upstream byte-input behavior.
 * @internal
 */
export function assertUnicodeString(value: string): void {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point !== undefined && point >= 0xd800 && point <= 0xdfff) {
      throw new InputError(
        'A string contains an unpaired UTF-16 surrogate; supply exact bytes instead',
      );
    }
  }
}

/**
 * One open container while encodeWire serializes: the source array or record, the
 * output text accumulated for its members, and how far its members have been read.
 */
interface EncodeFrame {
  readonly source: object;
  /** Present for records: the own enumerable entries captured when the record was entered. */
  readonly entries: readonly (readonly [string, unknown])[] | null;
  /** Array length captured on entry; entries.length for records. */
  readonly length: number;
  index: number;
  text: string;
}

/**
 * Encodes bytes and exact integers without relying on JSON's number precision or
 * Uint8Array property enumeration. Circular input is a caller error, not a stack
 * overflow or a partially transferred request.
 *
 * The output is the JSON text of the converted value, written directly so that
 * neither this walk nor JSON.stringify recurses once per tree level: containers
 * are kept on an explicit stack, records emit their members in own-entry order,
 * and array holes are written as null like JSON.stringify.
 * @internal
 */
export function encodeWire(value: unknown): string {
  const ancestors = new Set<object>();
  const stack: EncodeFrame[] = [];
  /** Returns the JSON text of a scalar, or undefined after opening a container frame. */
  const begin = (item: unknown): string | undefined => {
    if (typeof item === 'string') {
      assertUnicodeString(item);
      return JSON.stringify(item);
    }
    if (typeof item === 'bigint') return `{"Int":${JSON.stringify(item.toString())}}`;
    if (item instanceof Uint8Array)
      return `{"Bytes":${JSON.stringify(Buffer.from(item).toString('base64'))}}`;
    if (item === null) return 'null';
    if (typeof item === 'boolean') return item ? 'true' : 'false';
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item))
        throw new InputError(
          'Numeric values must be safe integers; use bigint for 64-bit arguments',
        );
      return JSON.stringify(item);
    }
    if (typeof item !== 'object')
      throw new InputError(
        'Syntax wire values must be data records, arrays, bytes, or scalar values',
      );
    if (ancestors.has(item)) throw new InputError('Syntax records cannot contain cycles');
    ancestors.add(item);
    if (Array.isArray(item)) {
      stack.push({
        source: item,
        entries: null,
        length: item.length,
        index: 0,
        text: '[',
      });
      return undefined;
    }
    if (!isRecord(item)) throw new InputError('Expected a syntax data record');
    const entries = Object.entries(item);
    stack.push({
      source: item,
      entries,
      length: entries.length,
      index: 0,
      text: '{',
    });
    return undefined;
  };
  const root = begin(value);
  if (root !== undefined) return root;
  let result = '';
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index === frame.length) {
      stack.pop();
      ancestors.delete(frame.source);
      const text = frame.text + (frame.entries === null ? ']' : '}');
      if (stack.length === 0) {
        result = text;
        break;
      }
      stack[stack.length - 1].text += text;
      continue;
    }
    const slot = frame.index++;
    const separator = slot === 0 ? '' : ',';
    if (frame.entries === null) {
      // Array.prototype.map skips holes; JSON.stringify then writes them as null.
      const items = frame.source as unknown[];
      frame.text += separator + (slot in items ? (begin(items[slot]) ?? '') : 'null');
    } else {
      const [key, child] = frame.entries[slot];
      frame.text += separator + JSON.stringify(key) + ':' + (begin(child) ?? '');
    }
  }
  return result;
}

/**
 * Restores byte-bearing Go values. Ordinary syntax fields retain their spelling,
 * nulls, defaults, and ordering; no source location or synthetic node is added.
 * JSON.parse owns a fresh graph, so restoration replaces byte tags in that graph
 * without copying its ordinary records and arrays or touching caller-owned data.
 * @internal
 */
export function decodeWire(text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new ShInternalError(`Invalid syntax bridge JSON: ${String(cause)}`);
  }
  if (!mayContainBytesTag(text)) return parsed;
  // Containers are processed on an explicit stack so a very deep response is restored
  // without one native frame per level. Children are visited in document order.
  const stack: RestoreFrame[] = [];
  const begin = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      stack.push({ container: item, keys: null, index: 0 });
      return item;
    }
    if (!isRecord(item)) return item;
    const keys = Object.keys(item);
    if (keys.length === 1 && typeof item.Bytes === 'string') {
      const bytes = Buffer.from(item.Bytes, 'base64');
      if (bytes.toString('base64') !== item.Bytes)
        throw new ShInternalError('Invalid base64 in syntax bridge response');
      return new Uint8Array(bytes);
    }
    stack.push({ container: item, keys, index: 0 });
    return item;
  };
  const root = begin(parsed);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.keys === null) {
      const items = frame.container as unknown[];
      if (frame.index >= items.length) {
        stack.pop();
        continue;
      }
      const index = frame.index++;
      const child: unknown = items[index];
      const restored = begin(child);
      if (restored !== child) items[index] = restored;
    } else {
      if (frame.index >= frame.keys.length) {
        stack.pop();
        continue;
      }
      const record = frame.container as Record<string, unknown>;
      const key = frame.keys[frame.index++];
      const child = record[key];
      const restored = begin(child);
      if (restored !== child) {
        // JSON keys, including __proto__, remain own data properties. Defining a
        // replacement cannot invoke a prototype setter or change the record shape.
        Object.defineProperty(record, key, {
          value: restored,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
  }
  return root;
}

/** One container whose members decodeWire is restoring, and how far it has got. */
interface RestoreFrame {
  readonly container: object;
  /** Own keys captured on entry for records; null for arrays. */
  readonly keys: readonly string[] | null;
  index: number;
}

/**
 * Reports whether bridge JSON can contain a Bytes member. The Go producer spells
 * every ASCII key literally (encoding/json escapes only quotes, backslashes,
 * controls, HTML metacharacters and line separators), so a Bytes key always
 * appears as the exact characters `"Bytes"`. Their absence therefore proves no
 * record needs byte restoration. Their presence, including an ordinary string
 * value spelled Bytes, only selects the complete restoration walk.
 */
function mayContainBytesTag(text: string): boolean {
  return text.includes('"Bytes"');
}

/** Decodes one compact position tuple, or returns undefined when it is malformed. */
function positionFromTuple(tuple: unknown[]): SyntaxPos | undefined {
  if (tuple.length !== 4) return undefined;
  const [Offset, Line, Col, flags] = tuple;
  if (
    typeof Offset !== 'number' ||
    typeof Line !== 'number' ||
    typeof Col !== 'number' ||
    typeof flags !== 'number' ||
    !Number.isInteger(flags) ||
    flags < 0 ||
    flags > 7
  )
    return undefined;
  return {
    Offset,
    Line,
    Col,
    IsValid: (flags & 1) !== 0,
    IsRecovered: (flags & 2) !== 0,
    OffsetOverflow: (flags & 4) !== 0,
  };
}

/** A Go string is text only when every original byte is valid UTF-8. @internal */
export function isGoString(value: unknown): value is GoString {
  return typeof value === 'string' || value instanceof Uint8Array;
}

/** Checks the observable uint32-backed position shape without inventing bounds. @internal */
export function isSyntaxPos(value: unknown): value is SyntaxPos {
  if (!isRecord(value)) return false;
  const uint = (item: unknown, maximum: number): boolean =>
    typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= maximum;
  const shape =
    Object.keys(value).length === 6 &&
    uint(value.Offset, 0xffff_ffff - 11) &&
    uint(value.Line, 0x3_ffff) &&
    uint(value.Col, 0x3fff) &&
    typeof value.IsValid === 'boolean' &&
    typeof value.IsRecovered === 'boolean' &&
    typeof value.OffsetOverflow === 'boolean';
  if (!shape) return false;
  if (value.IsRecovered) {
    return (
      value.OffsetOverflow === true &&
      value.IsValid === false &&
      value.Offset === 0 &&
      value.Line === 0 &&
      value.Col === 0
    );
  }
  if (value.OffsetOverflow) return value.IsValid === false && value.Offset === 0;
  return value.IsValid === (value.Line !== 0 || value.Col !== 0);
}

/**
 * A Go interface can hold a nil pointer with a concrete dynamic type. Its tag
 * preserves that type without inventing fields for a nonexistent record.
 */
function isTypedNil(value: unknown, implementers: readonly string[]): boolean {
  return (
    isRecord(value) &&
    value.Type === 'TypedNil' &&
    typeof value.Kind === 'string' &&
    Object.keys(value).length === 2 &&
    implementers.includes(value.Kind)
  );
}

/**
 * Validation state for one boundary check. Caller-supplied records track active
 * ancestors to reject cycles. A parse response's File is a fresh JSON.parse tree,
 * which cannot contain cycles or shared records, so restoring validation tracks
 * none and instead rebuilds compact position tuples (see restoreSyntaxFile).
 */
interface Validation {
  readonly active: Set<object> | null;
  readonly restore: boolean;
}

/**
 * Field descriptors in schema order for each record type. The generated schema
 * is immutable, so listing its entries once per type avoids rebuilding the same
 * arrays for every record a large File contains.
 */
const FIELD_ENTRIES = new Map<string, readonly (readonly [string, SyntaxFieldSchema])[]>();

/** Returns the cached field list for a type already known to be in the schema. */
function fieldEntries(type: string): readonly (readonly [string, SyntaxFieldSchema])[] {
  let entries = FIELD_ENTRIES.get(type);
  if (entries === undefined) {
    entries = Object.entries(SYNTAX_SCHEMA[type].fields);
    FIELD_ENTRIES.set(type, entries);
  }
  return entries;
}

/** One record being validated: which field is current and, inside a slice, which element. */
interface ValidationFrame {
  readonly value: Record<string, unknown>;
  readonly fields: readonly (readonly [string, SyntaxFieldSchema])[];
  /** Index of the current field. */
  field: number;
  /** The slice being read for the current field, or null between fields. */
  items: readonly unknown[] | null;
  /** Index of the next element of items. */
  item: number;
}

/**
 * Applies the entry checks for one record and, when it passes, opens a frame for its
 * fields. Returns false when the record is not valid; nothing is opened then.
 */
function openRecord(value: unknown, check: Validation, stack: ValidationFrame[]): boolean {
  if (!isRecord(value) || typeof value.Type !== 'string' || check.active?.has(value)) return false;
  if (!Object.hasOwn(SYNTAX_SCHEMA, value.Type)) return false;
  const fields = fieldEntries(value.Type);
  if (Object.keys(value).length !== fields.length + 1) return false;
  check.active?.add(value);
  stack.push({ value, fields, field: 0, items: null, item: 0 });
  return true;
}

/**
 * Checks one non-null upstream value against its field descriptor. Returns false when
 * it is invalid, true when it is valid and needs no further work, and the record to
 * descend into when its validity depends on that record's own fields.
 */
function checkScalar(value: unknown, field: SyntaxFieldSchema): boolean | Record<string, unknown> {
  switch (field.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return isGoString(value);
    case 'position':
      return isSyntaxPos(value);
    case 'operator':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= operatorMaximum(field.type)
      );
    case 'struct':
      return isRecord(value) && value.Type === field.type ? value : false;
    case 'interface':
      if (!(
        isRecord(value) &&
        typeof value.Type === 'string' &&
        field.type !== null &&
        Object.hasOwn(SYNTAX_INTERFACES, field.type)
      ))
        return false;
      if (isTypedNil(value, SYNTAX_INTERFACES[field.type])) return true;
      return SYNTAX_INTERFACES[field.type].includes(value.Type) ? value : false;
  }
}

/**
 * Validates complete records against the pinned schema, including nil-bearing
 * boundaries. This is a boundary check, not a semantic shell interpretation.
 *
 * Records are visited depth-first in field order on an explicit stack, so the
 * check needs no native frame per tree level and a very deep left-nested chain
 * cannot overflow it. Active ancestors (when tracked) are those records whose
 * fields are still being read, as in a recursive descent.
 */
function matchesRecord(root: unknown, check: Validation): boolean {
  const stack: ValidationFrame[] = [];
  if (!openRecord(root, check, stack)) return false;
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    let descend: Record<string, unknown> | undefined;
    if (frame.items !== null) {
      const [, field] = frame.fields[frame.field];
      if (frame.item >= frame.items.length) {
        frame.items = null;
        frame.field++;
        continue;
      }
      const item = frame.items[frame.item++];
      if (item === null) {
        if (!field.elementNullable) return false;
        continue;
      }
      const outcome = checkScalar(item, field);
      if (outcome === false) return false;
      if (outcome !== true) descend = outcome;
    } else if (frame.field === frame.fields.length) {
      stack.pop();
      check.active?.delete(frame.value);
      continue;
    } else {
      const [name, field] = frame.fields[frame.field];
      if (!Object.hasOwn(frame.value, name)) return false;
      let child = frame.value[name];
      if (check.restore && field.kind === 'position' && Array.isArray(child)) {
        const position = positionFromTuple(child);
        if (position === undefined) return false;
        frame.value[name] = child = position;
      }
      if (child === null) {
        if (!field.nullable) return false;
        frame.field++;
        continue;
      }
      if (field.slice) {
        if (!Array.isArray(child)) return false;
        frame.items = child as unknown[];
        frame.item = 0;
        continue;
      }
      const outcome = checkScalar(child, field);
      if (outcome === false) return false;
      frame.field++;
      if (outcome !== true) descend = outcome;
    }
    if (descend !== undefined && !openRecord(descend, check, stack)) return false;
  }
  return true;
}

/** Narrows complete syntax.Nodes or typed nil Node interfaces; auxiliaries are excluded. @internal */
export function isSyntaxNode(value: unknown): value is Node {
  if (isTypedNil(value, SYNTAX_INTERFACES.Node)) return true;
  return (
    isRecord(value) &&
    typeof value.Type === 'string' &&
    Object.hasOwn(SYNTAX_SCHEMA, value.Type) &&
    SYNTAX_SCHEMA[value.Type].node &&
    matchesRecord(value, { active: new Set(), restore: false })
  );
}

/** The public parser's root is the precise upstream File representation. @internal */
export function isSyntaxFile(value: unknown): value is File {
  return isSyntaxNode(value) && value.Type === 'File';
}

/**
 * Validates a parse response's File exactly as isSyntaxFile does while rebuilding
 * its positions. The bridge spells each File position as a compact
 * [Offset, Line, Col, Flags] tuple (flags: bit 0 IsValid, bit 1 IsRecovered,
 * bit 2 OffsetOverflow) because positions are most of a parse response. Each
 * tuple is replaced in place by the identical six-member SyntaxPos record, in
 * its usual member order, and then checked like any other position. Only a
 * freshly decoded response may be passed: the graph is mutated, and a false
 * result can leave it partly restored, so callers must discard it.
 * @internal
 */
export function restoreSyntaxFile(value: unknown): value is File {
  return isRecord(value) && value.Type === 'File' && matchesRecord(value, RESTORING);
}

/** Restoring validation state; it carries no per-call data and is shared. */
const RESTORING: Validation = { active: null, restore: true };
