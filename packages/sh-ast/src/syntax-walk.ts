/**
 * Synchronous live dispatch of mvdan/sh's Walk case ordering. Child reads
 * occur when upstream reaches them; no precomputed trace or subtree transfer can
 * hide callback edits. Ordinary JavaScript arrays retain their own object identity;
 * Distinct Go slice headers, capacity and value-slot addresses over shared backing
 * storage are not represented. Ordinary JavaScript aliases remain shared.
 * Positional work is limited to live comment placement.
 *
 * Adapted from mvdan.cc/sh/v3 v3.13.1 syntax/walk.go, copyright Daniel Martí.
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
  visit(node, callback);
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

/** An unconditional concrete-pointer child is observable even when the pointer is nil. */
function pointer(node: Node | null, kind: IConcreteKind, callback: ICallback): void {
  visit(node ?? { Type: 'TypedNil', Kind: kind }, callback);
}
/** Optional fields skip null; a typed-nil interface is nevertheless a non-null interface. */
function optional(node: Node | null, callback: ICallback): void {
  if (node !== null) {
    visit(node, callback);
  }
}
/**
 * Captures one ordinary array and its initial extent when this list is reached.
 * Later existing slots are read live; appends and owner-field replacements cannot
 * extend or redirect the active list. Removing indices within its captured
 * extent is unsupported.
 */
function list(
  nodes: readonly (Node | null)[] | null,
  kind: IConcreteKind | null,
  callback: ICallback,
): void {
  if (nodes === null) {
    return;
  }
  const length = nodes.length;
  for (let index = 0; index < length; index++) {
    const node = nodes[index] ?? null;
    if (kind === null) {
      visit(node, callback);
    } else {
      pointer(node, kind, callback);
    }
  }
}
/**
 * Visits stored JavaScript Comment objects, unlike the copies used by item loops.
 * Later slot replacement is read live, but retained objects do not become Go
 * pointers to replacement values. The active array and extent remain captured.
 */
function comments(nodes: readonly Comment[] | null, callback: ICallback): void {
  if (nodes === null) {
    return;
  }
  const length = nodes.length;
  for (let index = 0; index < length; index++) {
    pointer(nodes[index] ?? null, 'Comment', callback);
  }
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
 * A single defer belongs to this occurrence. The try/finally surrounds all child
 * work and the null exit, preserving Go's unwind order and replacement exception.
 */
function visit(node: Node | null, callback: ICallback): void {
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
  let deferred: Comment | undefined;
  try {
    switch (node.Type) {
      case 'File':
        list(node.Stmts, 'Stmt', callback);
        comments(node.Last, callback);
        break;
      case 'Comment':
      case 'Lit':
      case 'SglQuoted':
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
          visit(value, callback);
        }
        optional(node.Cmd, callback);
        list(node.Redirs, 'Redirect', callback);
        break;
      }
      case 'Assign':
        optional(node.Name, callback);
        optional(node.Value, callback);
        optional(node.Index, callback);
        optional(node.Array, callback);
        break;
      case 'Redirect':
        optional(node.N, callback);
        pointer(node.Word, 'Word', callback);
        optional(node.Hdoc, callback);
        break;
      case 'CallExpr':
        list(node.Assigns, 'Assign', callback);
        list(node.Args, 'Word', callback);
        break;
      case 'Subshell':
      case 'Block':
      case 'CmdSubst':
      case 'ProcSubst':
        list(node.Stmts, 'Stmt', callback);
        comments(node.Last, callback);
        break;
      case 'IfClause':
        list(node.Cond, 'Stmt', callback);
        comments(node.CondLast, callback);
        list(node.Then, 'Stmt', callback);
        comments(node.ThenLast, callback);
        optional(node.Else, callback);
        break;
      case 'WhileClause':
        list(node.Cond, 'Stmt', callback);
        comments(node.CondLast, callback);
        list(node.Do, 'Stmt', callback);
        comments(node.DoLast, callback);
        break;
      case 'ForClause':
        visit(node.Loop, callback);
        list(node.Do, 'Stmt', callback);
        comments(node.DoLast, callback);
        break;
      case 'WordIter':
        pointer(node.Name, 'Lit', callback);
        list(node.Items, 'Word', callback);
        break;
      case 'CStyleLoop':
        optional(node.Init, callback);
        optional(node.Cond, callback);
        optional(node.Post, callback);
        break;
      case 'BinaryCmd':
        pointer(node.X, 'Stmt', callback);
        pointer(node.Y, 'Stmt', callback);
        break;
      case 'FuncDecl':
        optional(node.Name, callback);
        list(node.Names, 'Lit', callback);
        pointer(node.Body, 'Stmt', callback);
        break;
      case 'Word':
      case 'DblQuoted':
        list(node.Parts, null, callback);
        break;
      case 'ParamExp':
        optional(node.Flags, callback);
        optional(node.Param, callback);
        optional(node.NestedParam, callback);
        optional(node.Index, callback);
        if (node.Slice !== null) {
          optional(node.Slice.Offset, callback);
          optional(dereference(node.Slice).Length, callback);
        }
        if (node.Repl !== null) {
          optional(node.Repl.Orig, callback);
          optional(dereference(node.Repl).With, callback);
        }
        if (node.Exp !== null) {
          optional(node.Exp.Word, callback);
        }
        break;
      case 'ArithmExp':
      case 'ArithmCmd':
      case 'UnaryArithm':
      case 'UnaryTest':
      case 'ParenArithm':
      case 'ParenTest':
      case 'TestClause':
        visit(node.X, callback);
        break;
      case 'BinaryArithm':
      case 'BinaryTest':
        visit(node.X, callback);
        visit(node.Y, callback);
        break;
      case 'FlagsArithm':
        pointer(node.Flags, 'Lit', callback);
        optional(node.X, callback);
        break;
      case 'CaseClause':
        pointer(node.Word, 'Word', callback);
        list(node.Items, 'CaseItem', callback);
        comments(node.Last, callback);
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
          visit(value, callback);
        }
        if (node.Type === 'CaseItem') {
          list(node.Patterns, 'Word', callback);
          list(node.Stmts, 'Stmt', callback);
          comments(node.Last, callback);
        } else {
          optional(node.Index, callback);
          optional(node.Value, callback);
        }
        break;
      }
      case 'DeclClause':
        list(node.Args, 'Assign', callback);
        break;
      case 'ArrayExpr':
        list(node.Elems, 'ArrayElem', callback);
        comments(node.Last, callback);
        break;
      case 'ExtGlob':
        pointer(node.Pattern, 'Lit', callback);
        break;
      case 'TimeClause':
        optional(node.Stmt, callback);
        break;
      case 'CoprocClause':
        optional(node.Name, callback);
        pointer(node.Stmt, 'Stmt', callback);
        break;
      case 'LetClause':
        list(node.Exprs, null, callback);
        break;
      case 'TestDecl':
        pointer(node.Description, 'Word', callback);
        pointer(node.Body, 'Stmt', callback);
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
      visit(deferred, callback);
    }
  }
}
