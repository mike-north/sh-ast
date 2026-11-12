/**
 * Private live boundary evaluation for Walk's comment placement. These methods
 * mirror the pinned mvdan/sh node methods so callback edits are visible without
 * repeatedly serializing subtrees to WASM. They are not public position APIs.
 *
 * Adapted from mvdan.cc/sh/v3 v3.14.1 syntax/nodes.go, copyright Daniel Martí.
 * The upstream BSD license is retained in syntax-walk-license.ts.
 */
import type { Node, SyntaxPos } from '../generated/syntax-types.js';
import { nilDereference, WalkPanicError } from './syntax-walk-errors.js';

/**
 * Internal Pos value keeps uint32 arithmetic and raw-offset ordering intact.
 * @internal
 */
export interface IPosition {
  readonly offset: number;
  readonly lineCol: number;
}
/** Largest upstream source offset; the remaining high values are invalid sentinels. */
const OFFSET_MAX = 0xffff_fff4;
/** Ordinary zero Pos, distinct from a recovered token. */
const ZERO: IPosition = { offset: 0, lineCol: 0 };

/** Serialized invalid offsets share all ordering behavior relevant to Walk. */
function unpack(pos: SyntaxPos): IPosition {
  return {
    offset: pos.OffsetOverflow ? OFFSET_MAX + 1 : pos.Offset,
    lineCol: ((pos.Line << 14) | pos.Col) >>> 0,
  };
}
/** Upstream validity depends on both packed coordinates and raw offset. */
function valid(pos: IPosition): boolean {
  return pos.offset <= OFFSET_MAX && pos.lineCol !== 0;
}
/** Upstream clamps offsets and drops overflowing columns without changing lines. */
function add(pos: IPosition, n: number): IPosition {
  if (!valid(pos)) {
    return pos;
  }
  const previousColumn = pos.lineCol & 0x3fff;
  const column = previousColumn > 0 ? previousColumn + n : 0;
  return {
    offset: Math.min(Math.max(pos.offset + n, 0), OFFSET_MAX),
    lineCol: ((pos.lineCol & ~0x3fff) | (column >= 1 && column <= 0x3fff ? column : 0)) >>> 0,
  };
}
/** Only the left operand must be valid; a right ordinary-invalid offset still orders. */
function after(left: IPosition, right: IPosition): boolean {
  return valid(left) && left.offset > right.offset;
}
/** Upstream retains the first position unless the second is observably after it. */
function maximum(left: IPosition, right: IPosition): IPosition {
  return after(right, left) ? right : left;
}
/** A nil list and an empty list share indexed-access panic behavior. */
function at<T>(values: readonly T[] | null, index: number): T {
  const length = values?.length ?? 0;
  if (values === null || index < 0 || index >= length) {
    throw new WalkPanicError(
      index < 0
        ? `runtime error: index out of range [${String(index)}]`
        : `runtime error: index out of range [${String(index)}] with length ${String(length)}`,
    );
  }
  return values[index];
}
/** Nil pointers and nil interfaces both fail when a bound method dereferences them. */
function concrete(node: Node | null): Exclude<Node, { Type: 'TypedNil' }> {
  if (node === null || node.Type === 'TypedNil') {
    return nilDereference();
  }
  return node;
}
/**
 * A bound evaluation suspended on the bounds it depends on. Each yield names a
 * node whose bound is needed; the driver resumes the evaluation with that bound.
 * This keeps spines such as a long BinaryArithm.X chain off the native stack.
 */
type IEvaluation = Generator<Node | null, IPosition, IPosition>;

/**
 * Evaluates one bound by running its dependencies on an explicit stack, in the
 * same order as direct recursion, so a panic is raised by the same dependency.
 */
function evaluate(root: Node | null, bound: (node: Node | null) => IEvaluation): IPosition {
  const stack = [bound(root)];
  let result = ZERO;
  for (;;) {
    const step = stack[stack.length - 1].next(result);
    if (step.done === true) {
      stack.pop();
      result = step.value;
      if (stack.length === 0) {
        return result;
      }
    } else {
      stack.push(bound(step.value));
    }
  }
}
/**
 * Only WordPart/ArithmExpr positions are reachable from comment placement.
 * @internal
 */
export function position(value: Node | null): IPosition {
  return evaluate(value, positionOf);
}
/** The evaluation behind position: one level, with dependencies yielded. */
function* positionOf(value: Node | null): IEvaluation {
  const node = concrete(value);
  switch (node.Type) {
    case 'CaseItem':
      return yield at(node.Patterns, 0);
    case 'ArrayElem':
      return yield node.Index ?? node.Value;
    case 'Word':
      return yield at(node.Parts, 0);
    case 'Lit':
      return unpack(node.ValuePos);
    case 'SglQuoted':
    case 'DblQuoted':
    case 'CmdSubst':
    case 'ArithmExp':
      return unpack(node.Left);
    case 'ParamExp':
      return node.Dollar.IsValid ? unpack(node.Dollar) : yield node.Param;
    case 'ProcSubst':
    case 'ExtGlob':
      return unpack(node.OpPos);
    case 'BraceExp':
      return add(yield at(node.Elems, 0), -1);
    case 'BinaryArithm':
      return yield node.X;
    case 'UnaryArithm':
      return node.Post ? yield node.X : unpack(node.OpPos);
    case 'ParenArithm':
      return unpack(node.Lparen);
    case 'FlagsArithm':
      return add(yield node.Flags, -1);
    default:
      throw new WalkPanicError(`syntax.Walk: unexpected position dependency *syntax.${node.Type}`);
  }
}
/**
 * End follows the current fields, and is evaluated only when a Stmt has comments.
 * @internal
 */
export function end(value: Node | null): IPosition {
  return evaluate(value, endOf);
}
/** The evaluation behind end: one level, with dependencies yielded. */
function* endOf(value: Node | null): IEvaluation {
  const node = concrete(value);
  switch (node.Type) {
    case 'Stmt': {
      if (node.Semicolon.IsValid) {
        const semicolonEnd = add(unpack(node.Semicolon), 1);
        return node.Coprocess || node.Disown ? add(semicolonEnd, 1) : semicolonEnd;
      }
      let result = node.Negated ? add(unpack(node.Position), 1) : unpack(node.Position);
      if (node.Cmd !== null) {
        result = yield node.Cmd;
      }
      if (node.Redirs?.length) {
        result = maximum(result, yield at(node.Redirs, node.Redirs.length - 1));
      }
      return result;
    }
    case 'CallExpr':
      return node.Args?.length
        ? yield at(node.Args, node.Args.length - 1)
        : yield at(node.Assigns, (node.Assigns?.length ?? 0) - 1);
    case 'Assign':
      if (node.Value !== null) {
        return yield node.Value;
      }
      if (node.Array !== null) {
        return yield node.Array;
      }
      if (node.Index !== null) {
        return add(yield node.Index, node.Naked ? 1 : 2);
      }
      return node.Naked ? yield node.Name : add(yield node.Name, 1);
    case 'Redirect':
      return yield node.Hdoc ?? node.Word;
    case 'Subshell':
    case 'ArrayExpr':
    case 'ProcSubst':
    case 'ParenArithm':
    case 'ParenTest':
      return add(unpack(node.Rparen), 1);
    case 'Block':
      return add(unpack(node.Rbrace), 1);
    case 'IfClause':
      return add(unpack(node.FiPos), 2);
    case 'ForClause':
      return add(unpack(node.DonePos), node.Braces ? 1 : 4);
    case 'WhileClause':
      return add(unpack(node.DonePos), 4);
    case 'BinaryCmd':
    case 'BinaryArithm':
    case 'BinaryTest':
      return yield node.Y;
    case 'FuncDecl':
    case 'TestDecl':
      return yield node.Body;
    case 'Word':
      return yield at(node.Parts, (node.Parts?.length ?? 0) - 1);
    case 'Lit':
      return unpack(node.ValueEnd);
    case 'SglQuoted':
    case 'DblQuoted':
    case 'CmdSubst':
      return add(unpack(node.Right), 1);
    case 'ParamExp':
      return !node.Short
        ? add(unpack(node.Rbrace), 1)
        : node.Index !== null
          ? add(yield node.Index, 1)
          : yield node.Param;
    case 'ArithmExp':
      return add(unpack(node.Right), node.Bracket ? 1 : 2);
    case 'ArithmCmd':
    case 'TestClause':
      return add(unpack(node.Right), 2);
    case 'UnaryArithm':
      return node.Post ? add(unpack(node.OpPos), 2) : yield node.X;
    case 'UnaryTest':
      return yield node.X;
    case 'FlagsArithm':
      return node.X !== null ? yield node.X : add(yield node.Flags, 1);
    case 'CaseClause':
      return add(unpack(node.Esac), node.Braces ? 1 : 4);
    case 'DeclClause':
      return node.Args?.length ? yield at(node.Args, node.Args.length - 1) : yield node.Variant;
    case 'ExtGlob':
      return add(yield node.Pattern, 1);
    case 'TimeClause':
      return node.Stmt === null ? add(unpack(node.Time), 4) : yield node.Stmt;
    case 'CoprocClause':
      return yield node.Stmt;
    case 'LetClause':
      return yield at(node.Exprs, (node.Exprs?.length ?? 0) - 1);
    case 'BraceExp':
      return add(node.Elems?.length ? yield at(node.Elems, node.Elems.length - 1) : ZERO, 1);
    default:
      throw new WalkPanicError(`syntax.Walk: unexpected end dependency *syntax.${node.Type}`);
  }
}
/** Stmt comments at or after the live end become the single deferred comment. @internal */
export function atStatementEnd(node: Extract<Node, { Type: 'Stmt' }>, hash: SyntaxPos): boolean {
  return !after(end(node), unpack(hash));
}
/** Case/array comments strictly after the live start become deferred. @internal */
export function afterItemStart(
  node: Extract<Node, { Type: 'CaseItem' | 'ArrayElem' }>,
  hash: SyntaxPos,
): boolean {
  return after(unpack(hash), position(node));
}
