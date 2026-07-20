import { ShInternalError, ShInvalidDialectError, ShParseError } from './errors.js';
import { normalize, toUtf16Column, type JsonValue } from './normalize.js';
import { assertParseDepthWithinLimit } from './parse-depth-guard.js';
import { callParse } from './wasm-instance.js';
import type { ParseOptions, ShellDialect, ShFile } from './types.js';

/**
 * The full set of dialects {@link parseSync} accepts, in the order surfaced
 * by {@link ShInvalidDialectError}'s message. Kept as a runtime value
 * distinct from the {@link ShellDialect} union so `parseSync` can validate
 * `options.dialect` before ever calling into the WASM shim.
 */
const SUPPORTED_SHELL_DIALECTS: readonly ShellDialect[] = ['bash', 'posix', 'mksh', 'bats', 'zsh'];

function isSupportedShellDialect(value: string): value is ShellDialect {
  return (SUPPORTED_SHELL_DIALECTS as readonly string[]).includes(value);
}

interface ParseErrorPayload {
  message: string;
  filename: string;
  line: number;
  column: number;
  offset: number;
}

interface ErrorPayload {
  message: string;
}

interface ResultEnvelope {
  file?: JsonValue;
  parseError?: ParseErrorPayload;
  error?: ErrorPayload;
}

/**
 * Checks that `value` is a plain object — rejects arrays, `null`, wrapped
 * primitives, class instances, and symbol-keyed objects. `isResultEnvelope`
 * and its field-level helpers below all validate `unknown` input coming
 * straight out of `JSON.parse`, so this is the full-rigor check, not just
 * `typeof value === 'object'`.
 *
 * @internal
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function isParseErrorPayload(value: unknown): value is ParseErrorPayload {
  return (
    isPlainObject(value) &&
    typeof value.message === 'string' &&
    typeof value.filename === 'string' &&
    typeof value.line === 'number' &&
    typeof value.column === 'number' &&
    typeof value.offset === 'number'
  );
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  return isPlainObject(value) && typeof value.message === 'string';
}

/**
 * @internal
 */
export function isResultEnvelope(value: unknown): value is ResultEnvelope {
  if (!isPlainObject(value)) return false;
  if (value.parseError !== undefined && !isParseErrorPayload(value.parseError)) return false;
  if (value.error !== undefined && !isErrorPayload(value.error)) return false;
  return true;
}

function asShFile(node: ReturnType<typeof normalize>): ShFile {
  if (node.type !== 'File') {
    throw new ShInternalError(`bridge: expected root node of type "File", got "${node.type}"`);
  }
  if (!Array.isArray(node.stmts)) {
    throw new ShInternalError('bridge: expected root node to have an array "stmts" field');
  }
  return node as ShFile;
}

/**
 * Synchronously parses shell source into a normalized AST.
 *
 * The first call instantiates the WASM shim synchronously (Node-only); the
 * instance is reused across subsequent calls, so repeated calls do not
 * re-instantiate (see design/ARCHITECTURE.md).
 *
 * Throws {@link ShParseError} on a shell syntax error, carrying the position
 * mvdan/sh reported: `.line` is 1-based exactly as mvdan/sh reports it;
 * `.column` is converted to UTF-16 code units so it agrees with
 * {@link ShNode.loc}'s columns (mvdan/sh itself reports `column` as a byte
 * count — see {@link ShParseErrorInfo.column}). That unconverted, raw
 * position appears only inside `.message`, which is mvdan/sh's own
 * formatted string, verbatim. Throws {@link ShInvalidDialectError} when
 * {@link ParseOptions.dialect} is not a supported dialect. Throws
 * {@link ShInternalError} for failures that should never happen given
 * a correctly-behaving shim (malformed envelope, unexpected root node
 * type, shim contract violations). Throws {@link ShParseMaxDepthError} if
 * `text`'s conservatively estimated structural nesting depth exceeds the
 * limit this bridge accepts — checked, and thrown, *before* `text` is ever
 * handed to the WASM shim, since mvdan/sh's own parser has no recovery path
 * for exhausting its stack on pathological nesting (see that error's doc
 * comment and `parse-depth-guard.ts`).
 *
 * @public
 */
export function parseSync(text: string, options?: ParseOptions): ShFile {
  const dialect: string = options?.dialect ?? 'bash';
  const filename = options?.filename ?? 'input.sh';

  if (!isSupportedShellDialect(dialect)) {
    throw new ShInvalidDialectError(dialect, SUPPORTED_SHELL_DIALECTS);
  }

  assertParseDepthWithinLimit(text);

  const raw = callParse(text, dialect, filename);
  const result: unknown = JSON.parse(raw);
  if (!isResultEnvelope(result)) {
    throw new ShInternalError('bridge: WASM shim returned an unexpected payload shape');
  }
  if (result.parseError) {
    // mvdan/sh reports `column` as a byte count on the source line, not a
    // UTF-16 code unit count — inconsistent with ShNode.loc.column, which is
    // always UTF-16 (see design/ARCHITECTURE.md's "Byte→UTF-16 conversion").
    // Recompute it from `offset` (a byte offset from the start of the file,
    // which every position mvdan/sh reports carries) via the same
    // conversion `normalize` applies to every node, so a thrown
    // ShParseError's column always agrees with the column a ShNode at that
    // position would report.
    const column = toUtf16Column(text, result.parseError.offset, result.parseError.line);
    throw new ShParseError(result.parseError.message, {
      line: result.parseError.line,
      column,
      filename: result.parseError.filename,
    });
  }
  if (result.error) {
    throw new ShInternalError(result.error.message);
  }
  if (result.file === undefined) {
    throw new ShInternalError('bridge: WASM shim returned neither a file nor an error');
  }
  return asShFile(normalize(result.file, text));
}
