import type { ShNode } from '../types.js';
import { isShNodeShape, nodeArray } from './node-helpers.js';
import { resolveWord } from './resolve-word.js';
import type { WordResolution } from './resolve-word.js';

/**
 * A single frame of the path from the root of the tree down to a
 * {@link CommandSite}, describing *how* the command is reached — never
 * whether it is safe to run. `CommandSite.context` is an ordered stack of
 * these, outermost frame first:
 *
 * - `'and'`/`'or'` (`side: 'right'`) — the right-hand operand of a
 *   `BinaryCmd` (mvdan/sh's node for both `&&` and `||`); only the right
 *   side is tagged; the left side inherits the surrounding context
 *   unchanged, since it runs unconditionally relative to this operator.
 * - `'pipeline'` (`stage: n`) — one stage of a `|`/`|&` chain (also a
 *   `BinaryCmd`, left-associatively nested by mvdan/sh); every stage is
 *   tagged, 0-indexed left to right, regardless of whether the chain mixes
 *   `|` and `|&`.
 * - `'subshell'` — inside a `Subshell` (`( ... )`).
 * - `'cmdSubst'`/`'procSubst'` — inside a `CmdSubst` (`$(...)`/backticks) or
 *   `ProcSubst` (`<(...)`/`>(...)`) reached from *any* word-bearing
 *   position (an argument, a redirection target, a case subject, a loop's
 *   word list, an assignment value, a test/arithmetic operand, …) — not
 *   only from `CallExpr.args`.
 * - `'if'` (`branch: 'cond' | 'then' | 'else'`) — inside an `IfClause`'s
 *   condition, then-branch, or else-branch (mvdan/sh nests `elif` chains as
 *   `IfClause.else` pointing to another `IfClause`, so an `elif`'s own
 *   condition/then are reached through an `{kind:'if',branch:'else'}` frame
 *   first, then their own `'cond'`/`'then'` frame — reflecting the real
 *   nesting rather than collapsing it).
 * - `'case'` — inside one `CaseClause` branch's statement list (not the
 *   case subject word or the patterns).
 * - `'loop'` (`role` is `'body'` or `'cond'`) — inside a `ForClause`'s
 *   statement list (`role: 'body'` only — a `for` loop has no
 *   statement-list condition) or a `WhileClause`'s (`role: 'cond'` for the
 *   condition, `role: 'body'` for the loop body).
 * - `'function'` (`name`) — inside a `FuncDecl`'s body; `name` is the
 *   function's literal name text.
 * - `'background'`/`'negated'` — the enclosing `Stmt` has mvdan/sh's
 *   Background/Negated flag set (`cmd &`, `! cmd`).
 * - `'coproc'` — inside a `CoprocClause`'s statement (a `coproc` block,
 *   optionally named).
 *
 * A `Block` grouping (`{ ...; }`) and a `TimeClause` (`time cmd`) are
 * deliberately transparent — grouping and timing a command doesn't change
 * how it's reached, so no frame is added for either.
 *
 * @public
 */
export type CommandContext =
  | { readonly kind: 'and'; readonly side: 'right' }
  | { readonly kind: 'or'; readonly side: 'right' }
  | { readonly kind: 'pipeline'; readonly stage: number }
  | { readonly kind: 'subshell' }
  | { readonly kind: 'cmdSubst' }
  | { readonly kind: 'procSubst' }
  | { readonly kind: 'if'; readonly branch: 'then' | 'else' | 'cond' }
  | { readonly kind: 'case' }
  | { readonly kind: 'loop'; readonly role: 'body' | 'cond' }
  | { readonly kind: 'function'; readonly name: string }
  | { readonly kind: 'background' }
  | { readonly kind: 'negated' }
  | { readonly kind: 'coproc' };

/**
 * One place in the tree where a command is actually invoked — a `CallExpr`
 * node, together with its resolved words and the path used to reach it.
 * Facts only, matching {@link resolveWord}'s posture: no safety verdict, no
 * hardcoded command/wrapper list. A dynamic (`static: false`) `argv0` is a
 * normal, expected result — not an error and not itself reported as
 * "unknown"/"unsafe".
 *
 * @public
 */
export interface CommandSite {
  /** The `CallExpr` node this site was found at. */
  readonly node: ShNode;
  /**
   * `resolveWord` applied to the first word (`argv[0]`), with
   * `{ context: 'command-argument' }` — every `CallExpr` word is an
   * ordinary command-argument position, never an assignment value, so
   * only a word-initial unquoted `~` triggers tilde expansion (an
   * unquoted `~` after a `:`, e.g. `a:~/b`, is literal text here — see
   * `ResolveWordOptions.context`'s doc comment).
   */
  readonly argv0: WordResolution;
  /** `resolveWord` applied to every word, in argument order (same `{ context: 'command-argument' }` as {@link CommandSite.argv0}). */
  readonly argv: readonly WordResolution[];
  /** The path from the tree root to this site, outermost frame first. */
  readonly context: readonly CommandContext[];
}

/**
 * mvdan/sh v3.13.1's `syntax.BinCmdOperator` token values for `BinaryCmd.Op`
 * — `AndStmt` (`&&`), `OrStmt` (`||`), `Pipe` (`|`), `PipeAll` (`|&`). These
 * are not part of any documented wire contract (`normalize()` copies
 * mvdan/sh's raw numeric token straight through — see design/ARCHITECTURE.md
 * open question 4), so they're pinned here by empirical observation against
 * this bridge's own shim rather than derived from an upstream constant, and
 * locked in by a canary test (`enumerate-commands.test.ts`, "binary command
 * operator identification") that would fail loudly if a future mvdan/sh
 * version renumbered them.
 */
const BIN_CMD_OP_AND = 11;
const BIN_CMD_OP_OR = 12;
const BIN_CMD_OP_PIPE = 13;
const BIN_CMD_OP_PIPE_ALL = 14;

function isPipeOp(op: unknown): boolean {
  return op === BIN_CMD_OP_PIPE || op === BIN_CMD_OP_PIPE_ALL;
}

function pushContext(
  context: readonly CommandContext[],
  frame: CommandContext,
): readonly CommandContext[] {
  return [...context, frame];
}

/**
 * Scans `value` — a word, an assignment, a test/arithmetic expression, a
 * redirect, or an array of any of these — for `CmdSubst`/`ProcSubst`
 * boundaries reachable from it, however deeply nested (through
 * `DblQuoted`, `ParamExp`'s `Exp`/`Repl`/`Slice`/`nestedparam`, array
 * elements, arithmetic operands, …), and hands each one found off to
 * {@link visitStmtList} with the corresponding context frame pushed. This is
 * a plain structural walk (discover children the same way {@link walk}
 * does) rather than a hand-modeled traversal of every one of mvdan/sh's
 * expression-shaped fields, because that set is large and not the part of
 * the grammar this module's context-aware descent is about — the
 * *command*-bearing structure (`BinaryCmd`, `IfClause`, loops, …) is
 * hand-modeled in {@link visitCommand}; this helper's only job is finding
 * where a word-shaped subtree stops being "just an expression" and starts
 * containing statements again.
 */
function scanForHiddenCommands(
  value: unknown,
  context: readonly CommandContext[],
  sites: CommandSite[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) scanForHiddenCommands(item, context, sites);
    return;
  }
  if (!isShNodeShape(value)) return;
  if (value.type === 'CmdSubst') {
    visitStmtList(nodeArray(value.stmts), pushContext(context, { kind: 'cmdSubst' }), sites);
    return;
  }
  if (value.type === 'ProcSubst') {
    visitStmtList(nodeArray(value.stmts), pushContext(context, { kind: 'procSubst' }), sites);
    return;
  }
  for (const field of Object.values(value)) {
    scanForHiddenCommands(field, context, sites);
  }
}

function visitStmtList(
  stmts: readonly ShNode[],
  context: readonly CommandContext[],
  sites: CommandSite[],
): void {
  for (const stmt of stmts) visitStmt(stmt, context, sites);
}

function visitStmt(stmt: ShNode, context: readonly CommandContext[], sites: CommandSite[]): void {
  let stmtContext = context;
  if (stmt.negated === true) stmtContext = pushContext(stmtContext, { kind: 'negated' });
  if (stmt.background === true) stmtContext = pushContext(stmtContext, { kind: 'background' });
  scanForHiddenCommands(stmt.redirs, stmtContext, sites);
  const cmd = stmt.cmd;
  if (isShNodeShape(cmd)) visitCommand(cmd, stmtContext, sites);
}

/**
 * Recovers the left-to-right stages of a `|`/`|&` pipeline from `cmd` (a
 * `BinaryCmd` whose own `Op` is already known to be a pipe-family
 * operator). mvdan/sh nests these left-associatively — `a | b | c` is
 * `BinaryCmd(x: Stmt{BinaryCmd(x: a, y: b)}, y: Stmt{c})` — so recovering
 * stages means recursing into `x`'s `Stmt.cmd` while it's still a
 * pipe-family `BinaryCmd`, not `x` itself (`x`/`y` are always `Stmt` nodes,
 * one level removed from the `BinaryCmd`). Mixed `|`/`|&` chains flatten
 * into a single pipeline (this bridge doesn't distinguish "stderr also
 * piped" in {@link CommandContext} — only stage position).
 */
function flattenPipelineStages(cmd: ShNode): ShNode[] {
  const stages: ShNode[] = [];
  const collect = (operandStmt: unknown): void => {
    if (!isShNodeShape(operandStmt)) return;
    const innerCmd = operandStmt.cmd;
    if (isShNodeShape(innerCmd) && innerCmd.type === 'BinaryCmd' && isPipeOp(innerCmd.op)) {
      collect(innerCmd.x);
      collect(innerCmd.y);
    } else {
      stages.push(operandStmt);
    }
  };
  collect(cmd.x);
  collect(cmd.y);
  return stages;
}

function visitBinaryCmd(
  cmd: ShNode,
  context: readonly CommandContext[],
  sites: CommandSite[],
): void {
  const op = cmd.op;
  if (isPipeOp(op)) {
    const stages = flattenPipelineStages(cmd);
    stages.forEach((stage, index) => {
      visitStmt(stage, pushContext(context, { kind: 'pipeline', stage: index }), sites);
    });
    return;
  }
  const x = cmd.x;
  const y = cmd.y;
  if (isShNodeShape(x)) visitStmt(x, context, sites);
  if (!isShNodeShape(y)) return;
  if (op === BIN_CMD_OP_AND) {
    visitStmt(y, pushContext(context, { kind: 'and', side: 'right' }), sites);
  } else if (op === BIN_CMD_OP_OR) {
    visitStmt(y, pushContext(context, { kind: 'or', side: 'right' }), sites);
  } else {
    // A `BinaryCmd.Op` this module doesn't specifically recognize (a future
    // mvdan/sh operator) — still visit the right side with the unchanged
    // context rather than silently dropping a real command site.
    visitStmt(y, context, sites);
  }
}

function visitIfClause(
  clause: ShNode,
  context: readonly CommandContext[],
  sites: CommandSite[],
): void {
  visitStmtList(
    nodeArray(clause.cond),
    pushContext(context, { kind: 'if', branch: 'cond' }),
    sites,
  );
  visitStmtList(
    nodeArray(clause.then),
    pushContext(context, { kind: 'if', branch: 'then' }),
    sites,
  );
  const elseClause = clause.else;
  if (isShNodeShape(elseClause)) {
    visitIfClause(elseClause, pushContext(context, { kind: 'if', branch: 'else' }), sites);
  }
}

function visitCommand(cmd: ShNode, context: readonly CommandContext[], sites: CommandSite[]): void {
  switch (cmd.type) {
    case 'CallExpr': {
      scanForHiddenCommands(cmd.assigns, context, sites);
      scanForHiddenCommands(cmd.args, context, sites);
      const args = nodeArray(cmd.args);
      if (args.length > 0) {
        const argv = args.map((word) => resolveWord(word, { context: 'command-argument' }));
        sites.push({ node: cmd, argv0: argv[0], argv, context });
      }
      return;
    }
    case 'BinaryCmd':
      visitBinaryCmd(cmd, context, sites);
      return;
    case 'Block':
      // Transparent grouping (`{ ...; }`) — no context frame.
      visitStmtList(nodeArray(cmd.stmts), context, sites);
      return;
    case 'Subshell':
      visitStmtList(nodeArray(cmd.stmts), pushContext(context, { kind: 'subshell' }), sites);
      return;
    case 'IfClause':
      visitIfClause(cmd, context, sites);
      return;
    case 'CaseClause': {
      scanForHiddenCommands(cmd.word, context, sites);
      for (const item of nodeArray(cmd.items)) {
        scanForHiddenCommands(item.patterns, context, sites);
        visitStmtList(nodeArray(item.stmts), pushContext(context, { kind: 'case' }), sites);
      }
      return;
    }
    case 'ForClause': {
      scanForHiddenCommands(cmd.loop, context, sites);
      visitStmtList(nodeArray(cmd.do), pushContext(context, { kind: 'loop', role: 'body' }), sites);
      return;
    }
    case 'WhileClause': {
      visitStmtList(
        nodeArray(cmd.cond),
        pushContext(context, { kind: 'loop', role: 'cond' }),
        sites,
      );
      visitStmtList(nodeArray(cmd.do), pushContext(context, { kind: 'loop', role: 'body' }), sites);
      return;
    }
    case 'FuncDecl': {
      const name = cmd.name;
      const nameText = isShNodeShape(name) && typeof name.value === 'string' ? name.value : '';
      const body = cmd.body;
      if (isShNodeShape(body)) {
        visitStmt(body, pushContext(context, { kind: 'function', name: nameText }), sites);
      }
      return;
    }
    case 'CoprocClause': {
      scanForHiddenCommands(cmd.name, context, sites);
      const stmt = cmd.stmt;
      if (isShNodeShape(stmt)) visitStmt(stmt, pushContext(context, { kind: 'coproc' }), sites);
      return;
    }
    case 'DeclClause':
      scanForHiddenCommands(cmd.args, context, sites);
      return;
    case 'LetClause':
      scanForHiddenCommands(cmd.exprs, context, sites);
      return;
    case 'TestClause':
      scanForHiddenCommands(cmd.x, context, sites);
      return;
    case 'ArithmCmd':
      scanForHiddenCommands(cmd.x, context, sites);
      return;
    case 'TestDecl': {
      scanForHiddenCommands(cmd.description, context, sites);
      const body = cmd.body;
      if (isShNodeShape(body)) visitStmt(body, context, sites);
      return;
    }
    case 'TimeClause': {
      // Transparent (`time cmd`) — no context frame.
      const stmt = cmd.stmt;
      if (isShNodeShape(stmt)) visitStmt(stmt, context, sites);
      return;
    }
    default:
      // Not one of mvdan/sh's `syntax.Command` variants — e.g. a `Word` or
      // `Assign` passed directly as `enumerateCommands`' root, or a future
      // Command type this module doesn't know yet. Fall back to scanning it
      // as an expression subtree rather than silently finding nothing.
      scanForHiddenCommands(cmd, context, sites);
  }
}

/**
 * Enumerates every command invocation (`CallExpr`) reachable from `root`,
 * with its resolved words ({@link resolveWord}) and the path used to reach
 * it ({@link CommandContext}). Descends everywhere a command can occur:
 * statement lists, both sides of `&&`/`||`/pipelines, subshells/blocks,
 * if/case branches *and* conditions, loop bodies *and* conditions, function
 * bodies, background/negated/coproc statements, and — critically —
 * `CmdSubst`/`ProcSubst` nested inside words, wherever those words occur
 * (arguments, redirection targets, case subjects/patterns, loop word
 * lists, assignment values, test/arithmetic operands, …), not only inside
 * `CallExpr.args`.
 *
 * An assignment-only `CallExpr` (`FOO=bar`, `args` empty) has no first word
 * to resolve and is not itself a command invocation — no program runs — so
 * it produces no {@link CommandSite}; any command substitution nested in
 * its assigned value (`FOO=$(sub)`) is still found and reported.
 *
 * Results are sorted by source position (`node.range[0]`), so nested
 * command substitutions and out-of-structural-order redirection targets
 * still come back in source order regardless of traversal order.
 *
 * Facts only, matching {@link resolveWord}'s posture: no safety verdict, no
 * command/wrapper allowlist or denylist, no dataflow. A statically unknown
 * `argv0` (`static: false`) is a normal, expected result.
 *
 * @param root - Any `ShNode` — typically a `File` from `parseSync`, but any
 * subtree (a `Stmt`, a `Command`, or even a bare `Word`) is handled.
 * @public
 */
export function enumerateCommands(root: ShNode): CommandSite[] {
  const sites: CommandSite[] = [];
  if (root.type === 'File') {
    visitStmtList(nodeArray(root.stmts), [], sites);
  } else if (root.type === 'Stmt') {
    visitStmt(root, [], sites);
  } else {
    visitCommand(root, [], sites);
  }
  return [...sites].sort((a, b) => a.node.range[0] - b.node.range[0]);
}
