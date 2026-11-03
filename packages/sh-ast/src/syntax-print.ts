/**
 * Collected-output access to upstream Printer.Print. The reverse codec rebuilds
 * the current faithful tree, and Go owns formatting decisions. This module has
 * no source cache, parser round trip, writer callbacks, or reusable printer state.
 */
import type { GoString, Node } from '../generated/syntax-types.js';
import { ShInternalError } from './errors.js';
import { InputError } from './syntax-errors.js';
import { PrintError, PrintPanicError } from './syntax-print-errors.js';
import { decodeWire, encodeWire, isGoString, isRecord, isSyntaxNode } from './syntax-wire.js';
import { callSyntax } from './wasm-instance.js';

/**
 * Upstream NewPrinter controls applied to a fresh printer for each call. All
 * flags default to false; zero indentation selects tabs. The pinned WASM uint
 * domain is 64-bit, so Indent accepts bigint beyond JavaScript's safe integers.
 * @public
 */
export interface PrintOptions {
  /** Spaces per level, or zero for tabs. Large values can request expensive output. */
  Indent?: number | bigint;
  /** Places multiline binary operators on the next line with a backslash continuation. */
  BinaryNextLine?: boolean;
  /** Indents case alternatives, placing their bodies two levels below the case clause. */
  SwitchCaseIndent?: boolean;
  /** Adds space after redirection operators except `>&`, `<&`, `>(` and `<(`. */
  SpaceRedirects?: boolean;
  /**
   * Preserves token columns on a best-effort basis.
   * @deprecated Upstream marks this option as flawed and plans removal in v4.
   */
  KeepPadding?: boolean;
  /** Omits comments, indentation and optional whitespace. Incompatible with SingleLine. */
  Minify?: boolean;
  /** Reduces newlines except where comments, heredocs or File output require them. */
  SingleLine?: boolean;
  /** Places a function's opening brace on the next line. */
  FunctionNextLine?: boolean;
}

/**
 * Formats the current tree with a fresh upstream printer and collects all output.
 * Supported roots are File, Stmt, Word, Assign, Command and WordPart; other Nodes
 * produce PrintError. An ordinary structuredClone of a supported syntax subtree
 * is accepted under the same input and failure rules; copying does not make nil
 * or unsupported roots printable. Only File output has upstream's trailing-newline behavior.
 * Invalid UTF-8 output remains bytes. Upstream formatting can itself consume
 * input bytes, including its tabwriter escape byte, so this is not source replay.
 *
 * InputError identifies unrepresentable input; PrintError is an ordinary returned
 * upstream error; PrintPanicError retains an upstream operation panic. No partial
 * output or arbitrary writer lifecycle is exposed. Full tree reconstruction and
 * collected output require memory proportional to the values involved; extreme
 * indentation or tree size is not made resource-safe by panic adaptation.
 * @public
 */
export function printSync(node: Node, options: PrintOptions = {}): GoString {
  validatePrintOptions(options);
  if (!isSyntaxNode(node)) {
    throw new InputError('Expected a complete, acyclic upstream Node record');
  }
  const payload = new TextEncoder().encode(encodeWire(node));
  const result = decodeWire(callSyntax('print', payload, encodeWire(options)));
  if (!isRecord(result)) {
    throw new ShInternalError('The syntax printer returned a non-record response');
  }
  if (result.Error !== undefined) {
    const error = result.Error;
    if (!isRecord(error) || !isGoString(error.Message)) {
      throw new ShInternalError('The syntax printer returned a malformed error');
    }
    switch (error.Kind) {
      case 'PrintError':
        throw new PrintError(error.Message);
      case 'PrintPanicError':
        throw new PrintPanicError(error.Message);
      case 'InputError':
        throw new InputError(error.Message);
      case 'InternalError':
        throw new ShInternalError(
          typeof error.Message === 'string'
            ? error.Message
            : new TextDecoder().decode(error.Message),
        );
      default:
        throw new ShInternalError('The syntax printer returned an unknown error kind');
    }
  }
  if (!isGoString(result.Output)) {
    throw new ShInternalError('The syntax printer returned an invalid output value');
  }
  return result.Output;
}

/** Validates exact option domains without imposing a formatting or indentation policy. */
function validatePrintOptions(options: PrintOptions): void {
  if (!isRecord(options)) {
    throw new InputError('Printer options must be a data record');
  }
  const flags = new Set([
    'BinaryNextLine',
    'SwitchCaseIndent',
    'SpaceRedirects',
    'KeepPadding',
    'Minify',
    'SingleLine',
    'FunctionNextLine',
  ]);
  for (const [name, value] of Object.entries(options)) {
    if (name === 'Indent') {
      const valid =
        typeof value === 'bigint'
          ? value >= 0n && value <= 0xffff_ffff_ffff_ffffn
          : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
      if (!valid) {
        throw new InputError('Indent must be a safe nonnegative integer or uint64 bigint');
      }
    } else if (!flags.has(name)) {
      throw new InputError(`Unknown printer option: ${name}`);
    } else if (typeof value !== 'boolean') {
      throw new InputError(`${name} must be boolean`);
    }
  }
}
