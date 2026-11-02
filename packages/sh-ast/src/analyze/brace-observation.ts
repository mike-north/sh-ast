/**
 * Observes potential brace syntax without rewriting caller-owned words. The
 * pinned Go operation decides brace grammar; this module only excludes words
 * with no unescaped opening brace and marks upstream escape discrepancies as
 * uncertainty. Ordinary words never cross the WASM boundary for this check.
 */
import type { Word } from '../../generated/syntax-types.js';
import { ShInternalError } from '../errors.js';
import { decodeWire, encodeWire, isRecord } from '../syntax-wire.js';
import { callSyntax } from '../wasm-instance.js';

/** A positive observation is distinct from inability to trust upstream escape handling. @internal */
export type BraceObservation = boolean | 'unsupported';

/**
 * A brace needs an unescaped opening in a top-level literal. Quoted parts never
 * supply delimiters; backslash pairs protect each other, so an even-length run
 * exposes the following opening. This is a necessary condition, not a parser.
 */
function hasUnescapedOpening(raw: string): boolean {
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === '\\') {
      index++;
    } else if (raw[index] === '{') {
      return true;
    }
  }
  return false;
}

/**
 * Reports current word content, never an identity cache. Go reconstructs an
 * isolated Word before SplitBraces mutates it. v3.13.1's SplitBraces mishandles
 * escapes, so candidates containing backslashes remain unknown instead of
 * introducing a competing brace grammar or claiming a false static value.
 * @internal
 */
export function observeBraces(word: Word): BraceObservation {
  let candidate = false;
  let escaped = false;
  for (const part of word.Parts ?? []) {
    if (part?.Type !== 'Lit' || typeof part.Value !== 'string') continue;
    candidate ||= hasUnescapedOpening(part.Value);
    escaped ||= part.Value.includes('\\');
  }
  if (!candidate) return false;
  if (escaped) return 'unsupported';
  const response = decodeWire(
    callSyntax('word-braces', new TextEncoder().encode(encodeWire(word))),
  );
  if (!isRecord(response)) throw new ShInternalError('Invalid brace observation response');
  if (isRecord(response.Error) && response.Error.Kind === 'InputError') return 'unsupported';
  if (typeof response.Brace !== 'boolean' || Object.keys(response).length !== 1) {
    throw new ShInternalError('Invalid brace observation response');
  }
  return response.Brace;
}
