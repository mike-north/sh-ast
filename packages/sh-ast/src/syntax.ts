/**
 * Synchronous access to the pinned upstream syntax model. Parsing and derived
 * node bounds run in Go; this module transports exact data and adapts errors,
 * leaving ESLint locations, traversal, and policy to consumers.
 */
import { SYNTAX_SCHEMA } from '../generated/syntax-schema.js';
import type { OperatorFamily, RawOperator } from '../generated/syntax-constants.js';
import type { File, GoString, Node, SyntaxPos } from '../generated/syntax-types.js';
import { ShInternalError } from './errors.js';
import { assertParseDepthWithinLimit } from './parse-depth-guard.js';
import { InputError, LangError, ParseError } from './syntax-errors.js';
import {
  assertUnicodeString,
  decodeWire,
  encodeWire,
  isGoString,
  isRecord,
  isSyntaxFile,
  isSyntaxNode,
  isSyntaxPos,
} from './syntax-wire.js';
import { callSyntax } from './wasm-instance.js';
import { createPositionSnapshot, type ParsedFile } from './syntax-snapshot.js';
export type { ParsedFile, PositionSnapshot, NodePositions } from './syntax-snapshot.js';

export { InputError, LangError, ParseError } from './syntax-errors.js';

/**
 * Whole-file parser inputs corresponding to upstream controls. Defaults match
 * NewParser; in particular comments are retained only when KeepComments is true.
 * Numeric int arguments accept bigint because Go's WASM int is signed 64-bit.
 * @public
 */
export interface ParseOptions {
  /** Source identity carried by File/errors; no file is opened by the binding. */
  Filename?: GoString;
  /** Retains comment nodes when true; upstream defaults to false. */
  KeepComments?: boolean;
  /** Upstream LangVariant value. Variant rejects unsupported values, including LangAuto. */
  Variant?: number | bigint;
  /** Lexer delimiter with upstream byte-length, whitespace and prefix semantics. */
  StopAt?: GoString;
  /** Maximum number of recoverable missing grammar tokens, using upstream behavior. */
  RecoverErrors?: number | bigint;
}

/**
 * Parses exact source bytes, or well-formed Unicode text encoded as UTF-8. First
 * use synchronously initializes WASM. The existing conservative nesting guard is
 * an explicit binding resource limit, not an upstream grammar restriction.
 * @public
 */
export function parseSync(source: string | Uint8Array, options: ParseOptions = {}): File {
  return invokeParse('parse', source, options).file;
}

/**
 * Parses once while observing every real node's upstream bounds in Go. The
 * separate immutable lookup describes this original parse; it never replaces
 * live nodePos/nodeEnd or tracks edits. Source adapters avoid reconstructing
 * each descendant subtree just to display the original source locations.
 * @public
 */
export function parseWithPositionsSync(
  source: string | Uint8Array,
  options: ParseOptions = {},
): ParsedFile {
  const { file, response } = invokeParse('parse-with-positions', source, options);
  return Object.freeze({ File: file, Positions: createPositionSnapshot(file, response.Positions) });
}

/** Shared source/options/error semantics for both whole-file parsing operations. */
function invokeParse(
  operation: 'parse' | 'parse-with-positions',
  source: string | Uint8Array,
  options: ParseOptions,
): { file: File; response: Record<string, unknown> } {
  if (typeof source !== 'string' && !(source instanceof Uint8Array))
    throw new InputError('Source must be a string or Uint8Array');
  if (typeof source === 'string') assertUnicodeString(source);
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
  // Decoding here supplies only an ASCII-structure risk estimate. The original
  // bytes, including malformed UTF-8, are always sent unchanged to the parser.
  assertParseDepthWithinLimit(
    typeof source === 'string' ? source : new TextDecoder().decode(source),
  );
  validateOptions(options);
  const result = invoke(operation, bytes, encodeWire(options));
  if (!isSyntaxFile(result.File))
    throw new ShInternalError('The syntax parser returned an incomplete or invalid File record');
  return { file: result.File, response: result };
}

/**
 * Computes a node's starting position from its current fields using upstream's
 * Pos method. No cached parse-time position can override subsequent tree edits.
 * @public
 */
export function nodePos(node: Node): SyntaxPos {
  return positionOf('pos', node);
}

/**
 * Computes a node's ending position using upstream's End method, including
 * recovered/invalid behavior and changes to text or child nodes.
 * @public
 */
export function nodeEnd(node: Node): SyntaxPos {
  return positionOf('end', node);
}

/**
 * Constructs an upstream position. uint64 arguments use bigint when outside the
 * safe-number range; upstream clamps offsets and zeroes overflowing line/column
 * values. The binding does not replace those rules with its own range policy.
 * @public
 */
export function newPos(
  offset: number | bigint,
  line: number | bigint,
  column: number | bigint,
): SyntaxPos {
  const result = invoke(
    'newpos',
    new TextEncoder().encode(encodeWire({ Offset: offset, Line: line, Col: column })),
  );
  if (!isSyntaxPos(result.Position))
    throw new ShInternalError('The syntax constructor returned an invalid position record');
  return result.Position;
}

/**
 * Represents an unnamed value in an upstream uint32 operator family. Named
 * constants remain precise literal unions; this explicit path preserves other Go
 * values without claiming an operation such as Print accepts them.
 * @public
 */
export function rawOperator<Family extends OperatorFamily>(
  family: Family,
  value: number,
): RawOperator<Family> {
  const knownFamily = Object.values(SYNTAX_SCHEMA).some((record) =>
    Object.values(record.fields).some(
      (field) => field.kind === 'operator' && field.type === family,
    ),
  );
  if (!knownFamily || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new InputError(
      'An operator value must belong to a known family and be an integral uint32',
    );
  }
  // The runtime check establishes the opaque numeric brand; no value is changed.
  return value as RawOperator<Family>;
}

/** Exact Go options are validated without silently ignoring misspelled keys. */
function validateOptions(options: ParseOptions): void {
  if (!isRecord(options)) throw new InputError('Parser options must be a data record');
  const allowed = new Set(['Filename', 'KeepComments', 'Variant', 'StopAt', 'RecoverErrors']);
  for (const [name, value] of Object.entries(options)) {
    if (!allowed.has(name)) throw new InputError(`Unknown parser option: ${name}`);
    if ((name === 'Filename' || name === 'StopAt') && !isGoString(value))
      throw new InputError(`${name} must be a string or byte array`);
    if (name === 'KeepComments' && typeof value !== 'boolean')
      throw new InputError('KeepComments must be boolean');
    if (
      (name === 'Variant' || name === 'RecoverErrors') &&
      typeof value !== 'bigint' &&
      (typeof value !== 'number' || !Number.isSafeInteger(value))
    ) {
      throw new InputError(`${name} must be a safe integer or bigint`);
    }
  }
}

/** Only the requested upstream method runs; partial nodes can support one bound. */
function positionOf(operation: 'pos' | 'end', node: Node): SyntaxPos {
  if (!isSyntaxNode(node))
    throw new InputError('Expected a complete, acyclic upstream Node record');
  const result = invoke(operation, new TextEncoder().encode(encodeWire(node)));
  if (!isSyntaxPos(result.Position))
    throw new ShInternalError('The syntax bridge returned an invalid derived position');
  return result.Position;
}

/** Decodes one complete response before translating its upstream failure kind. */
function invoke(operation: string, payload: Uint8Array, options = '{}'): Record<string, unknown> {
  const result = decodeWire(callSyntax(operation, payload, options));
  if (!isRecord(result))
    throw new ShInternalError('The syntax bridge returned a non-record response');
  if (result.Error !== undefined) {
    const error = result.Error;
    if (!isRecord(error) || !isGoString(error.Message))
      throw new ShInternalError('The syntax bridge returned a malformed error');
    if (error.Kind === 'InputError') throw new InputError(error.Message);
    if (error.Kind === 'InternalError')
      throw new ShInternalError(
        typeof error.Message === 'string' ? error.Message : new TextDecoder().decode(error.Message),
      );
    const file = result.File === null ? null : isSyntaxFile(result.File) ? result.File : undefined;
    if (file === undefined || !isGoString(error.Filename) || !isSyntaxPos(error.Pos))
      throw new ShInternalError('The syntax bridge dropped a partial result or error position');
    if (
      error.Kind === 'ParseError' &&
      isGoString(error.Text) &&
      typeof error.Incomplete === 'boolean'
    ) {
      throw new ParseError(
        error.Message,
        error.Filename,
        error.Pos,
        error.Text,
        error.Incomplete,
        file,
      );
    }
    if (
      error.Kind === 'LangError' &&
      isGoString(error.Feature) &&
      Array.isArray(error.Langs) &&
      error.Langs.every(
        (lang: unknown) => typeof lang === 'number' && Number.isSafeInteger(lang),
      ) &&
      typeof error.LangUsed === 'number'
    ) {
      throw new LangError(
        error.Message,
        error.Filename,
        error.Pos,
        error.Feature,
        error.Langs,
        error.LangUsed,
        file,
      );
    }
    throw new ShInternalError('The syntax bridge returned an unknown or incomplete upstream error');
  }
  return result;
}
