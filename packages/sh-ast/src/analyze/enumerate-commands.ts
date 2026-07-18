import { ShAnalyzeMaxDepthError } from '../errors.js';
import type { ShNode } from '../types.js';
import { isShNodeShape, nodeArray, stringField } from './node-helpers.js';
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
 * This union may grow in a **minor** release — a future mvdan/sh grammar
 * construct this module starts modeling can add a new `kind` variant
 * without that being a breaking change (mirroring
 * {@link WordResolutionReason}'s semver policy in `resolve-word.ts`). It is
 * deliberately not sealed against extension elsewhere in the codebase.
 * Every existing variant's shape (its extra fields, if any) is stable —
 * only new variants are ever added — so an exhaustive compile-time
 * `switch` over `.kind` should still include a `default` case to stay
 * forward-compatible.
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

/**
 * The maximum number of *genuinely nested* structural frames (subshells,
 * command/process substitutions, `if`/`case`/loop/function/`time`/`{ }`
 * bodies, chained `elif`) {@link enumerateCommands} descends through before
 * throwing {@link ShAnalyzeMaxDepthError} — a defensive backstop against
 * pathological/adversarial input (a native stack overflow is an
 * uncontrolled crash, not a catchable error). A long *linear* chain
 * (`|`/`&&`/`||` of any length) never grows this counter — see
 * `flattenPipelineStages`'s and `visitBinaryCmd`'s doc comments — only real
 * nesting does.
 *
 * This value is deliberately *not* a round, "generous"-sounding number
 * like 10,000: measured empirically (synthetic nested-`Subshell` trees,
 * this repo's actual `vitest` worker environment, default Node/V8 stack
 * size — see `analyze-enumerate-commands.test.ts`'s depth-guard describe
 * block), this module's own recursive descent through a real
 * `Subshell`-in-`Subshell` chain hits a raw, uncatchable
 * `RangeError: Maximum call stack size exceeded` starting somewhere around
 * depth 1,000–1,500 (the exact point varies run to run — it's a hard
 * native-stack limit, not a clean threshold). A depth guard set at 10,000
 * would never actually fire: the real crash happens first. 500 leaves
 * roughly 2–3x headroom below the *lowest* observed native-crash depth,
 * while still comfortably exceeding any realistic hand-written script's
 * nesting (this is pathological-input protection, not a normal-usage
 * ceiling).
 */
const MAX_STRUCTURAL_DEPTH = 500;

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
 *
 * `depth` is {@link visitStmt}'s structural-nesting counter, passed through
 * unchanged for the generic per-field walk (a purely expression-shaped
 * subtree — e.g. deeply nested `ParamExp` — is a different, out-of-scope
 * risk from the command-structural nesting {@link MAX_STRUCTURAL_DEPTH}
 * guards against) and incremented by one only when a `CmdSubst`/`ProcSubst`
 * boundary is crossed, since that's a genuine additional level of
 * command-bearing nesting (see {@link ShAnalyzeMaxDepthError}'s doc
 * comment).
 */
function scanForHiddenCommands(
  value: unknown,
  context: readonly CommandContext[],
  sites: CommandSite[],
  depth: number,
): void {
  if (Array.isArray(value)) {
    for (const item of value) scanForHiddenCommands(item, context, sites, depth);
    return;
  }
  if (!isShNodeShape(value)) return;
  if (value.type === 'CmdSubst') {
    visitStmtList(
      nodeArray(value.stmts),
      pushContext(context, { kind: 'cmdSubst' }),
      sites,
      depth + 1,
    );
    return;
  }
  if (value.type === 'ProcSubst') {
    visitStmtList(
      nodeArray(value.stmts),
      pushContext(context, { kind: 'procSubst' }),
      sites,
      depth + 1,
    );
    return;
  }
  for (const field of Object.values(value)) {
    scanForHiddenCommands(field, context, sites, depth);
  }
}

function visitStmtList(
  stmts: readonly ShNode[],
  context: readonly CommandContext[],
  sites: CommandSite[],
  depth: number,
): void {
  for (const stmt of stmts) visitStmt(stmt, context, sites, depth);
}

/**
 * Visits one `Stmt`. Every genuinely-nested recursive path through this
 * module funnels through here (directly, or via {@link visitStmtList}) —
 * see {@link MAX_STRUCTURAL_DEPTH}'s doc comment — so this is where the
 * depth guard is enforced: a `depth` that has grown past
 * {@link MAX_STRUCTURAL_DEPTH} throws {@link ShAnalyzeMaxDepthError} rather
 * than recursing further.
 */
function visitStmt(
  stmt: ShNode,
  context: readonly CommandContext[],
  sites: CommandSite[],
  depth: number,
): void {
  if (depth > MAX_STRUCTURAL_DEPTH) {
    throw new ShAnalyzeMaxDepthError(MAX_STRUCTURAL_DEPTH);
  }
  let stmtContext = context;
  if (stmt.negated === true) stmtContext = pushContext(stmtContext, { kind: 'negated' });
  if (stmt.background === true) stmtContext = pushContext(stmtContext, { kind: 'background' });
  scanForHiddenCommands(stmt.redirs, stmtContext, sites, depth);
  const cmd = stmt.cmd;
  if (isShNodeShape(cmd)) visitCommand(cmd, stmtContext, sites, depth);
}

/**
 * Recovers the left-to-right stages of a `|`/`|&` pipeline from `cmd` (a
 * `BinaryCmd` whose own `Op` is already known to be a pipe-family
 * operator). mvdan/sh nests these left-associatively — `a | b | c` is
 * `BinaryCmd(x: Stmt{BinaryCmd(x: a, y: b)}, y: Stmt{c})` — so a chain of
 * `n` stages is `n - 1` levels of nested `BinaryCmd`. Recovering stages
 * walks that left ("x") spine with an explicit work stack instead of
 * recursing per level, so a pipeline of any realistic length (this module
 * is tested to 5,000+ stages) uses O(1) native call-stack frames here,
 * regardless of `n` — the array-backed stack lives on the heap, not the
 * call stack. The work-stack ordering (push `y` then `x`, i.e. `x` on top)
 * mirrors what the original recursive left-to-right depth-first walk did
 * (fully expand `x` before `y`), including the — per this bridge's own
 * left-associative-only model — hypothetical case of a further pipe-family
 * `BinaryCmd` on the `y` side. Mixed `|`/`|&` chains flatten into a single
 * pipeline (this bridge doesn't distinguish "stderr also piped" in
 * {@link CommandContext} — only stage position).
 */
function flattenPipelineStages(cmd: ShNode): ShNode[] {
  const stages: ShNode[] = [];
  const workStack: unknown[] = [cmd.y, cmd.x];
  while (workStack.length > 0) {
    const operandStmt = workStack.pop();
    if (!isShNodeShape(operandStmt)) continue;
    const innerCmd = operandStmt.cmd;
    if (isShNodeShape(innerCmd) && innerCmd.type === 'BinaryCmd' && isPipeOp(innerCmd.op)) {
      // Push `y` then `x` so `x` — the side that keeps the chain going in
      // the left-associative case — is popped (processed) first.
      workStack.push(innerCmd.y, innerCmd.x);
    } else {
      stages.push(operandStmt);
    }
  }
  return stages;
}

/**
 * Visits a non-pipe-family `BinaryCmd` (`&&`/`||`, or a future operator
 * this module doesn't specifically recognize). Like pipelines, `&&`/`||`
 * chains nest left-associatively — `a && b && c` is
 * `BinaryCmd(x: Stmt{BinaryCmd(x: a, y: b)}, y: Stmt{c})`, and a mixed
 * `a && b || c` chain is still a single left-nested spine
 * (`(a && b) || c`) — so a long chain is walked iteratively here too,
 * exactly mirroring {@link flattenPipelineStages}'s technique: descend the
 * left ("x") spine with a `while` loop instead of recursion, collecting
 * each level's right ("y") operand (and which context frame, if any, it
 * gets — `'and'`/`'or'`, or none for an unrecognized operator, matching
 * the original per-level logic) along the way, stopping either at a plain
 * (non-`BinaryCmd`) leftmost operand or at a pipe-family `BinaryCmd` (a
 * different sub-structure, visited via the ordinary `visitStmt` →
 * `visitCommand` → `visitBinaryCmd` dispatch below — a single, bounded
 * recursive step, not per-chain-length).
 *
 * Every operand this function ultimately visits (the collected right-hand
 * operands and the leftmost operand) is one genuine structural hop away
 * from this `BinaryCmd` node, so each gets `depth + 1` — the *same*
 * incremented value for every one of them, regardless of chain length:
 * they're siblings under this node's flattened spine, not nested inside
 * one another, so the depth counter must not grow with stage count (only
 * {@link flattenPipelineStages}'s sibling pipeline stages get the same
 * treatment, for the same reason).
 */
function visitBinaryCmd(
  cmd: ShNode,
  context: readonly CommandContext[],
  sites: CommandSite[],
  depth: number,
): void {
  const op = cmd.op;
  if (isPipeOp(op)) {
    const stages = flattenPipelineStages(cmd);
    stages.forEach((stage, index) => {
      visitStmt(stage, pushContext(context, { kind: 'pipeline', stage: index }), sites, depth + 1);
    });
    return;
  }
  interface RightOperand {
    readonly stmt: ShNode;
    readonly frame: CommandContext | undefined;
  }
  const rightOperands: RightOperand[] = [];
  let spine: ShNode = cmd;
  for (;;) {
    const spineOp = spine.op;
    const frame: CommandContext | undefined =
      spineOp === BIN_CMD_OP_AND
        ? { kind: 'and', side: 'right' }
        : spineOp === BIN_CMD_OP_OR
          ? { kind: 'or', side: 'right' }
          : undefined;
    const y = spine.y;
    if (isShNodeShape(y)) rightOperands.push({ stmt: y, frame });
    const x = spine.x;
    if (!isShNodeShape(x)) break;
    const innerCmd = x.cmd;
    if (isShNodeShape(innerCmd) && innerCmd.type === 'BinaryCmd' && !isPipeOp(innerCmd.op)) {
      spine = innerCmd;
      continue;
    }
    // `x` is the leftmost operand: not a further same-family BinaryCmd
    // link, so this is where the spine walk ends — visit it with the
    // *outer* (unmodified) context, exactly as the original recursive
    // implementation visited `cmd.x`.
    visitStmt(x, context, sites, depth + 1);
    break;
  }
  for (const { stmt, frame } of rightOperands) {
    visitStmt(stmt, frame ? pushContext(context, frame) : context, sites, depth + 1);
  }
}

function visitIfClause(
  clause: ShNode,
  context: readonly CommandContext[],
  sites: CommandSite[],
  depth: number,
): void {
  visitStmtList(
    nodeArray(clause.cond),
    pushContext(context, { kind: 'if', branch: 'cond' }),
    sites,
    depth,
  );
  visitStmtList(
    nodeArray(clause.then),
    pushContext(context, { kind: 'if', branch: 'then' }),
    sites,
    depth,
  );
  const elseClause = clause.else;
  if (isShNodeShape(elseClause)) {
    // A chained `elif` — mvdan/sh models it as `IfClause.Else` pointing to
    // another `IfClause` — is one more genuine level of nesting than
    // `cond`/`then` above, so it gets its own `depth + 1` (a long `elif`
    // chain must still trip {@link MAX_STRUCTURAL_DEPTH}, since — unlike
    // `&&`/`||`/pipelines — this module does not special-case flattening
    // it).
    visitIfClause(
      elseClause,
      pushContext(context, { kind: 'if', branch: 'else' }),
      sites,
      depth + 1,
    );
  }
}

function visitCommand(
  cmd: ShNode,
  context: readonly CommandContext[],
  sites: CommandSite[],
  depth: number,
): void {
  switch (cmd.type) {
    case 'CallExpr': {
      scanForHiddenCommands(cmd.assigns, context, sites, depth);
      scanForHiddenCommands(cmd.args, context, sites, depth);
      const args = nodeArray(cmd.args);
      if (args.length > 0) {
        const argv = args.map((word) => resolveWord(word, { context: 'command-argument' }));
        sites.push({ node: cmd, argv0: argv[0], argv, context });
      }
      return;
    }
    case 'BinaryCmd':
      visitBinaryCmd(cmd, context, sites, depth);
      return;
    case 'Block':
      // Transparent grouping (`{ ...; }`) — no context frame, but still one
      // genuine level of structural nesting for depth-guard purposes (a
      // pathological `{ { { ... } } }` chain must still trip the guard).
      visitStmtList(nodeArray(cmd.stmts), context, sites, depth + 1);
      return;
    case 'Subshell':
      visitStmtList(
        nodeArray(cmd.stmts),
        pushContext(context, { kind: 'subshell' }),
        sites,
        depth + 1,
      );
      return;
    case 'IfClause':
      visitIfClause(cmd, context, sites, depth + 1);
      return;
    case 'CaseClause': {
      scanForHiddenCommands(cmd.word, context, sites, depth);
      for (const item of nodeArray(cmd.items)) {
        scanForHiddenCommands(item.patterns, context, sites, depth);
        visitStmtList(
          nodeArray(item.stmts),
          pushContext(context, { kind: 'case' }),
          sites,
          depth + 1,
        );
      }
      return;
    }
    case 'ForClause': {
      scanForHiddenCommands(cmd.loop, context, sites, depth);
      visitStmtList(
        nodeArray(cmd.do),
        pushContext(context, { kind: 'loop', role: 'body' }),
        sites,
        depth + 1,
      );
      return;
    }
    case 'WhileClause': {
      visitStmtList(
        nodeArray(cmd.cond),
        pushContext(context, { kind: 'loop', role: 'cond' }),
        sites,
        depth + 1,
      );
      visitStmtList(
        nodeArray(cmd.do),
        pushContext(context, { kind: 'loop', role: 'body' }),
        sites,
        depth + 1,
      );
      return;
    }
    case 'FuncDecl': {
      const nameNode = cmd.name;
      const nameText = isShNodeShape(nameNode) ? stringField(nameNode, 'value') : '';
      const body = cmd.body;
      if (isShNodeShape(body)) {
        visitStmt(
          body,
          pushContext(context, { kind: 'function', name: nameText }),
          sites,
          depth + 1,
        );
      }
      return;
    }
    case 'CoprocClause': {
      scanForHiddenCommands(cmd.name, context, sites, depth);
      const stmt = cmd.stmt;
      if (isShNodeShape(stmt)) {
        visitStmt(stmt, pushContext(context, { kind: 'coproc' }), sites, depth + 1);
      }
      return;
    }
    case 'DeclClause':
      scanForHiddenCommands(cmd.args, context, sites, depth);
      return;
    case 'LetClause':
      scanForHiddenCommands(cmd.exprs, context, sites, depth);
      return;
    case 'TestClause':
      scanForHiddenCommands(cmd.x, context, sites, depth);
      return;
    case 'ArithmCmd':
      scanForHiddenCommands(cmd.x, context, sites, depth);
      return;
    case 'TestDecl': {
      scanForHiddenCommands(cmd.description, context, sites, depth);
      const body = cmd.body;
      if (isShNodeShape(body)) visitStmt(body, context, sites, depth + 1);
      return;
    }
    case 'TimeClause': {
      // Transparent (`time cmd`) — no context frame, but still one genuine
      // level of structural nesting for depth-guard purposes.
      const stmt = cmd.stmt;
      if (isShNodeShape(stmt)) visitStmt(stmt, context, sites, depth + 1);
      return;
    }
    default:
      // Not one of mvdan/sh's `syntax.Command` variants — e.g. a `Word` or
      // `Assign` passed directly as `enumerateCommands`' root, or a future
      // Command type this module doesn't know yet. Fall back to scanning it
      // as an expression subtree rather than silently finding nothing.
      scanForHiddenCommands(cmd, context, sites, depth);
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
 * A long *linear* chain — `|`/`|&`/`&&`/`||` of any realistic length — is
 * traversed iteratively and never risks a stack overflow or trips the
 * nesting-depth guard below, regardless of how many stages/links it has.
 *
 * @param root - Any `ShNode` — typically a `File` from `parseSync`, but any
 * subtree (a `Stmt`, a `Command`, or even a bare `Word`) is handled. Note
 * `parseSync` itself already refuses (via its own `ShParseMaxDepthError`) any
 * input whose estimated nesting exceeds *its* limit before ever producing a
 * tree — see `parse-depth-guard.ts` — so a `root` sourced from `parseSync`
 * has already passed that earlier, lower-level line of defense; this
 * module's own guard below remains a second, independent backstop for
 * trees built or mutated some other way.
 * @throws {@link ShAnalyzeMaxDepthError} if `root`'s genuinely nested
 * structure (subshells within subshells, chained command/process
 * substitutions, deeply nested `if`/`case`/loop/function/`time`/`{ }`
 * bodies, chained `elif`) exceeds this module's defensive recursion-depth
 * guard — see that error's doc comment for why this fails closed instead
 * of returning a partial result, and why a gate-style consumer should treat
 * it as `deny`.
 * @public
 */
export function enumerateCommands(root: ShNode): CommandSite[] {
  const sites: CommandSite[] = [];
  if (root.type === 'File') {
    visitStmtList(nodeArray(root.stmts), [], sites, 0);
  } else if (root.type === 'Stmt') {
    visitStmt(root, [], sites, 0);
  } else {
    visitCommand(root, [], sites, 0);
  }
  return [...sites].sort((a, b) => a.node.range[0] - b.node.range[0]);
}
