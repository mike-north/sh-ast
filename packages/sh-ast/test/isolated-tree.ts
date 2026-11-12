/**
 * Test support for long flat syntax and the nesting budget that surrounds it.
 *
 * Flat sequences (`a && b`, `a | b`, `1 + 1`) cost no nesting units: their length
 * is not depth. Genuine nesting (subshells, arithmetic parentheses, substitutions)
 * is refused once it needs more than the binding's 128 units. These helpers run
 * each source in a fresh child process (fixtures/syntax-tree-child.mjs), so a
 * stack overflow ends only that child and is reported as a distinct outcome
 * that every assertion here rejects.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

/** The built public entry, as consumers load it. */
const entry = new URL('../dist/index.js', import.meta.url).href;
const child = fileURLToPath(new URL('./fixtures/syntax-tree-child.mjs', import.meta.url));

/** Node counts and operator codes in source order, as observed through the public walk. @internal */
export interface TreeFacts {
  readonly counts: Readonly<Partial<Record<string, number>>>;
  readonly cmdOperators: readonly number[];
  readonly arithOperators: readonly number[];
}

/** What one isolated public parse produced. @internal */
export type IsolatedOutcome =
  | {
      readonly outcome: 'parsed';
      readonly facts: TreeFacts;
      /** Facts of the printed text reparsed, and whether printing that parse is stable. */
      readonly printed: { readonly facts: TreeFacts; readonly fixedPoint: boolean };
      readonly clone?: string;
      readonly afterClone?: string;
      /** [Pos, End] byte offsets of each BinaryArithm by operator offset, from the positions snapshot. */
      readonly arithBounds?: readonly (readonly [number, number])[];
    }
  | {
      readonly outcome: 'refused';
      readonly name: string;
      readonly code: string;
      readonly maxDepth: number;
      readonly estimatedDepth: number;
      readonly partialFile: boolean;
      readonly subsequent: string;
    }
  | { readonly outcome: 'RangeError'; readonly message: string }
  | {
      readonly outcome: 'error';
      readonly name: string;
      readonly code?: string;
      readonly message: string;
    };

/** Which public parse to call, with what options, and whether to try structuredClone. @internal */
export interface IsolatedRequest {
  readonly operation?: 'parseSync' | 'parseWithPositionsSync';
  readonly options?: Readonly<Record<string, unknown>>;
  readonly clone?: boolean;
  /** Report positions-snapshot bounds of every BinaryArithm (parseWithPositionsSync only). */
  readonly arithBounds?: boolean;
}

/** Parses, walks, prints and reparses `source` in a fresh process with a hard deadline. @internal */
export function inspectIsolated(source: string, request: IsolatedRequest = {}): IsolatedOutcome {
  const result = spawnSync(process.execPath, [child, entry], {
    input: JSON.stringify({ source, ...request }),
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? 'null') as IsolatedOutcome;
}

/** The terminal refusal for nesting that needs a 129th unit: typed, no partial tree, runtime reusable. @internal */
export const BUDGET_REFUSAL = {
  outcome: 'refused',
  name: 'ShParseMaxDepthError',
  code: 'SH_AST_PARSE_MAX_DEPTH',
  maxDepth: 128,
  estimatedDepth: 129,
  partialFile: false,
  subsequent: 'File',
} as const;

/** Hand-derived shape of a flat source: commands and operators as written. @internal */
export interface ExpectedFlatTree {
  /** Number of simple commands (CallExpr nodes). */
  readonly commands: number;
  /** Command-list operator codes in source order. */
  readonly cmdOperators?: readonly number[];
  /** Arithmetic operator codes in source order. */
  readonly arithOperators?: readonly number[];
}

/**
 * Asserts that a flat source parsed (never a RangeError), that walk saw every
 * command and operator as written, and that the printed form parses back to the
 * same commands and operators.
 * @internal
 */
export function expectFlatTree(outcome: IsolatedOutcome, expected: ExpectedFlatTree): void {
  expect(outcome.outcome, JSON.stringify(outcome).slice(0, 500)).toBe('parsed');
  if (outcome.outcome !== 'parsed') return;
  const cmdOperators = expected.cmdOperators ?? [];
  const arithOperators = expected.arithOperators ?? [];
  for (const observed of [outcome.facts, outcome.printed.facts]) {
    expect(observed.counts.CallExpr ?? 0).toBe(expected.commands);
    expect(observed.counts.BinaryCmd ?? 0).toBe(cmdOperators.length);
    expect(observed.counts.BinaryArithm ?? 0).toBe(arithOperators.length);
    expect(observed.cmdOperators).toEqual(cmdOperators);
    expect(observed.arithOperators).toEqual(arithOperators);
  }
  expect(outcome.printed.fixedPoint).toBe(true);
}

/** `count` copies of `operator`, the expected operator list of a flat chain. @internal */
export function repeated(operator: number, count: number): number[] {
  return Array.from({ length: count }, () => operator);
}

/**
 * Asserts that a flat sequence's length does not change how much nesting may
 * surround it. `nest(depth, inner)` wraps `inner` in `depth` levels of genuine
 * nesting. The deepest accepted depth is found around a short form, then the
 * long form must accept that depth and be refused, at the 129th unit, one level
 * deeper. The boundary must lie where 128 units put it, not hundreds of levels
 * away, so the guard still covers the form.
 * @internal
 */
export function expectSameNestingBoundary(
  nest: (depth: number, inner: string) => string,
  short: string,
  long: string,
): void {
  const accepts = (depth: number, inner: string): boolean => {
    const outcome = inspectIsolated(nest(depth, inner));
    expect(outcome.outcome, `depth ${String(depth)}`).not.toBe('RangeError');
    if (outcome.outcome === 'refused') {
      expect(outcome).toEqual(BUDGET_REFUSAL);
      return false;
    }
    expect(outcome.outcome, JSON.stringify(outcome).slice(0, 500)).toBe('parsed');
    return true;
  };
  // Every unit is at least one level of the nesting being added, so the
  // boundary is at most 128 levels deep; 64 levels are always accepted.
  let accepted = 64;
  let refused = 129;
  expect(accepts(accepted, short)).toBe(true);
  expect(accepts(refused, short)).toBe(false);
  while (refused - accepted > 1) {
    const depth = Math.floor((accepted + refused) / 2);
    if (accepts(depth, short)) accepted = depth;
    else refused = depth;
  }
  expect(accepted).toBeGreaterThanOrEqual(100);
  expect(accepts(accepted, long), 'long form at the short boundary').toBe(true);
  expect(accepts(refused, long), 'long form one level past it').toBe(false);
}

/**
 * `depth` space-separated subshells around `inner`. Adjacent `((` at the start
 * of a command would open an arithmetic command instead.
 * @internal
 */
export function inSubshells(depth: number, inner: string): string {
  return '( '.repeat(depth) + inner.trimEnd() + ' )'.repeat(depth) + '\n';
}

/** `depth` arithmetic parentheses around the expression `inner`, inside `echo $(( … ))`. @internal */
export function inArithmeticParens(depth: number, inner: string): string {
  return 'echo $(( ' + '( '.repeat(depth) + inner + ' )'.repeat(depth) + ' ))\n';
}
