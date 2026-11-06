/**
 * SplitBraces-only structural input depth preflight. Generated Go field metadata
 * identifies records and position values without interpreting shell syntax or
 * replacing the complete validator. Refusal precedes recursive JS encoding and
 * native decoding, whose stack limits can change after runtime warm-up.
 */
import {
  SYNTAX_INTERFACES,
  SYNTAX_SCHEMA,
  type SyntaxFieldSchema,
} from '../generated/syntax-schema.js';
import { ShInternalError } from './errors.js';
import { InputError } from './syntax-errors.js';
import { isRecord, isSyntaxPos } from './syntax-wire.js';

/** Same semantic record units as the native SplitBraces output transport policy. */
const MAX_INPUT_RECORD_DEPTH = 256;

/** A current record's field cursor keeps memory proportional to bounded depth. */
interface IRecordFrame {
  readonly kind: 'record';
  readonly value: Record<string, unknown>;
  readonly fields: readonly (readonly [string, SyntaxFieldSchema])[];
  readonly depth: number;
  next: number;
}

/** A slice adds no record unit and never materializes a frame for every sibling. */
interface ISliceFrame {
  readonly kind: 'slice';
  readonly value: readonly unknown[];
  readonly field: SyntaxFieldSchema;
  readonly depth: number;
  readonly extent: number;
  next: number;
}

/** Only supported Go data containers are traversed; shape validation stays separate. */
type InputFrame = IRecordFrame | ISliceFrame;

/** Generated metadata is immutable; cache its field lists rather than caller data. */
const FIELDS = new Map<string, readonly (readonly [string, SyntaxFieldSchema])[]>();

/**
 * Enforces the input transport budget without recursive traversal or native entry.
 * Shared records are visited at every path. Active ancestors alone identify
 * cycles, retaining InputError instead of pruning aliases or guessing through a
 * cyclic graph. Typed-nil interfaces contain no Go struct record to descend into.
 * @internal
 */
export function assertSplitBracesInputDepth(root: unknown): void {
  if (!isRecord(root) || root.Type !== 'Word') return;
  const active = new Set<object>();
  const stack: InputFrame[] = [];

  /** Starts one actual Go record; pointer/interface wrappers do not spend units. */
  const record = (value: unknown, parentDepth: number): void => {
    if (
      !isRecord(value) ||
      typeof value.Type !== 'string' ||
      !Object.hasOwn(SYNTAX_SCHEMA, value.Type)
    )
      return;
    if (active.has(value))
      throw new InputError('SplitBraces requires a complete, acyclic Word record');
    const depth = parentDepth + 1;
    checkDepth(depth);
    let fields = FIELDS.get(value.Type);
    if (fields === undefined) {
      fields = Object.entries(SYNTAX_SCHEMA[value.Type].fields);
      FIELDS.set(value.Type, fields);
    }
    active.add(value);
    stack.push({ kind: 'record', value, fields, depth, next: 0 });
  };

  /** Positions are Go values; scalar strings, including byte strings, are not records. */
  const scalar = (value: unknown, field: SyntaxFieldSchema, depth: number): void => {
    if (field.kind === 'position') {
      if (isSyntaxPos(value)) checkDepth(depth + 1);
      return;
    }
    if (!isRecord(value) || typeof value.Type !== 'string') return;
    if (field.kind === 'struct' && value.Type === field.type) record(value, depth);
    if (
      field.kind === 'interface' &&
      field.type !== null &&
      Object.hasOwn(SYNTAX_INTERFACES, field.type) &&
      SYNTAX_INTERFACES[field.type].includes(value.Type)
    )
      record(value, depth);
  };

  record(root, 0);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.kind === 'slice') {
      if (frame.next >= frame.extent) {
        stack.pop();
        continue;
      }
      const value = frame.value[frame.next++];
      scalar(value, frame.field, frame.depth);
      continue;
    }
    if (frame.next >= frame.fields.length) {
      active.delete(frame.value);
      stack.pop();
      continue;
    }
    const [name, field] = frame.fields[frame.next++];
    // Missing/inherited fields remain the complete validator's domain rather
    // than introducing depth work through data it will reject.
    if (!Object.hasOwn(frame.value, name)) continue;
    const value = frame.value[name];
    if (field.slice) {
      if (Array.isArray(value)) {
        stack.push({
          kind: 'slice',
          value,
          field,
          depth: frame.depth,
          extent: value.length,
          next: 0,
        });
      }
    } else {
      scalar(value, field, frame.depth);
    }
  }
}

/** Refuses represented depth before it can exhaust either transport stack. */
function checkDepth(depth: number): void {
  if (depth > MAX_INPUT_RECORD_DEPTH) {
    throw new ShInternalError(
      `SplitBraces input record depth ${String(depth)} exceeds the bridge transport limit ${String(MAX_INPUT_RECORD_DEPTH)}`,
    );
  }
}
