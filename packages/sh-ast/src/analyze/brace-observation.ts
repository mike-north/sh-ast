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
 * Reports current word content, never an identity cache. Go reconstructs an
 * isolated Word before SplitBraces mutates it. v3.13.1's SplitBraces mishandles
 * escapes, so candidates containing backslashes remain unknown instead of
 * introducing a competing brace grammar or claiming a false static value.
 * @internal
 */
export function observeBraces(word: Word): BraceObservation {
  let candidate = false;
  let escaped = false;
  let escapeCrossesPart = false;
  // Adjacent literal records concatenate without a quote boundary. Carry the
  // backslash state across them: two one-backslash records expose the next
  // opening just as two backslashes in one Lit do. Nonliteral parts protect
  // their own content and break this unquoted lexical run.
  let protectedNext = false;
  for (const part of word.Parts ?? []) {
    escapeCrossesPart ||= protectedNext;
    if (part?.Type !== 'Lit' || typeof part.Value !== 'string') {
      protectedNext = false;
      continue;
    }
    for (const character of part.Value) {
      if (protectedNext) {
        protectedNext = false;
      } else if (character === '\\') {
        protectedNext = true;
        escaped = true;
      } else if (character === '{') {
        candidate = true;
      }
    }
  }
  // A split escape crosses the analyzer's per-part unquoting boundary. It can
  // expose syntax inside a following quoted part, so uncertainty must not
  // depend on finding a literal brace first. Decline every such constructed
  // word instead of rebuilding shell tokenization or claiming static text.
  if (escapeCrossesPart) return 'unsupported';
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
