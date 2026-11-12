/**
 * Traversals handle trees as deep as memory allows. A flat chain of commands or
 * arithmetic terms builds a left-nested tree, one level per link; each operation here
 * runs over such a tree of 10,000 and 100,000 links in a child process on the host's
 * ordinary stack, so a regression to one native frame per level fails that child with a
 * RangeError instead of taking down the test runner. Trees are synthesized directly
 * because the parser's own nesting budget still refuses chains this long.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const distUrl = new URL('../dist/', import.meta.url).href;
const child = new URL('./fixtures/deep-spine-child.mjs', import.meta.url).pathname;

/** What the probe printed, or a failure that includes the child's stderr. */
function probe(
  mode: string,
  links: number,
  execArgv: readonly string[] = [],
): Record<string, unknown> {
  const run = spawnSync(process.execPath, [...execArgv, child, distUrl, mode, String(links)], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  expect(run.error, run.stderr).toBeUndefined();
  expect(run.signal, run.stderr).toBeNull();
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout.trim().split('\n').at(-1) ?? 'null') as Record<string, unknown>;
}

/** Sum of the values in a count table. */
function total(counts: unknown): number {
  return Object.values(counts as Record<string, number>).reduce((sum, n) => sum + n, 0);
}

describe.each([10_000, 100_000])('a left-nested spine of %i links', (links) => {
  it.each(['walk-command', 'walk-arith'])(
    '%s: Walk enters every node once and exits each entered node',
    (mode) => {
      const result = probe(mode, links);
      expect(result.entered).toStrictEqual(result.expected);
      expect(result.exits).toBe(total(result.expected));
      const expected = result.expected as Record<string, number>;
      if (mode === 'walk-command') {
        expect(expected.BinaryCmd).toBe(links - 1);
        expect(expected.CallExpr).toBe(links);
      } else {
        expect(expected.BinaryArithm).toBe(links - 1);
      }
    },
    120_000,
  );

  it('walk-prune: pruning a node skips its subtree and its exit', () => {
    const result = probe('walk-prune', links);
    const expected = result.expected as Record<string, number>;
    // Each CallExpr (Args Word + Lit, 2 nodes) is entered but its children are not.
    expect(result.seen).toBe(total(expected) - 2 * links);
  }, 120_000);

  it('walk-throw: a callback exception propagates with its identity', () => {
    expect(probe('walk-throw', links).sameError).toBe(true);
  }, 120_000);

  it.each(['encode-command', 'encode-arith'])(
    '%s: encodeWire serializes without overflow and round-trips',
    (mode) => {
      const result = probe(mode, links);
      expect(result.roundTripTypes).toStrictEqual(result.expected);
    },
    120_000,
  );

  it('encode-cycle: a cycle closing at full depth is still reported', () => {
    expect(probe('encode-cycle', links).error).toBe('Syntax records cannot contain cycles');
  }, 120_000);

  it.each(['validate-command', 'validate-arith'])(
    '%s: the validator accepts a complete spine',
    (mode) => {
      const result = probe(mode, links);
      expect(result.node).toBe(true);
      if (mode === 'validate-command') {
        expect(result.file).toBe(true);
        expect(result.restored).toBe(true);
        expect(result.restoredPosition).toStrictEqual({
          Offset: 0,
          Line: 0,
          Col: 0,
          IsValid: false,
          IsRecovered: false,
          OffsetOverflow: false,
        });
      }
    },
    120_000,
  );

  it('validate-reject: a bad field at the bottom of the spine is rejected', () => {
    expect(probe('validate-reject', links).node).toBe(false);
  }, 120_000);

  it('validate-cycle: a back-reference to the root is rejected, shared leaves are not', () => {
    const result = probe('validate-cycle', links);
    expect(result.acyclic).toBe(true);
    expect(result.cyclic).toBe(false);
  }, 120_000);

  it('visit-nodes: the snapshot visit reaches every node', () => {
    const result = probe('visit-nodes', links);
    const expected = { ...(result.expected as Record<string, number>) };
    expect(result.entered).toStrictEqual({ ...expected, File: 1 });
  }, 120_000);

  it('decode-bytes: byte tags restore at any depth', () => {
    expect(probe('decode-bytes', links).bytes).toStrictEqual([1, 2, 3]);
  }, 120_000);

  it('bounds-position: a position resolves down a deep BinaryArithm.X spine', () => {
    expect(probe('bounds-position', links).position).toStrictEqual({ offset: 0, lineCol: 0 });
  }, 120_000);
});

/**
 * Regression: print requests of roughly 2,500-5,000 list links (5,000-10,000 JSON
 * levels) overflowed the engine stack because the native request decoder fell back
 * to its iterative reader only above encoding/json's 10,000-level cap, leaving that
 * recursive decoder to read everything below it. Each depth runs in a fresh child so
 * a stack overflow cannot leak between cases. The band stops where the pinned
 * upstream printer, which recurses once per list link, stops being able to print;
 * the request decoder is covered past it by the Go tests.
 */
describe.each([2_000, 3_000, 3_500, 4_000, 4_500, 5_000, 6_000])(
  'printing a hand-built &&-list of %i links',
  (links) => {
    it('print-command: the request decodes and prints without RangeError', () => {
      const result = probe('print-command', links);
      expect(result.error).toBeNull();
      // `true && true && ...`: "true" plus " && true" per further link, wrapped with
      // line breaks by the printer, so only a floor on the length is stable.
      expect(result.printedLength as number).toBeGreaterThan(links * 8);
    }, 120_000);
  },
);

/**
 * Regression: walking a cyclic caller-built tree used to grow the frame stack until
 * V8 aborted the process (FATAL heap limit, exit 134), where the recursive version
 * threw a catchable RangeError. A small heap makes the abort fast and certain. The
 * check is on the active path, so it must not refuse valid trees however deep.
 */
describe('walking cyclic and very deep trees', () => {
  it('walk-cycle: a cycle throws InputError on a 64 MB heap instead of aborting', () => {
    const result = probe('walk-cycle', 3, ['--max-old-space-size=64']);
    expect(result.error).toMatch(/^InputError: Walk found a cycle/);
  }, 120_000);

  it('walk-command: a valid 300,000-link command spine walks to completion', () => {
    const result = probe('walk-command', 300_000);
    expect(result.entered).toStrictEqual(result.expected);
    expect(result.exits).toBe(total(result.expected));
  }, 120_000);

  it('walk-shared: shared subtrees below a checkpoint depth are not cycles', () => {
    expect(probe('walk-shared', 100_000).binary).toBe(99_999);
  }, 120_000);
});
