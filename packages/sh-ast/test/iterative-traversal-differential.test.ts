/**
 * Differential proof that the explicit-stack traversals behave exactly like the
 * recursive implementations they replaced. Each recursive original is kept under
 * test/reference/ (test-only, never exported) and both versions run over the whole
 * corpus the suite already parses, plus malformed, mutated and cyclic graphs.
 *
 * Compared: the complete Walk visit sequence including null exits, pruning at many
 * points, exceptions raised at many points (with the deferred-comment unwinding that
 * follows), snapshot visit order, position/end results and panics, encodeWire bytes
 * and errors, decodeWire output and errors, and validator and position-restore
 * verdicts and resulting graphs.
 *
 * @see https://pkg.go.dev/mvdan.cc/sh/v3/syntax#Walk
 */
import { describe, expect, it } from 'vitest';
import { SYNTAX_SCHEMA } from '../generated/syntax-schema.js';
import type { File, Node } from '../generated/syntax-types.js';
import { visitNodes } from '../src/syntax-snapshot.js';
import { end, position } from '../src/syntax-walk-bounds.js';
import { walk } from '../src/syntax-walk.js';
import * as iterative from '../src/syntax-wire.js';
import { buildCorpus } from './differential-corpus.js';
import * as recursive from './reference/recursive-syntax-wire.js';
import { visitNodes as recursiveVisitNodes } from './reference/recursive-syntax-snapshot.js';
import * as recursiveBounds from './reference/recursive-syntax-walk-bounds.js';
import { walk as recursiveWalk } from './reference/recursive-syntax-walk.js';

const corpus = buildCorpus();

/** A result or the class and message of what was thrown. */
type Outcome<T> = { readonly value: T } | { readonly thrown: string };

/** Captures a function's result, or the identity-relevant description of its failure. */
function outcome<T>(run: () => T): Outcome<T> {
  try {
    return { value: run() };
  } catch (error) {
    return {
      thrown:
        error instanceof Error
          ? `${error.constructor.name}: ${error.message}`
          : `non-error: ${String(error)}`,
    };
  }
}

/** Deterministic 32-bit generator so every run mutates the same places. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a Walk callback saw, in order: nodes by identity and null for exits. */
type Events = (Node | null)[];

/** Callback factories, each a fresh behaviour over the same tree. */
const sentinel = new Error('thrown by the callback');
interface Scenario {
  readonly name: string;
  /** Builds a callback; `size` is the unpruned event count of this tree. */
  readonly make: (size: number, events: Events) => (node: Node | null) => unknown;
}
const scenarios: Scenario[] = [
  { name: 'visit everything', make: (_, events) => (node) => (events.push(node), true) },
  ...[1, 2, 3, 10, 100].map((k): Scenario => ({
    name: `prune entry ${String(k)}`,
    make: (_, events) => {
      let entries = 0;
      return (node) => {
        events.push(node);
        return node === null || ++entries !== k;
      };
    },
  })),
  ...['Stmt', 'Word', 'CallExpr', 'BinaryCmd', 'ParamExp', 'Comment', 'DblQuoted'].map(
    (type): Scenario => ({
      name: `prune every ${type}`,
      make: (_, events) => (node) => (events.push(node), node?.Type !== type),
    }),
  ),
  {
    name: 'prune every seventh entry',
    make: (_, events) => {
      let entries = 0;
      return (node) => (events.push(node), node === null || ++entries % 7 !== 0);
    },
  },
  ...[1, 2, 5, 50, 'middle', 'penultimate', 'last'].map((point): Scenario => ({
    name: `throw at call ${String(point)}`,
    make: (size, events) => {
      const target =
        point === 'middle'
          ? Math.floor(size / 2)
          : point === 'penultimate'
            ? size - 1
            : point === 'last'
              ? size
              : point;
      let calls = 0;
      return (node) => {
        events.push(node);
        if (++calls === target) throw sentinel;
        return true;
      };
    },
  })),
  {
    name: 'non-boolean result at call 4',
    make: (_, events) => {
      let calls = 0;
      return (node) => (events.push(node), ++calls === 4 ? 'yes' : true);
    },
  },
];

/** Runs one walk implementation, returning its events and outcome. */
function observe(
  run: (root: Node, callback: (node: Node | null) => boolean) => void,
  root: Node,
  scenario: Scenario,
  size: number,
): { events: Events; result: Outcome<undefined> } {
  const events: Events = [];
  const callback = scenario.make(size, events) as (node: Node | null) => boolean;
  const result = outcome(() => {
    run(root, callback);
    return undefined;
  });
  return { events, result };
}

/**
 * Walk hands each Stmt/CaseItem/ArrayElem comment callback a fresh copy, so those events
 * match by value; every other event must be the very same node object.
 */
function sameEvent(a: Node | null, b: Node | null): boolean {
  if (a === b) return true;
  return a?.Type === 'Comment' && b?.Type === 'Comment' && JSON.stringify(a) === JSON.stringify(b);
}

/** Throws an assertion naming the first diverging event, without printing whole trees. */
function expectSameEvents(actual: Events, expected: Events, context: string): void {
  const limit = Math.min(actual.length, expected.length);
  for (let index = 0; index < limit; index++) {
    if (!sameEvent(actual[index], expected[index])) {
      throw new Error(
        `${context}: event ${String(index)} differs (${String(actual[index]?.Type)} vs ${String(expected[index]?.Type)})`,
      );
    }
  }
  expect(actual.length, `${context}: event count`).toBe(expected.length);
}

describe('iterative Walk matches the recursive reference', () => {
  it('has a substantial corpus', () => {
    expect(corpus.length).toBeGreaterThan(300);
  });

  it('visits identically across every scenario for every corpus tree', () => {
    let compared = 0;
    for (const { label, file } of corpus) {
      const full = observe(recursiveWalk, file, scenarios[0], 0);
      const size = full.events.length;
      for (const scenario of scenarios) {
        const expected = observe(recursiveWalk, file, scenario, size);
        const actual = observe(walk, file, scenario, size);
        const context = `${label} / ${scenario.name}`;
        expectSameEvents(actual.events, expected.events, context);
        expect(actual.result, context).toStrictEqual(expected.result);
        compared += actual.events.length;
      }
    }
    expect(compared).toBeGreaterThan(100_000);
  });

  it('keeps the replacement exception when a deferred comment callback also throws', () => {
    for (const { label, file } of corpus.filter((_, index) => index % 5 === 0)) {
      for (const failAfterThrow of [true, false]) {
        const run = (impl: typeof walk): { events: Events; result: Outcome<undefined> } => {
          const events: Events = [];
          let thrown = false;
          const result = outcome(() => {
            impl(file, (node) => {
              events.push(node);
              if (node?.Type === 'Comment' && !thrown) {
                thrown = true;
                throw new Error('first comment');
              }
              if (node?.Type === 'Comment' && failAfterThrow) throw new Error('later comment');
              return true;
            });
            return undefined;
          });
          return { events, result };
        };
        const expected = run(recursiveWalk);
        const actual = run(walk);
        expectSameEvents(actual.events, expected.events, label);
        expect(actual.result, label).toStrictEqual(expected.result);
      }
    }
  });

  it('reads live edits identically', () => {
    // Appending to and replacing within an active list while walking.
    for (const { label, file } of corpus.filter((_, index) => index % 7 === 0)) {
      const run = (impl: typeof walk): Events => {
        const copy = structuredClone(file);
        const events: Events = [];
        impl(copy, (node) => {
          events.push(node);
          if (node?.Type === 'Stmt' && node.Comments !== null && node.Comments.length > 0) {
            node.Comments.pop();
          }
          if (node?.Type === 'File') copy.Stmts?.reverse();
          return true;
        });
        return events.map((event) => (event === null ? null : ({ Type: event.Type } as Node)));
      };
      expect(
        run(walk).map((e) => e?.Type ?? null),
        label,
      ).toStrictEqual(run(recursiveWalk).map((e) => e?.Type ?? null));
    }
  });
});

/** Every distinct Node in a tree, in walk order. */
function treeNodes(file: File): Node[] {
  const seen = new Set<Node>();
  recursiveWalk(file, (node) => {
    if (node !== null) seen.add(node);
    return true;
  });
  return [...seen];
}

describe('iterative position and end match the recursive reference', () => {
  it('returns the same bound or panic for every node of every corpus tree', () => {
    let compared = 0;
    for (const { label, file } of corpus) {
      for (const node of treeNodes(file)) {
        expect(
          outcome(() => position(node)),
          `${label} position ${node.Type}`,
        ).toStrictEqual(outcome(() => recursiveBounds.position(node)));
        expect(
          outcome(() => end(node)),
          `${label} end ${node.Type}`,
        ).toStrictEqual(outcome(() => recursiveBounds.end(node)));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(10_000);
  });

  it('agrees on nil dependencies and unsupported nodes', () => {
    for (const value of [null, { Type: 'TypedNil', Kind: 'Word' } as Node]) {
      expect(outcome(() => position(value))).toStrictEqual(
        outcome(() => recursiveBounds.position(value)),
      );
      expect(outcome(() => end(value))).toStrictEqual(outcome(() => recursiveBounds.end(value)));
    }
  });
});

describe('iterative snapshot visit matches the recursive reference', () => {
  it('observes the same nodes in the same order', () => {
    for (const { label, file } of corpus) {
      const actual: Node[] = [];
      const expected: Node[] = [];
      visitNodes(file, (node) => actual.push(node));
      recursiveVisitNodes(file, (node) => expected.push(node));
      expectSameEvents(actual, expected, label);
    }
  });
});

/** Values that exercise every encodeWire branch and failure. */
function encodeCases(): [string, unknown][] {
  const cyclicRecord: Record<string, unknown> = { Type: 'X' };
  cyclicRecord.self = cyclicRecord;
  const cyclicArray: unknown[] = [1];
  cyclicArray.push(cyclicArray);
  const indirect: Record<string, unknown> = { a: { b: [] as unknown[] } };
  (indirect.a as { b: unknown[] }).b.push(indirect);
  const shared = { Type: 'Shared', n: 1 };
  const sparse = [1, , 3]; // holes are the case under test
  const holey: unknown[] = new Array<unknown>(3);
  holey[2] = { z: 1n };
  const withProto: unknown = JSON.parse(
    '{"__proto__":{"a":1},"toJSON":"x","1":2,"b":[{"__proto__":null}]}',
  );
  return [
    ['string', 'plain "quoted" \n  é 🎉'],
    ['unpaired surrogate', '\ud800'],
    ['nested unpaired surrogate', { a: ['ok', '\udc00'] }],
    ['bigint', 123456789012345678901234567890n],
    ['bytes', new Uint8Array([0, 1, 255, 254])],
    ['bytes in record', { a: new Uint8Array([200, 201]), b: [new Uint8Array(0)] }],
    ['null', null],
    ['booleans', [true, false]],
    ['safe integers', [0, -0, 1, -1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]],
    ['fraction', 1.5],
    ['NaN', { a: NaN }],
    ['infinity', [Infinity]],
    ['unsafe integer', 2 ** 53],
    ['undefined', undefined],
    ['nested undefined', { a: undefined }],
    ['function', () => 1],
    ['symbol', Symbol('s')],
    ['nested symbol', [Symbol('s')]],
    ['cyclic record', cyclicRecord],
    ['cyclic array', cyclicArray],
    ['indirect cycle', indirect],
    ['shared acyclic subrecord', { x: shared, y: [shared, shared] }],
    ['sparse array', sparse],
    ['array with trailing hole holding bigint', holey],
    ['empty containers', { a: {}, b: [], c: [[], {}] }],
    ['map (not a data record)', new Map()],
    ['date', new Date(0)],
    [
      'class instance',
      new (class Box {
        value = 1;
      })(),
    ],
    ['own __proto__/toJSON/integer keys', withProto],
    ['deep arrays', [[[[[[[[1]]]]]]]]],
    ['error ordering: second problem not reported first', { a: 1.5, b: '\ud800' }],
    [
      'error ordering: cycle before later bad number',
      (() => {
        const a: Record<string, unknown> = { n: 1 };
        a.c = a;
        a.bad = 1.5;
        return a;
      })(),
    ],
    ...corpus
      .filter((_, index) => index % 3 === 0)
      .map((c): [string, unknown] => [c.label, c.file]),
  ];
}

describe('iterative encodeWire matches the recursive reference', () => {
  it('produces identical text or an identical failure', () => {
    for (const [name, value] of encodeCases()) {
      expect(
        outcome(() => iterative.encodeWire(value)),
        name,
      ).toStrictEqual(outcome(() => recursive.encodeWire(value)));
    }
  });

  it('encodes whole corpus trees byte for byte', () => {
    for (const { label, file } of corpus) {
      expect(iterative.encodeWire(file) === recursive.encodeWire(file), label).toBe(true);
    }
  });
});

describe('iterative decodeWire matches the recursive reference', () => {
  const texts = [
    '{"Bytes":"AQID"}',
    '[{"Bytes":"AQID"},[{"Bytes":"/w=="}],{"a":{"Bytes":"AA=="}}]',
    '{"a":{"Bytes":"AQID","x":1},"b":"Bytes","c":{"Bytes":5}}',
    '{"Bytes":"!!"}',
    '{"a":[1,{"Bytes":"AQ"}]}',
    '{"__proto__":{"Bytes":"AQID"},"k":[{"Bytes":"AQID"}]}',
    '{"Int":"5","Bytes":"AQID"}',
    '"Bytes"',
    'not json',
    '[[],{},null,true,1]',
  ];
  it('restores byte tags identically and reports the same errors', () => {
    for (const text of texts) {
      expect(
        outcome(() => iterative.decodeWire(text)),
        text,
      ).toStrictEqual(outcome(() => recursive.decodeWire(text)));
    }
  });
  it('restores bytes inside corpus trees', () => {
    for (const { label, file } of corpus.filter((_, index) => index % 4 === 0)) {
      const copy = structuredClone(file) as unknown as Record<string, unknown>;
      copy.Marker = { Bytes: 'AQID' };
      const text = JSON.stringify(copy);
      expect(iterative.decodeWire(text), label).toStrictEqual(recursive.decodeWire(text));
    }
  });
});

/** All records reachable in a graph, in a stable order, without recursing. */
function records(root: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const pending = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) pending.push(...(value as unknown[]));
    else {
      found.push(value as Record<string, unknown>);
      pending.push(...Object.values(value as Record<string, unknown>));
    }
  }
  return found;
}

const TYPES = Object.keys(SYNTAX_SCHEMA);

/** Applies one deterministic corruption; returns whether it introduced a cycle. */
function corrupt(root: unknown, random: () => number): { cyclic: boolean } {
  const all = records(root).filter((record) => typeof record.Type === 'string');
  if (all.length === 0) return { cyclic: false };
  const target = all[Math.floor(random() * all.length)];
  const keys = Object.keys(target).filter((key) => key !== 'Type');
  if (keys.length === 0) return { cyclic: false };
  const key = keys[Math.floor(random() * keys.length)];
  const roll = Math.floor(random() * 12);
  switch (roll) {
    case 0:
      Reflect.deleteProperty(target, key);
      break;
    case 1:
      target.Extra = 1;
      break;
    case 2:
      target[key] = null;
      break;
    case 3:
      target[key] = 'wrong';
      break;
    case 4:
      target[key] = typeof target[key] === 'number' ? 99_999 : 7;
      break;
    case 5:
      target.Type = TYPES[Math.floor(random() * TYPES.length)];
      break;
    case 6: {
      const value = target[key];
      if (Array.isArray(value) && value.length > 0) Reflect.deleteProperty(value, 0);
      else target[key] = [];
      break;
    }
    case 7:
      target[key] = { Type: 'TypedNil', Kind: TYPES[Math.floor(random() * TYPES.length)] };
      break;
    case 8: {
      const donor = all[Math.floor(random() * all.length)];
      target[key] = donor; // shared record, possibly the wrong shape
      return { cyclic: records(donor).includes(target) };
    }
    case 9:
      target[key] = typeof target[key] === 'boolean' ? 1 : true;
      break;
    case 10:
      target.Type = 5;
      break;
    default: {
      const value = target[key];
      if (Array.isArray(value)) value.push(null);
      else target[key] = [target];
      return { cyclic: !Array.isArray(value) };
    }
  }
  return { cyclic: false };
}

/** Replaces each SyntaxPos record with the bridge's compact [Offset, Line, Col, Flags] tuple. */
function compact(value: unknown): unknown {
  const flags = (p: Record<string, unknown>): number =>
    (p.IsValid === true ? 1 : 0) |
    (p.IsRecovered === true ? 2 : 0) |
    (p.OffsetOverflow === true ? 4 : 0);
  const isPos = (v: Record<string, unknown>): boolean =>
    'Offset' in v && 'OffsetOverflow' in v && !('Type' in v);
  for (const record of records(value)) {
    for (const [key, child] of Object.entries(record)) {
      if (
        typeof child === 'object' &&
        child !== null &&
        !Array.isArray(child) &&
        isPos(child as Record<string, unknown>)
      ) {
        const p = child as Record<string, unknown>;
        record[key] = [p.Offset, p.Line, p.Col, flags(p)];
      }
    }
  }
  return value;
}

describe('iterative validation matches the recursive reference', () => {
  it('agrees on every unmodified corpus tree and each of its subtrees', () => {
    for (const { label, file } of corpus) {
      expect(iterative.isSyntaxFile(file), label).toBe(true);
      for (const node of treeNodes(file).filter((_, index) => index % 11 === 0)) {
        expect(iterative.isSyntaxNode(node), label).toBe(recursive.isSyntaxNode(node));
      }
    }
  });

  it('agrees on corrupted, aliased and cyclic graphs', () => {
    const random = generator(0x5eed);
    let rejected = 0;
    let accepted = 0;
    for (const { label, file } of corpus) {
      for (let round = 0; round < 8; round++) {
        const copy = structuredClone(file);
        for (let edit = 0; edit <= round % 3; edit++) corrupt(copy, random);
        const actual = outcome(() => iterative.isSyntaxFile(copy));
        const expected = outcome(() => recursive.isSyntaxFile(copy));
        expect(actual, `${label} round ${String(round)}`).toStrictEqual(expected);
        if ('value' in actual && actual.value) accepted++;
        else rejected++;
      }
    }
    // The mutations must produce both verdicts or the comparison proves little.
    expect(rejected).toBeGreaterThan(500);
    expect(accepted).toBeGreaterThan(20);
  });

  it('rejects cycles through arrays and records like the reference', () => {
    for (const { label, file } of corpus.filter((_, index) => index % 9 === 0)) {
      const copy = structuredClone(file);
      const record = copy as unknown as { Stmts: unknown[] | null };
      record.Stmts = [...(record.Stmts ?? []), copy];
      expect(iterative.isSyntaxFile(copy), label).toBe(false);
      expect(recursive.isSyntaxFile(copy), label).toBe(false);
    }
  });

  it('restores compact positions to the same graph and verdict', () => {
    const random = generator(0xfeed);
    for (const { label, file } of corpus) {
      for (let round = 0; round < 3; round++) {
        const build = (): unknown => {
          const copy = compact(structuredClone(file));
          if (round > 0) {
            const local = generator(round * 977);
            // Skip cyclic corruption: a restored response is always a fresh JSON tree.
            for (let tries = 0; tries < 8; tries++) if (!corrupt(copy, local).cyclic) break;
          }
          return copy;
        };
        void random;
        const first = build();
        const second = build();
        const actual = outcome(() => iterative.restoreSyntaxFile(first));
        const expected = outcome(() => recursive.restoreSyntaxFile(second));
        expect(actual, `${label} round ${String(round)}`).toStrictEqual(expected);
        // A failing restore leaves the graph partly restored; the partial state must match too.
        expect(first, `${label} round ${String(round)} graph`).toStrictEqual(second);
      }
    }
  });
});
