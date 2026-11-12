/**
 * Long flat command lists and arithmetic operator chains (sh-ast#105).
 *
 * `a && b && c`, `a | b | c` and `1 + 1 + 1` are sequences, not nesting: the
 * parser builds them as left-nested BinaryCmd / BinaryArithm trees, but no
 * construct is opened inside another. Their length must not consume the nesting
 * budget, and every binding stage that touches the resulting tree (parse
 * response, validation, walk, print) must handle it without exhausting the host
 * stack. Genuine nesting keeps its resource refusal, including nesting placed
 * around or inside a long chain.
 *
 * Every case runs in its own child process (see isolated-tree.ts).
 *
 * @see https://github.com/mike-north/sh-ast/issues/105
 * @see https://www.gnu.org/software/bash/manual/html_node/Lists.html
 * @see https://www.gnu.org/software/bash/manual/html_node/Pipelines.html
 * @see https://www.gnu.org/software/bash/manual/html_node/Shell-Arithmetic.html
 */
import { describe, expect, it } from 'vitest';
import { Add, AndStmt, OrStmt, Pipe } from '../src/index.js';
import {
  BUDGET_REFUSAL,
  expectFlatTree,
  expectSameNestingBoundary,
  inArithmeticParens,
  inSubshells,
  inspectIsolated,
  repeated,
} from './isolated-tree.js';

/** Chain lengths from the issue: a few hundred, a few thousand, and 10,000 commands. */
const LENGTHS = [300, 3_000, 10_000] as const;

/** Shell spelling of each list operator, with the upstream BinCmdOperator value. */
const LIST_OPERATORS = { '&&': AndStmt, '||': OrStmt, '|': Pipe } as const;

type ListOperator = keyof typeof LIST_OPERATORS;

/**
 * Operator sequences under test. `mixed` cycles through all three so that
 * pipelines appear as operands of `&&` / `||`, the shape real install steps take.
 */
const SHAPES: Readonly<Record<string, readonly ListOperator[]>> = {
  and: ['&&'],
  or: ['||'],
  pipe: ['|'],
  mixed: ['&&', '||', '|'],
};

/** The operator joining command `i` (1-based) to the commands before it. */
function operatorAt(operators: readonly ListOperator[], i: number): ListOperator {
  return operators[(i - 1) % operators.length];
}

/** `true OP true OP … true` with `commands` commands on one line. */
function commandList(operators: readonly ListOperator[], commands: number): string {
  let source = 'true';
  for (let i = 1; i < commands; i++) source += ` ${operatorAt(operators, i)} true`;
  return source + '\n';
}

/** Operator codes of commandList(operators, commands), in the order written. */
function listOperators(operators: readonly ListOperator[], commands: number): number[] {
  return Array.from(
    { length: commands - 1 },
    (_, index) => LIST_OPERATORS[operatorAt(operators, index + 1)],
  );
}

/** `1 + 1 + … + 1` with `terms` terms. */
function sum(terms: number): string {
  return '1' + ' + 1'.repeat(terms - 1);
}

describe('flat command lists are not nesting (issue #105)', () => {
  for (const [shape, operators] of Object.entries(SHAPES)) {
    it.each(LENGTHS)(
      `a ${shape} list of %i commands parses, walks and prints`,
      (commands) => {
        expectFlatTree(inspectIsolated(commandList(operators, commands)), {
          commands,
          cmdOperators: listOperators(operators, commands),
        });
      },
      120_000,
    );
  }

  it.each(LENGTHS)(
    'parseWithPositionsSync accepts a mixed list of %i commands',
    (commands) => {
      const operators = SHAPES.mixed;
      expectFlatTree(
        inspectIsolated(commandList(operators, commands), { operation: 'parseWithPositionsSync' }),
        { commands, cmdOperators: listOperators(operators, commands) },
      );
    },
    120_000,
  );
});

describe('flat arithmetic operator chains are not nesting (issue #105)', () => {
  it.each(LENGTHS)(
    'a sum of %i terms parses, walks and prints',
    (terms) => {
      // `echo` is the only command; n terms are joined by n - 1 additions.
      expectFlatTree(inspectIsolated(`echo $((${sum(terms)}))\n`), {
        commands: 1,
        arithOperators: repeated(Add, terms - 1),
      });
    },
    120_000,
  );
});

describe('positions of a long arithmetic chain', () => {
  // In `echo $(( 1+1+…+1 ))` the first operand starts at byte 9, after
  // `echo $(( `. Every operator node starts where the whole sum does, and the
  // k-th operator (from 0, in source order) ends after its right operand, the
  // `1` at byte 9 + 2(k + 1): bounds [9, 12 + 2k).
  it('parseWithPositionsSync gives each of 20,000 operators the bounds of its prefix', () => {
    const operators = 20_000;
    const outcome = inspectIsolated('echo $(( ' + '1+'.repeat(operators) + '1 ))', {
      operation: 'parseWithPositionsSync',
      arithBounds: true,
    });
    expect(outcome.outcome).toBe('parsed');
    if (outcome.outcome !== 'parsed') return;
    expect(outcome.arithBounds).toEqual(
      Array.from({ length: operators }, (_, k) => [9, 12 + 2 * k]),
    );
  }, 120_000);
});

describe('nesting around and inside a long chain keeps its refusal', () => {
  it('200 subshells around a 10,000-command list are refused', () => {
    expect(inspectIsolated(inSubshells(200, commandList(['&&'], 10_000)))).toEqual(BUDGET_REFUSAL);
  }, 120_000);

  it('200 arithmetic parentheses around a 10,000-term sum are refused', () => {
    expect(inspectIsolated(inArithmeticParens(200, sum(10_000)))).toEqual(BUDGET_REFUSAL);
  }, 120_000);

  it('200 subshells as the last command of a 10,000-command list are refused', () => {
    const source = commandList(['&&'], 9_999).trimEnd() + ' && ' + inSubshells(200, ':');
    expect(inspectIsolated(source)).toEqual(BUDGET_REFUSAL);
  }, 120_000);

  it('2,000 arithmetic parentheses as the last term of a 10,000-term sum are refused', () => {
    const source =
      'echo $((' + sum(9_999) + ' + ' + '('.repeat(2_000) + '1' + ')'.repeat(2_000) + '))\n';
    expect(inspectIsolated(source)).toEqual(BUDGET_REFUSAL);
  }, 120_000);

  it('a list leaves the same nesting budget to the subshell that is its last command', () => {
    expectSameNestingBoundary(
      (depth, list) => list.trimEnd() + ' && ' + inSubshells(depth, ':'),
      commandList(['&&'], 1),
      commandList(['&&'], 9_999),
    );
  }, 600_000);

  it('a list leaves the same nesting budget to the subshells around it', () => {
    expectSameNestingBoundary(
      inSubshells,
      commandList(SHAPES.mixed, 2),
      commandList(SHAPES.mixed, 10_000),
    );
  }, 600_000);

  it('a sum leaves the same nesting budget to the parentheses around it', () => {
    expectSameNestingBoundary(inArithmeticParens, sum(2), sum(10_000));
  }, 600_000);
});

describe('copying a long-chain tree with structuredClone', () => {
  // structuredClone recurses inside the host engine. A short list copies; a long
  // one may exceed the host's stack, which is a documented host limit, not a
  // binding error. Either way the binding stays usable afterwards.
  it('copies a 300-command list', () => {
    expect(inspectIsolated(commandList(['&&'], 300), { clone: true })).toMatchObject({
      outcome: 'parsed',
      clone: 'ok',
      afterClone: 'File',
    });
  }, 60_000);

  it('leaves the runtime usable whatever the host does with a 10,000-command list', () => {
    const outcome = inspectIsolated(commandList(['&&'], 10_000), { clone: true });
    expect(outcome.outcome).toBe('parsed');
    if (outcome.outcome !== 'parsed') return;
    expect(['ok', 'RangeError']).toContain(outcome.clone);
    expect(outcome.afterClone).toBe('File');
  }, 120_000);
});
