/**
 * Synchronous live dispatch of mvdan/sh's Walk case ordering. Child reads
 * occur when upstream reaches them; no precomputed trace or subtree transfer can
 * hide callback edits. Ordinary JavaScript arrays retain their own object identity;
 * distinct Go slice headers, capacity and value-slot addresses over shared backing
 * storage are not represented. Ordinary JavaScript aliases remain shared.
 * Positional work is limited to live comment placement.
 *
 * Adapted from mvdan.cc/sh/v3 v3.14.1 syntax/walk.go, copyright Daniel Martí.
 * The upstream BSD license is retained in syntax-walk-license.ts.
 */
import type { Comment, Node } from '../generated/syntax-types.js';
import { InputError } from './syntax-errors.js';
import { afterItemStart, atStatementEnd } from './syntax-walk-bounds.js';
import { nilDereference, WalkPanicError } from './syntax-walk-errors.js';
export { WalkPanicError } from './syntax-walk-errors.js';

/** A callback observes entries and null exits; false on entry prunes that occurrence. */
type ICallback = (node: Node | null) => boolean;
/** A concrete nil pointer keeps its dynamic Go type when passed through Node. */
type IConcreteKind = Exclude<Node['Type'], 'TypedNil'>;

/**
 * Walks synchronously using the pinned upstream case ordering. Each accepted entry is followed by its
 * children and a null exit. Returning false prunes the entry without an exit;
 * boolean exit return values are ignored. Every callback must return a boolean
 * synchronously; other results produce InputError. Callback exceptions retain their identity,
 * and upstream deferred comment callbacks still run during exception unwinding.
 *
 * Children and later fields are read live. Each list captures its array reference
 * and length when traversal reaches that list, then reads existing later slots
 * when reached. Replacing or reordering later slots is observed and can cause
 * a node to be skipped or revisited. Indices added beyond the captured extent
 * are not visited by that active list. Replacing the owner's array field does not
 * redirect an active list, but a later walk or print sees the current field.
 * Changes made before a list is reached are observed when it starts.
 *
 * Supported edits preserve each node's Type (and TypedNil.Kind), required field
 * shapes and every index within each active list's captured extent. Leaving
 * holes or shrinking an array below that extent (for example through truncation,
 * deletion, or length-reducing splice/shift) is outside the mutation contract.
 * These are not runtime validation rules. Ordinary JavaScript object and array
 * aliases remain shared; the binding does not model distinct Go slice headers or
 * capacity-dependent allocation over shared backing storage.
 *
 * Comments on Stmt, CaseItem and ArrayElem are copied before their callbacks,
 * including position and byte-string values; editing a copy does not edit the
 * stored comment. Last/CondLast/ThenLast/DoLast callbacks receive the stored
 * JavaScript Comment object. Replacing its array slot leaves any previously
 * retained callback object unchanged: there is no Go value-slot pointer identity.
 * Reentrant walks maintain independent traversal state.
 *
 * The tree must be acyclic. Depth is bounded by memory rather than the call stack.
 * A cycle reached through the fields the walk follows throws InputError instead of
 * descending without end; the exception is delivered like any other thrown during
 * the walk, so deferred comment callbacks still run. Subtrees shared by more than
 * one parent are not cycles and are visited once per path.
 * @public
 */
export function walk(node: Node, callback: (node: Node | null) => boolean): void {
  run(node, callback);
}

/**
 * Calls user code without intercepting its exceptions, then enforces Go's bool
 * return domain before traversal can consume the result. Exit results share
 * that domain even though their boolean values do not control traversal.
 */
function invokeCallback(node: Node | null, callback: ICallback): boolean {
  const result: unknown = callback(node);
  if (typeof result !== 'boolean') {
    throw new InputError('Walk callbacks must return a boolean synchronously');
  }
  return result;
}

/**
 * The child-bearing node types, each with the order in which upstream Walk visits
 * its fields. Types absent here have no children (Comment, Lit, SglQuoted) or are
 * rejected on entry (BraceExp). Numeric ids let one switch dispatch every step.
 */
const KIND_FILE = 0;
const KIND_STMT = 1;
const KIND_ASSIGN = 2;
const KIND_REDIRECT = 3;
const KIND_CALL_EXPR = 4;
const KIND_STMT_LIST = 5;
const KIND_IF_CLAUSE = 6;
const KIND_WHILE_CLAUSE = 7;
const KIND_FOR_CLAUSE = 8;
const KIND_WORD_ITER = 9;
const KIND_C_STYLE_LOOP = 10;
const KIND_BINARY_CMD = 11;
const KIND_FUNC_DECL = 12;
const KIND_PARTS = 13;
const KIND_PARAM_EXP = 14;
const KIND_OPERAND = 15;
const KIND_OPERANDS = 16;
const KIND_FLAGS_ARITHM = 17;
const KIND_CASE_CLAUSE = 18;
const KIND_CASE_ITEM = 19;
const KIND_ARRAY_ELEM = 20;
const KIND_DECL_CLAUSE = 21;
const KIND_ARRAY_EXPR = 22;
const KIND_EXT_GLOB = 23;
const KIND_TIME_CLAUSE = 24;
const KIND_COPROC_CLAUSE = 25;
const KIND_LET_CLAUSE = 26;
const KIND_TEST_DECL = 27;

/** Lookup by type that cannot be confused with inherited object members. */
const KINDS = new Map<string, number>([
  ['File', KIND_FILE],
  ['Stmt', KIND_STMT],
  ['Assign', KIND_ASSIGN],
  ['Redirect', KIND_REDIRECT],
  ['CallExpr', KIND_CALL_EXPR],
  ['Subshell', KIND_STMT_LIST],
  ['Block', KIND_STMT_LIST],
  ['CmdSubst', KIND_STMT_LIST],
  ['ProcSubst', KIND_STMT_LIST],
  ['IfClause', KIND_IF_CLAUSE],
  ['WhileClause', KIND_WHILE_CLAUSE],
  ['ForClause', KIND_FOR_CLAUSE],
  ['WordIter', KIND_WORD_ITER],
  ['CStyleLoop', KIND_C_STYLE_LOOP],
  ['BinaryCmd', KIND_BINARY_CMD],
  ['FuncDecl', KIND_FUNC_DECL],
  ['Word', KIND_PARTS],
  ['DblQuoted', KIND_PARTS],
  ['ParamExp', KIND_PARAM_EXP],
  ['ArithmExp', KIND_OPERAND],
  ['ArithmCmd', KIND_OPERAND],
  ['UnaryArithm', KIND_OPERAND],
  ['UnaryTest', KIND_OPERAND],
  ['ParenArithm', KIND_OPERAND],
  ['ParenTest', KIND_OPERAND],
  ['TestClause', KIND_OPERAND],
  ['BinaryArithm', KIND_OPERANDS],
  ['BinaryTest', KIND_OPERANDS],
  ['FlagsArithm', KIND_FLAGS_ARITHM],
  ['CaseClause', KIND_CASE_CLAUSE],
  ['CaseItem', KIND_CASE_ITEM],
  ['ArrayElem', KIND_ARRAY_ELEM],
  ['DeclClause', KIND_DECL_CLAUSE],
  ['ArrayExpr', KIND_ARRAY_EXPR],
  ['ExtGlob', KIND_EXT_GLOB],
  ['TimeClause', KIND_TIME_CLAUSE],
  ['CoprocClause', KIND_COPROC_CLAUSE],
  ['LetClause', KIND_LET_CLAUSE],
  ['TestDecl', KIND_TEST_DECL],
]);

/** Where an occurrence is after its entry callback accepted it. */
/** Reading children; the exit callback has not run. */
const PHASE_RUNNING = 0;
/** The exit callback ran and the deferred comment is being visited. */
const PHASE_DEFERRING = 1;
/** A failure is pending while the deferred comment is visited. */
const PHASE_UNWINDING = 2;

/** What the array a frame is stepping through holds. */
/** No array: the frame is between steps. */
const RUN_NONE = 0;
/** Concrete pointers; a nil slot is a typed nil of `kind`. */
const RUN_POINTERS = 1;
/** Interface values; a nil slot is visited as null. */
const RUN_INTERFACES = 2;
/** Stmt comments, deferring the first at or after the statement's end. */
const RUN_STMT_COMMENTS = 3;
/** Case-item or array-element comments, deferring the first after the item's start. */
const RUN_ITEM_COMMENTS = 4;

/**
 * One entered node with children, suspended between its children. Frames are
 * pooled per depth and reset on entry, so a walk allocates nothing per node.
 * `index` counts the node's steps; an array step captures the array and its extent
 * when reached, and later slots are read live.
 */
interface IFrame {
  node: Node;
  kind: number;
  /** Index of the next step of this node type. */
  index: number;
  phase: number;
  /** ParamExp: which auxiliary records were present when they were first checked. */
  flags: number;
  run: number;
  items: readonly (Node | null)[] | null;
  cursor: number;
  extent: number;
  /** The concrete kind of a pointer run's elements. */
  element: IConcreteKind;
  /** The single comment upstream defers to this occurrence's unwind. */
  deferred: Comment | undefined;
  /** The exception waiting for the deferred comment's visit to finish. */
  pending: { readonly error: unknown } | undefined;
}

/** A typed nil keeps the dynamic Go type of a nil pointer child. */
function pointer(node: Node | null, kind: IConcreteKind): Node {
  return node ?? { Type: 'TypedNil', Kind: kind };
}

/** Marks a ParamExp slice/replacement as present when first checked. */
const SLICE_PRESENT = 1;
const REPL_PRESENT = 2;

/** Auxiliary pointers are reread after callbacks may replace or clear their owner field. */
function dereference<T>(value: T | null): T {
  if (value === null) {
    return nilDereference();
  }
  return value;
}
/** Go copies a Comment's position and immutable string value before its callback. */
function copyComment(node: Comment): Comment {
  return {
    Type: 'Comment',
    Hash: { ...node.Hash },
    Text: typeof node.Text === 'string' ? node.Text : node.Text.slice(),
  };
}

/**
 * Depth at which a walk first checks its active path for a cycle, doubling after
 * each check. No tree is refused for its depth: a cycle can only be detected as a
 * node repeating on the path from the root, and checking at doubling depths costs
 * nothing for ordinary trees while bounding the memory a cyclic one can use to a
 * small multiple of this many frames.
 */
const FIRST_CYCLE_CHECK_DEPTH = 65_536;

/** The suspended occurrences of one walk; frames above `depth` are spare. */
interface IStack {
  readonly frames: IFrame[];
  depth: number;
  /** Depth at which the active path is next checked for a repeated node. */
  nextCycleCheck: number;
}
/** A list slot that may be a hole (undefined) reads as a nil interface. */
function orNull(slot: Node | null | undefined): Node | null {
  return slot ?? null;
}
/** Signals that a frame has no further children. */
const done = Symbol('walk-done');
/** Signals that a frame started stepping through an array; read the next slot. */
const stepping = Symbol('walk-stepping');

type N<T extends Node['Type']> = Extract<Node, { Type: T }>;

/**
 * Runs one walk on an explicit stack of suspended occurrences, so tree depth is
 * bounded by memory rather than by the native call stack. Every exception raised
 * while an occurrence is the innermost one (by its own work, its exit callback, or
 * a child's entry or unwinding) is delivered to that occurrence, which runs its
 * deferred comment exactly where upstream's defer would, with a replacement
 * exception taking over the pending one.
 */
function run(root: Node, callback: ICallback): void {
  const stack: IStack = { frames: [], depth: 0, nextCycleCheck: FIRST_CYCLE_CHECK_DEPTH };
  let failure: { readonly error: unknown } | undefined;
  enter(stack, root, callback);
  while (stack.depth > 0) {
    const frame = stack.frames[stack.depth - 1];
    try {
      if (failure !== undefined) {
        const error = failure;
        failure = undefined;
        if (frame.phase === PHASE_RUNNING && frame.deferred !== undefined) {
          // The unwind of an occurrence visits its deferred comment before the
          // exception continues; a failure from that visit replaces this one.
          const comment = frame.deferred;
          frame.deferred = undefined;
          frame.pending = error;
          frame.phase = PHASE_UNWINDING;
          enter(stack, comment, callback);
        } else {
          stack.depth--;
          failure = error;
        }
        continue;
      }
      if (frame.phase !== PHASE_RUNNING) {
        stack.depth--;
        failure = frame.pending;
        continue;
      }
      const child = nextChild(frame);
      if (child !== done) {
        enter(stack, child, callback);
      } else {
        invokeCallback(null, callback);
        if (frame.deferred === undefined) {
          stack.depth--;
        } else {
          const comment = frame.deferred;
          frame.deferred = undefined;
          frame.phase = PHASE_DEFERRING;
          enter(stack, comment, callback);
        }
      }
    } catch (error) {
      failure = { error };
    }
  }
  if (failure !== undefined) {
    throw failure.error;
  }
}

/**
 * Throws if `node` is already one of the first `depth` nodes on the active path. A
 * descent longer than the number of distinct nodes it passes through must repeat
 * one, so a cycle is found at the first check once the path is long enough; an
 * acyclic tree, shared subtrees included, never repeats a node on one path.
 */
function assertNoCycle(frames: readonly IFrame[], depth: number, node: Node): void {
  const path = new Set<Node>([node]);
  for (let level = 0; level < depth; level++) {
    const ancestor = frames[level].node;
    if (path.has(ancestor)) {
      throw new InputError(
        `Walk found a cycle: a ${ancestor.Type} node is its own ancestor, so the tree has no end`,
      );
    }
    path.add(ancestor);
  }
}

/**
 * Entry callback and, for a node with children, a pushed frame; childless nodes
 * finish here with their exit callback. Frames above the depth are recycled.
 */
function enter(stack: IStack, node: Node | null, callback: ICallback): void {
  if (!invokeCallback(node, callback)) {
    return;
  }
  if (node === null) {
    throw new WalkPanicError('syntax.Walk: unexpected node type <nil>');
  }
  if (node.Type === 'TypedNil') {
    if (node.Kind === 'BraceExp') {
      throw new WalkPanicError('syntax.Walk: unexpected node type *syntax.BraceExp');
    }
    if (node.Kind !== 'Lit' && node.Kind !== 'Comment' && node.Kind !== 'SglQuoted') {
      nilDereference();
    }
    invokeCallback(null, callback);
    return;
  }
  if (node.Type === 'Comment' || node.Type === 'Lit' || node.Type === 'SglQuoted') {
    invokeCallback(null, callback);
    return;
  }
  if (node.Type === 'BraceExp') {
    throw new WalkPanicError('syntax.Walk: unexpected node type *syntax.BraceExp');
  }
  const kind = KINDS.get(node.Type);
  if (kind === undefined) {
    const unexpected: never = node as never;
    throw new WalkPanicError(`syntax.Walk: unexpected node type ${String(unexpected)}`);
  }
  const { frames, depth } = stack;
  if (depth === stack.nextCycleCheck) {
    assertNoCycle(frames, depth, node);
    stack.nextCycleCheck = depth * 2;
  }
  if (depth === frames.length) {
    frames.push({
      node,
      kind,
      index: 0,
      phase: PHASE_RUNNING,
      flags: 0,
      run: RUN_NONE,
      items: null,
      cursor: 0,
      extent: 0,
      element: 'Stmt',
      deferred: undefined,
      pending: undefined,
    });
  } else {
    const frame = frames[depth];
    frame.node = node;
    frame.kind = kind;
    frame.index = 0;
    frame.phase = PHASE_RUNNING;
    frame.flags = 0;
    frame.run = RUN_NONE;
    frame.items = null;
    frame.deferred = undefined;
    frame.pending = undefined;
  }
  stack.depth = depth + 1;
}

/** Begins stepping through an array, capturing it and its extent now; false if it is empty. */
function begin(
  frame: IFrame,
  items: readonly (Node | null)[] | null,
  mode: number,
  element: IConcreteKind,
): boolean {
  if (items === null || items.length === 0) {
    return false;
  }
  frame.run = mode;
  frame.items = items;
  frame.cursor = 0;
  frame.extent = items.length;
  frame.element = element;
  return true;
}

/**
 * Returns the next child to visit, reading fields at the moment upstream would,
 * or `done` once every step is exhausted. A deferral decision may panic, which
 * the caller delivers to this occurrence.
 */
function nextChild(frame: IFrame): Node | null | typeof done {
  for (;;) {
    if (frame.run !== RUN_NONE) {
      if (frame.cursor === frame.extent) {
        frame.run = RUN_NONE;
        frame.items = null;
      } else {
        const slot = (frame.items ?? [])[frame.cursor++];
        switch (frame.run) {
          case RUN_POINTERS:
            return pointer(slot, frame.element);
          case RUN_INTERFACES:
            // A hole reaches the callback as null, as a nil interface does.
            return orNull(slot);
          default: {
            const comment = copyComment(slot as Comment);
            const deferral =
              frame.run === RUN_STMT_COMMENTS
                ? atStatementEnd(frame.node as N<'Stmt'>, comment.Hash)
                : afterItemStart(frame.node as N<'CaseItem' | 'ArrayElem'>, comment.Hash);
            if (deferral) {
              frame.deferred = comment;
              frame.run = RUN_NONE;
              frame.items = null;
              continue;
            }
            return comment;
          }
        }
      }
    }
    const child = step(frame);
    if (child !== stepping) {
      return child;
    }
  }
}

/**
 * The next step of a node's field order: returns its child, `stepping` when it
 * began an array run (or found nothing to visit and the next step should be taken),
 * or `done` after the last step. Each case falls through to the node's next field
 * when the current one has nothing to visit.
 */
function step(frame: IFrame): Node | null | typeof done | typeof stepping {
  const { node } = frame;
  switch (frame.kind) {
    case KIND_FILE:
    case KIND_STMT_LIST:
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (begin(frame, (node as N<'File'>).Stmts, RUN_POINTERS, 'Stmt')) return stepping;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (begin(frame, (node as N<'File'>).Last, RUN_POINTERS, 'Comment')) return stepping;
      }
      return done;
    case KIND_STMT: {
      const stmt = node as N<'Stmt'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (begin(frame, stmt.Comments, RUN_STMT_COMMENTS, 'Comment')) return stepping;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (stmt.Cmd !== null) return stmt.Cmd;
        // falls through
        case 2:
          frame.index = 2 + 1;
          if (begin(frame, stmt.Redirs, RUN_POINTERS, 'Redirect')) return stepping;
      }
      return done;
    }
    case KIND_ASSIGN: {
      const assign = node as N<'Assign'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (assign.Name !== null) return assign.Name;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (assign.Value !== null) return assign.Value;
        // falls through
        case 2:
          frame.index = 2 + 1;
          if (assign.Index !== null) return assign.Index;
        // falls through
        case 3:
          frame.index = 3 + 1;
          if (assign.Array !== null) return assign.Array;
      }
      return done;
    }
    case KIND_REDIRECT: {
      const redirect = node as N<'Redirect'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (redirect.N !== null) return redirect.N;
        // falls through
        case 1:
          frame.index = 1 + 1;
          return pointer(redirect.Word, 'Word');
        case 2:
          frame.index = 2 + 1;
          if (redirect.Hdoc !== null) return redirect.Hdoc;
      }
      return done;
    }
    case KIND_CALL_EXPR: {
      const call = node as N<'CallExpr'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (begin(frame, call.Assigns, RUN_POINTERS, 'Assign')) return stepping;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (begin(frame, call.Args, RUN_POINTERS, 'Word')) return stepping;
      }
      return done;
    }
    case KIND_IF_CLAUSE: {
      const clause = node as N<'IfClause'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (begin(frame, clause.Cond, RUN_POINTERS, 'Stmt')) return stepping;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (begin(frame, clause.CondLast, RUN_POINTERS, 'Comment')) return stepping;
        // falls through
        case 2:
          frame.index = 2 + 1;
          if (begin(frame, clause.Then, RUN_POINTERS, 'Stmt')) return stepping;
        // falls through
        case 3:
          frame.index = 3 + 1;
          if (begin(frame, clause.ThenLast, RUN_POINTERS, 'Comment')) return stepping;
        // falls through
        case 4:
          frame.index = 4 + 1;
          if (begin(frame, clause.Last, RUN_POINTERS, 'Comment')) return stepping;
        // falls through
        case 5:
          frame.index = 5 + 1;
          if (clause.Else !== null) return clause.Else;
      }
      return done;
    }
    case KIND_WHILE_CLAUSE: {
      const clause = node as N<'WhileClause'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (begin(frame, clause.Cond, RUN_POINTERS, 'Stmt')) return stepping;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (begin(frame, clause.CondLast, RUN_POINTERS, 'Comment')) return stepping;
        // falls through
        case 2:
          frame.index = 2 + 1;
          if (begin(frame, clause.Do, RUN_POINTERS, 'Stmt')) return stepping;
        // falls through
        case 3:
          frame.index = 3 + 1;
          if (begin(frame, clause.DoLast, RUN_POINTERS, 'Comment')) return stepping;
      }
      return done;
    }
    case KIND_FOR_CLAUSE: {
      const clause = node as N<'ForClause'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          return clause.Loop;
        case 1:
          frame.index = 1 + 1;
          if (begin(frame, clause.Do, RUN_POINTERS, 'Stmt')) return stepping;
        // falls through
        case 2:
          frame.index = 2 + 1;
          if (begin(frame, clause.DoLast, RUN_POINTERS, 'Comment')) return stepping;
      }
      return done;
    }
    case KIND_WORD_ITER: {
      const iter = node as N<'WordIter'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          return pointer(iter.Name, 'Lit');
        case 1:
          frame.index = 1 + 1;
          if (begin(frame, iter.Items, RUN_POINTERS, 'Word')) return stepping;
      }
      return done;
    }
    case KIND_C_STYLE_LOOP: {
      const loop = node as N<'CStyleLoop'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (loop.Init !== null) return loop.Init;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (loop.Cond !== null) return loop.Cond;
        // falls through
        case 2:
          frame.index = 2 + 1;
          if (loop.Post !== null) return loop.Post;
      }
      return done;
    }
    case KIND_BINARY_CMD: {
      const binary = node as N<'BinaryCmd'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          return pointer(binary.X, 'Stmt');
        case 1:
          frame.index = 1 + 1;
          return pointer(binary.Y, 'Stmt');
      }
      return done;
    }
    case KIND_FUNC_DECL: {
      const decl = node as N<'FuncDecl'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (decl.Name !== null) return decl.Name;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (begin(frame, decl.Names, RUN_POINTERS, 'Lit')) return stepping;
        // falls through
        case 2:
          frame.index = 2 + 1;
          return pointer(decl.Body, 'Stmt');
      }
      return done;
    }
    case KIND_PARTS:
      if (frame.index++ === 0) {
        if (begin(frame, (node as N<'Word'>).Parts, RUN_INTERFACES, 'Lit')) return stepping;
      }
      return done;
    case KIND_PARAM_EXP: {
      const param = node as N<'ParamExp'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (param.Flags !== null) return param.Flags;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (param.Param !== null) return param.Param;
        // falls through
        case 2:
          frame.index = 2 + 1;
          if (param.NestedParam !== null) return param.NestedParam;
        // falls through
        case 3:
          frame.index = 3 + 1;
          if (param.Index !== null) return param.Index;
        // falls through
        case 4:
          frame.index = 4 + 1;
          // An auxiliary is checked once, then re-read after callbacks may clear it.
          if (param.Slice !== null) {
            frame.flags |= SLICE_PRESENT;
            if (param.Slice.Offset !== null) return param.Slice.Offset;
          }
        // falls through
        case 5:
          frame.index = 5 + 1;
          if ((frame.flags & SLICE_PRESENT) !== 0) {
            const length = dereference(param.Slice).Length;
            if (length !== null) return length;
          }
        // falls through
        case 6:
          frame.index = 6 + 1;
          if (param.Repl !== null) {
            frame.flags |= REPL_PRESENT;
            if (param.Repl.Orig !== null) return param.Repl.Orig;
          }
        // falls through
        case 7:
          frame.index = 7 + 1;
          if ((frame.flags & REPL_PRESENT) !== 0) {
            const replacement = dereference(param.Repl).With;
            if (replacement !== null) return replacement;
          }
        // falls through
        case 8:
          frame.index = 8 + 1;
          if (param.Exp !== null && param.Exp.Word !== null) return param.Exp.Word;
      }
      return done;
    }
    case KIND_OPERAND:
      if (frame.index++ === 0) return (node as N<'ArithmExp'>).X;
      return done;
    case KIND_OPERANDS: {
      const binary = node as N<'BinaryArithm'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          return binary.X;
        case 1:
          frame.index = 1 + 1;
          return binary.Y;
      }
      return done;
    }
    case KIND_FLAGS_ARITHM: {
      const flags = node as N<'FlagsArithm'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          return pointer(flags.Flags, 'Lit');
        case 1:
          frame.index = 1 + 1;
          if (flags.X !== null) return flags.X;
      }
      return done;
    }
    case KIND_CASE_CLAUSE: {
      const clause = node as N<'CaseClause'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          return pointer(clause.Word, 'Word');
        case 1:
          frame.index = 1 + 1;
          if (begin(frame, clause.Items, RUN_POINTERS, 'CaseItem')) return stepping;
        // falls through
        case 2:
          frame.index = 2 + 1;
          if (begin(frame, clause.Last, RUN_POINTERS, 'Comment')) return stepping;
      }
      return done;
    }
    case KIND_CASE_ITEM: {
      const item = node as N<'CaseItem'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (begin(frame, item.Comments, RUN_ITEM_COMMENTS, 'Comment')) return stepping;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (begin(frame, item.Patterns, RUN_POINTERS, 'Word')) return stepping;
        // falls through
        case 2:
          frame.index = 2 + 1;
          if (begin(frame, item.Stmts, RUN_POINTERS, 'Stmt')) return stepping;
        // falls through
        case 3:
          frame.index = 3 + 1;
          if (begin(frame, item.Last, RUN_POINTERS, 'Comment')) return stepping;
      }
      return done;
    }
    case KIND_ARRAY_ELEM: {
      const elem = node as N<'ArrayElem'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (begin(frame, elem.Comments, RUN_ITEM_COMMENTS, 'Comment')) return stepping;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (elem.Index !== null) return elem.Index;
        // falls through
        case 2:
          frame.index = 2 + 1;
          if (elem.Value !== null) return elem.Value;
      }
      return done;
    }
    case KIND_DECL_CLAUSE:
      if (frame.index++ === 0) {
        if (begin(frame, (node as N<'DeclClause'>).Args, RUN_POINTERS, 'Assign')) return stepping;
      }
      return done;
    case KIND_ARRAY_EXPR: {
      const expr = node as N<'ArrayExpr'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (begin(frame, expr.Elems, RUN_POINTERS, 'ArrayElem')) return stepping;
        // falls through
        case 1:
          frame.index = 1 + 1;
          if (begin(frame, expr.Last, RUN_POINTERS, 'Comment')) return stepping;
      }
      return done;
    }
    case KIND_EXT_GLOB:
      if (frame.index++ === 0) return pointer((node as N<'ExtGlob'>).Pattern, 'Lit');
      return done;
    case KIND_TIME_CLAUSE:
      if (frame.index++ === 0 && (node as N<'TimeClause'>).Stmt !== null) {
        return (node as N<'TimeClause'>).Stmt;
      }
      return done;
    case KIND_COPROC_CLAUSE: {
      const clause = node as N<'CoprocClause'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          if (clause.Name !== null) return clause.Name;
        // falls through
        case 1:
          frame.index = 1 + 1;
          return pointer(clause.Stmt, 'Stmt');
      }
      return done;
    }
    case KIND_LET_CLAUSE:
      if (frame.index++ === 0) {
        if (begin(frame, (node as N<'LetClause'>).Exprs, RUN_INTERFACES, 'Lit')) return stepping;
      }
      return done;
    case KIND_TEST_DECL: {
      const decl = node as N<'TestDecl'>;
      switch (frame.index++) {
        case 0:
          frame.index = 0 + 1;
          return pointer(decl.Description, 'Word');
        case 1:
          frame.index = 1 + 1;
          return pointer(decl.Body, 'Stmt');
      }
      return done;
    }
  }
  return done;
}
