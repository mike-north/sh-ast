/**
 * Faithful access to Go syntax.SplitBraces. Go owns brace parsing and rewritten
 * values; the bridge restores only identities of input WordParts Go reused.
 * Expansion classification, escape uncertainty, and shell policy belong to callers.
 */
import type { Word, WordPart } from '../generated/syntax-types.js';
import { ShInternalError } from './errors.js';
import { InputError } from './syntax-errors.js';
import { decodeWire, encodeWire, isGoString, isRecord, isSyntaxNode } from './syntax-wire.js';
import { callSyntax } from './wasm-instance.js';

/**
 * Applies the selected Go syntax.SplitBraces operation synchronously to a mutable
 * Word and returns its exact boolean. First use initializes WASM synchronously.
 * `true` does not imply that a BraceExp exists: malformed or singleton brace text
 * can return true while being represented again as literals. No fields expand.
 *
 * The Word keeps its identity. False preserves its Parts array and children;
 * true replaces Parts as Go does, retaining input WordPart objects that Go reuses,
 * including inside new brace elements. Newly split literals retain Go's copied
 * position values; new nodes have no entry in an original PositionSnapshot.
 * Existing aliases to an old Parts array continue to observe that old array.
 * Selected Go Walk rejects BraceExp nodes; callers can inspect the transformed
 * records directly. This operation does not extend traversal's supported nodes.
 *
 * InputError identifies unrepresentable input. A panic from the selected native
 * operation becomes ShInternalError and leaves the supplied Word unchanged.
 * This operation does not change parser output before explicitly being called.
 * @public
 */
export function splitBraces(word: Word): boolean {
  if (!isWordRecord(word)) {
    throw new InputError('SplitBraces requires a complete, acyclic Word record');
  }
  const originalParts = word.Parts ?? [];
  const result = decodeWire(callSyntax('split-braces', new TextEncoder().encode(encodeWire(word))));
  if (!isRecord(result)) {
    throw new ShInternalError('SplitBraces returned a non-record response');
  }
  if (result.Error !== undefined) {
    const error = result.Error;
    if (!isRecord(error) || !isGoString(error.Message)) {
      throw new ShInternalError('SplitBraces returned a malformed error');
    }
    if (error.Kind === 'InputError') {
      throw new InputError(error.Message);
    }
    if (error.Kind === 'InternalError') {
      throw new ShInternalError(
        typeof error.Message === 'string' ? error.Message : new TextDecoder().decode(error.Message),
      );
    }
    throw new ShInternalError('SplitBraces returned an unknown error kind');
  }
  if (result.Changed === false && Object.keys(result).length === 1) {
    return false;
  }
  if (
    result.Changed !== true ||
    Object.keys(result).length !== 3 ||
    !isWordRecord(result.Word) ||
    !Array.isArray(result.RetainedParts)
  ) {
    throw new ShInternalError('SplitBraces returned an invalid transformation');
  }
  const transformed = result.Word;
  restorePartIdentities(transformed, result.RetainedParts, originalParts);
  word.Parts = transformed.Parts;
  return true;
}

/** Only a complete Word record can be the operation's mutable root. */
function isWordRecord(value: unknown): value is Word {
  return isSyntaxNode(value) && value.Type === 'Word';
}

/** Reconnects native reused-input occurrences after every route is validated. */
function restorePartIdentities(
  transformed: Word,
  retainedParts: readonly unknown[],
  originalParts: readonly (WordPart | null)[],
): void {
  const targets: IRetainedTarget[] = [];
  const observed = new Set<string>();
  for (const retained of retainedParts) {
    if (
      !isRecord(retained) ||
      Object.keys(retained).length !== 2 ||
      !isIndex(retained.Input) ||
      retained.Input >= originalParts.length ||
      !isPartPath(retained.Path)
    ) {
      throw new ShInternalError('SplitBraces returned invalid input-part provenance');
    }
    const original = originalParts[retained.Input];
    const key = retained.Path.join('/');
    if (!Object.hasOwn(originalParts, retained.Input) || observed.has(key)) {
      throw new ShInternalError('SplitBraces returned invalid input-part provenance');
    }
    observed.add(key);
    targets.push({ ...retainedTarget(transformed, retained.Path), value: original });
  }
  // Validate every destination before inserting original objects. Even malformed
  // provenance cannot make a later path traverse and mutate caller-owned parts.
  for (const target of targets) {
    target.parts[target.index] = target.value;
  }
}

/** One already-validated, private output slot to receive a reused input part. */
interface IRetainedTarget {
  readonly parts: (WordPart | null)[];
  readonly index: number;
  readonly value: WordPart | null;
}

/** Only finite array indexes can identify an input occurrence or output slot. */
function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Routes alternate Parts/Elems indexes and end at a WordPart occurrence. */
function isPartPath(value: unknown): value is number[] {
  return Array.isArray(value) && value.length % 2 === 1 && value.every(isIndex);
}

/**
 * Resolves only new Word/BraceExp containers, rather than providing an arbitrary
 * object-graph mutation protocol. Original input objects are inserted afterwards.
 */
function retainedTarget(root: Word, path: readonly number[]): Omit<IRetainedTarget, 'value'> {
  let word = root;
  for (let offset = 0; offset < path.length; offset += 2) {
    const index = path[offset];
    const parts = word.Parts;
    if (parts === null || index >= parts.length) {
      throw new ShInternalError('SplitBraces returned an invalid output-part route');
    }
    if (offset === path.length - 1) {
      return { parts, index };
    }
    const part = parts[index];
    const elementIndex = path[offset + 1];
    if (part?.Type !== 'BraceExp') {
      throw new ShInternalError('SplitBraces returned an invalid output-part route');
    }
    const element = part.Elems?.[elementIndex];
    if (element === null || element === undefined) {
      throw new ShInternalError('SplitBraces returned an invalid output-part route');
    }
    word = element;
  }
  throw new ShInternalError('SplitBraces returned an empty output-part route');
}
