/**
 * Lossless JSON adaptation at the JS/Go boundary. Go strings are byte sequences;
 * integer arguments may span 64 bits. Tagged encodings preserve those domains
 * without changing the public syntax records into a second tree model.
 */
import { InputError } from './syntax-errors.js';
import { ShInternalError } from './errors.js';
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
 * Encodes bytes and exact integers without relying on JSON's number precision or
 * Uint8Array property enumeration. Circular input is a caller error, not a stack
 * overflow or a partially transferred request.
 * @internal
 */
export function encodeWire(value: unknown): string {
  const ancestors = new Set<object>();
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') {
      assertUnicodeString(item);
      return item;
    }
    if (typeof item === 'bigint') return { Int: item.toString() };
    if (item instanceof Uint8Array) return { Bytes: Buffer.from(item).toString('base64') };
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item))
        throw new InputError(
          'Numeric values must be safe integers; use bigint for 64-bit arguments',
        );
      return item;
    }
    if (typeof item !== 'object')
      throw new InputError(
        'Syntax wire values must be data records, arrays, bytes, or scalar values',
      );
    if (ancestors.has(item)) throw new InputError('Syntax records cannot contain cycles');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) return item.map(visit);
      if (!isRecord(item)) throw new InputError('Expected a syntax data record');
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
    } finally {
      ancestors.delete(item);
    }
  };
  return JSON.stringify(visit(value));
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
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) {
        const child: unknown = item[index];
        const restored = visit(child);
        if (restored !== child) item[index] = restored;
      }
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
    for (const key of keys) {
      const child = item[key];
      const restored = visit(child);
      if (restored !== child) {
        // JSON keys, including __proto__, remain own data properties. Defining a
        // replacement cannot invoke a prototype setter or change the record shape.
        Object.defineProperty(item, key, {
          value: restored,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return item;
  };
  return visit(parsed);
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
 * Validates complete records against the pinned schema, including nil-bearing
 * boundaries. This is a boundary check, not a semantic shell interpretation.
 */
function matchesRecord(value: unknown, active: Set<object>): boolean {
  if (!isRecord(value) || typeof value.Type !== 'string' || active.has(value)) return false;
  if (!Object.hasOwn(SYNTAX_SCHEMA, value.Type)) return false;
  const descriptor = SYNTAX_SCHEMA[value.Type];
  if (Object.keys(value).length !== Object.keys(descriptor.fields).length + 1) return false;
  active.add(value);
  try {
    return Object.entries(descriptor.fields).every(
      ([name, field]) => Object.hasOwn(value, name) && matchesField(value[name], field, active),
    );
  } finally {
    active.delete(value);
  }
}

/** Checks one upstream field without conflating a nil slice with an empty one. */
function matchesField(value: unknown, field: SyntaxFieldSchema, active: Set<object>): boolean {
  if (value === null) return field.nullable;
  if (field.slice) {
    return (
      Array.isArray(value) &&
      value.every((item: unknown) =>
        item === null ? field.elementNullable : matchesScalar(item, field, active),
      )
    );
  }
  return matchesScalar(value, field, active);
}

/** Each scalar category retains its upstream domain rather than JS coercions. */
function matchesScalar(value: unknown, field: SyntaxFieldSchema, active: Set<object>): boolean {
  switch (field.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return isGoString(value);
    case 'position':
      return isSyntaxPos(value);
    case 'operator':
      return (
        typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff
      );
    case 'struct':
      return isRecord(value) && value.Type === field.type && matchesRecord(value, active);
    case 'interface':
      return (
        isRecord(value) &&
        typeof value.Type === 'string' &&
        field.type !== null &&
        Object.hasOwn(SYNTAX_INTERFACES, field.type) &&
        (isTypedNil(value, SYNTAX_INTERFACES[field.type]) ||
          (SYNTAX_INTERFACES[field.type].includes(value.Type) && matchesRecord(value, active)))
      );
  }
}

/** Narrows complete syntax.Nodes or typed nil Node interfaces; auxiliaries are excluded. @internal */
export function isSyntaxNode(value: unknown): value is Node {
  if (isTypedNil(value, SYNTAX_INTERFACES.Node)) return true;
  return (
    isRecord(value) &&
    typeof value.Type === 'string' &&
    Object.hasOwn(SYNTAX_SCHEMA, value.Type) &&
    SYNTAX_SCHEMA[value.Type].node &&
    matchesRecord(value, new Set())
  );
}

/** The public parser's root is the precise upstream File representation. @internal */
export function isSyntaxFile(value: unknown): value is File {
  return isSyntaxNode(value) && value.Type === 'File';
}
