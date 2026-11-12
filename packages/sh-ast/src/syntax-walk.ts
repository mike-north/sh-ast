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
 * A list of children reached by a node, read live by the driver. The array and its
 * extent are captured when the list is reached; later existing slots are read when
 * their turn comes, so callback edits within the captured extent are observed.
 * A non-null kind makes a nil slot visible as that concrete nil pointer.
 */
interface IListFrame {
  readonly nodes: readonly (Node | null)[];
  readonly length: number;
  readonly kind: IConcreteKind | null;
  index: number;
}
/** A node's remaining work, suspended between children. */
type INodeFrame = Generator<Node | IListFrame | null, void, undefined>;
/** A list with nothing to visit; shared because the driver never advances an exhausted list. */
const EMPTY_LIST: IListFrame = { nodes: [], length: 0, kind: null, index: 0 };
/** Starts a list of children, capturing its array and extent as upstream's range does. */
function list(nodes: readonly (Node | null)[] | null, kind: IConcreteKind | null): IListFrame {
  return nodes === null || nodes.length === 0
    ? EMPTY_LIST
    : { nodes, length: nodes.length, kind, index: 0 };
}
/** An unconditional concrete-pointer child is observable even when the pointer is nil. */
function pointer(node: Node | null, kind: IConcreteKind): Node {
  return node ?? { Type: 'TypedNil', Kind: kind };
}
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
 * Runs one walk on an explicit stack of suspended occurrences, so tree depth is
 * bounded by memory rather than by the native call stack. The stack holds, per
 * entered occurrence that has children, either its suspended generator or a live
 * child list. The driver delivers a child's failure to its parent exactly where a
 * recursive call would have unwound, so each occurrence's defer and replacement
 * exception behave as in the recursive formulation.
 */
function run(root: Node, callback: ICallback): void {
  const stack: (INodeFrame | IListFrame)[] = [];
  enter(root, callback, stack);
  let failure: { readonly error: unknown } | undefined;
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (!isNodeFrame(top)) {
      // A list has no unwind work of its own: a failure just leaves it.
      if (failure !== undefined || top.index >= top.length) {
        stack.pop();
        continue;
      }
      const slot = top.nodes[top.index++] ?? null;
      try {
        enter(top.kind === null ? slot : pointer(slot, top.kind), callback, stack);
      } catch (error) {
        failure = { error };
      }
      continue;
    }
    let step: IteratorResult<Node | IListFrame | null, void>;
    try {
      step = failure === undefined ? top.next() : top.throw(failure.error);
      failure = undefined;
    } catch (error) {
      // The occurrence itself ended with an exception (its own, or the original
      // one if its defer completed normally); the parent receives it next.
      stack.pop();
      failure = { error };
      continue;
    }
    if (step.done === true) {
      stack.pop();
      continue;
    }
    const child = step.value;
    if (child !== null && 'nodes' in child) {
      stack.push(child);
      continue;
    }
    try {
      enter(child, callback, stack);
    } catch (error) {
      failure = { error };
    }
  }
  if (failure !== undefined) {
    throw failure.error;
  }
}

/** Distinguishes a suspended node from a child list on the shared stack. */
function isNodeFrame(frame: INodeFrame | IListFrame): frame is INodeFrame {
  return !('nodes' in frame);
}

/**
 * Handles one occurrence's entry callback and, for a node with children, opens its
 * frame on the stack. Childless nodes complete here with their null exit.
 */
function enter(node: Node | null, callback: ICallback, stack: (INodeFrame | IListFrame)[]): void {
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
  stack.push(children(node, callback));
}

/**
 * The child work of one entered node. A single defer belongs to this occurrence;
 * the try/finally surrounds all child work and the null exit, preserving Go's
 * unwind order and replacement exception. Each yield hands the driver one child
 * (or child list) to visit before this body continues.
 */
function* children(
  node: Exclude<Node, { Type: 'TypedNil' | 'Comment' | 'Lit' | 'SglQuoted' }>,
  callback: ICallback,
): INodeFrame {
  let deferred: Comment | undefined;
  try {
    switch (node.Type) {
      case 'File':
        yield list(node.Stmts, 'Stmt');
        yield list(node.Last, 'Comment');
        break;
      case 'Stmt': {
        const values = node.Comments;
        const length = values?.length ?? 0;
        for (let index = 0; values !== null && index < length; index++) {
          const value = copyComment(values[index]);
          if (atStatementEnd(node, value.Hash)) {
            deferred = value;
            break;
          }
          yield value;
        }
        if (node.Cmd !== null) yield node.Cmd;
        yield list(node.Redirs, 'Redirect');
        break;
      }
      case 'Assign':
        if (node.Name !== null) yield node.Name;
        if (node.Value !== null) yield node.Value;
        if (node.Index !== null) yield node.Index;
        if (node.Array !== null) yield node.Array;
        break;
      case 'Redirect':
        if (node.N !== null) yield node.N;
        yield pointer(node.Word, 'Word');
        if (node.Hdoc !== null) yield node.Hdoc;
        break;
      case 'CallExpr':
        yield list(node.Assigns, 'Assign');
        yield list(node.Args, 'Word');
        break;
      case 'Subshell':
      case 'Block':
      case 'CmdSubst':
      case 'ProcSubst':
        yield list(node.Stmts, 'Stmt');
        yield list(node.Last, 'Comment');
        break;
      case 'IfClause':
        yield list(node.Cond, 'Stmt');
        yield list(node.CondLast, 'Comment');
        yield list(node.Then, 'Stmt');
        yield list(node.ThenLast, 'Comment');
        yield list(node.Last, 'Comment');
        if (node.Else !== null) yield node.Else;
        break;
      case 'WhileClause':
        yield list(node.Cond, 'Stmt');
        yield list(node.CondLast, 'Comment');
        yield list(node.Do, 'Stmt');
        yield list(node.DoLast, 'Comment');
        break;
      case 'ForClause':
        yield node.Loop;
        yield list(node.Do, 'Stmt');
        yield list(node.DoLast, 'Comment');
        break;
      case 'WordIter':
        yield pointer(node.Name, 'Lit');
        yield list(node.Items, 'Word');
        break;
      case 'CStyleLoop':
        if (node.Init !== null) yield node.Init;
        if (node.Cond !== null) yield node.Cond;
        if (node.Post !== null) yield node.Post;
        break;
      case 'BinaryCmd':
        yield pointer(node.X, 'Stmt');
        yield pointer(node.Y, 'Stmt');
        break;
      case 'FuncDecl':
        if (node.Name !== null) yield node.Name;
        yield list(node.Names, 'Lit');
        yield pointer(node.Body, 'Stmt');
        break;
      case 'Word':
      case 'DblQuoted':
        yield list(node.Parts, null);
        break;
      case 'ParamExp':
        if (node.Flags !== null) yield node.Flags;
        if (node.Param !== null) yield node.Param;
        if (node.NestedParam !== null) yield node.NestedParam;
        if (node.Index !== null) yield node.Index;
        if (node.Slice !== null) {
          if (node.Slice.Offset !== null) yield node.Slice.Offset;
          const length = dereference(node.Slice).Length;
          if (length !== null) yield length;
        }
        if (node.Repl !== null) {
          if (node.Repl.Orig !== null) yield node.Repl.Orig;
          const replacement = dereference(node.Repl).With;
          if (replacement !== null) yield replacement;
        }
        if (node.Exp !== null) {
          if (node.Exp.Word !== null) yield node.Exp.Word;
        }
        break;
      case 'ArithmExp':
      case 'ArithmCmd':
      case 'UnaryArithm':
      case 'UnaryTest':
      case 'ParenArithm':
      case 'ParenTest':
      case 'TestClause':
        yield node.X;
        break;
      case 'BinaryArithm':
      case 'BinaryTest':
        yield node.X;
        yield node.Y;
        break;
      case 'FlagsArithm':
        yield pointer(node.Flags, 'Lit');
        if (node.X !== null) yield node.X;
        break;
      case 'CaseClause':
        yield pointer(node.Word, 'Word');
        yield list(node.Items, 'CaseItem');
        yield list(node.Last, 'Comment');
        break;
      case 'CaseItem':
      case 'ArrayElem': {
        const values = node.Comments;
        const length = values?.length ?? 0;
        for (let index = 0; values !== null && index < length; index++) {
          const value = copyComment(values[index]);
          if (afterItemStart(node, value.Hash)) {
            deferred = value;
            break;
          }
          yield value;
        }
        if (node.Type === 'CaseItem') {
          yield list(node.Patterns, 'Word');
          yield list(node.Stmts, 'Stmt');
          yield list(node.Last, 'Comment');
        } else {
          if (node.Index !== null) yield node.Index;
          if (node.Value !== null) yield node.Value;
        }
        break;
      }
      case 'DeclClause':
        yield list(node.Args, 'Assign');
        break;
      case 'ArrayExpr':
        yield list(node.Elems, 'ArrayElem');
        yield list(node.Last, 'Comment');
        break;
      case 'ExtGlob':
        yield pointer(node.Pattern, 'Lit');
        break;
      case 'TimeClause':
        if (node.Stmt !== null) yield node.Stmt;
        break;
      case 'CoprocClause':
        if (node.Name !== null) yield node.Name;
        yield pointer(node.Stmt, 'Stmt');
        break;
      case 'LetClause':
        yield list(node.Exprs, null);
        break;
      case 'TestDecl':
        yield pointer(node.Description, 'Word');
        yield pointer(node.Body, 'Stmt');
        break;
      case 'BraceExp':
        throw new WalkPanicError('syntax.Walk: unexpected node type *syntax.BraceExp');
      default: {
        const exhaustive: never = node;
        throw new WalkPanicError(`syntax.Walk: unexpected node type ${String(exhaustive)}`);
      }
    }
    invokeCallback(null, callback);
  } finally {
    if (deferred !== undefined) {
      yield deferred;
    }
  }
}
