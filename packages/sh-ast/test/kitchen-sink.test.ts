/**
 * Kitchen-sink golden test — acceptance criteria 3 and 4 of
 * https://github.com/mike-north/eslint-sh/issues/6.
 *
 * Parses+normalizes a small set of fixtures exercising every mvdan/sh syntax
 * node type reachable via our shim (one per dialect, since some node types —
 * `FlagsArithm`, `TestDecl` — only exist in zsh/bats grammar) and asserts, in
 * both directions:
 *
 *   1. every node produced by a real parse has a *known* type (a key of the
 *      generated `CHILD_TYPE_SCHEMA` table) — "zero unknown-type nodes";
 *   2. every node type the generator discovered in mvdan/sh's `syntax`
 *      package is actually exercised by at least one fixture — so a future
 *      mvdan/sh bump that adds a node type our fixtures don't cover fails
 *      loudly here, rather than silently shipping an unreachable schema
 *      entry.
 *
 * This is the drift gate design/MILESTONES.md M1 calls for: "a golden test
 * parses a kitchen-sink fixture exercising every node type to catch drift."
 *
 * @see design/ARCHITECTURE.md — "The schema table is generated, not hand-written"
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHILD_TYPE_SCHEMA } from '../generated/child-type-schema.js';
import { parseSync } from '../src/index.js';
import type { ShellDialect } from '../src/index.js';
import type { ShNode } from '../src/types.js';
import { walk } from '../src/walk.js';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

/**
 * Asserts `value` is defined (with `message` as the failure explanation) and
 * returns it narrowed to `T`, without a forbidden non-null assertion.
 */
function assertDefined<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeDefined();
  if (value === undefined) throw new Error(message);
  return value;
}

function typesIn(file: ShNode): Set<string> {
  const seen = new Set<string>();
  walk(file, (node) => seen.add(node.type));
  return seen;
}

const ALL_SCHEMA_TYPES = new Set(Object.keys(CHILD_TYPE_SCHEMA));

/**
 * `BraceExp` is a real mvdan/sh node type — `Word.Parts` can hold one — but
 * it is only ever produced by explicitly calling `syntax.SplitBraces` on a
 * parsed word (see mvdan.cc/sh/v3/syntax's doc comment: "This node will only
 * appear as a result of [SplitBraces]"). Our shim (`shim/main.go`) never
 * calls it, so `BraceExp` is currently unreachable through this bridge's
 * parser, no matter what fixture we write. This is a deliberate, narrow
 * carve-out from the coverage requirement below — not a gap in the
 * generator or the fixtures — and it is the only one: every other schema
 * type must be exercised, or this test fails.
 *
 * TODO: calling `syntax.SplitBraces` from the shim would make brace-expansion
 * syntax (`{a,b}`, `{1..3}`) resolve to real `BraceExp` nodes instead of
 * opaque `Lit` text; deferred as a parser-behavior change, out of scope for
 * the generator work in issue #6.
 */
const KNOWN_UNREACHABLE_TYPES = new Set(['BraceExp']);

const fixtures: { label: string; dialect: ShellDialect; file: string }[] = [
  { label: 'bash', dialect: 'bash', file: 'kitchen-sink.bash.sh' },
  { label: 'zsh', dialect: 'zsh', file: 'kitchen-sink.zsh.sh' },
  { label: 'bats', dialect: 'bats', file: 'kitchen-sink.bats.sh' },
];

describe('kitchen-sink golden fixture', () => {
  it.each(fixtures)(
    'parses and normalizes the $label fixture with zero unknown-type nodes',
    ({ dialect, file }) => {
      const parsed = parseSync(fixture(file), { dialect });
      const types = typesIn(parsed);
      expect(types.size).toBeGreaterThan(0);
      for (const type of types) {
        expect(ALL_SCHEMA_TYPES.has(type), `"${type}" is not a known schema type`).toBe(true);
      }
    },
  );

  it('exercises every generated-schema node type across the fixtures (both directions)', () => {
    const exercised = new Set<string>();
    for (const { dialect, file } of fixtures) {
      for (const type of typesIn(parseSync(fixture(file), { dialect }))) {
        exercised.add(type);
      }
    }

    // Direction 1: everything we observed is a real, known schema type.
    for (const type of exercised) {
      expect(ALL_SCHEMA_TYPES.has(type), `observed unknown type "${type}"`).toBe(true);
    }

    // Direction 2: everything the generator knows about (minus the one
    // documented, structurally-unreachable exception) was observed.
    const requiredTypes = [...ALL_SCHEMA_TYPES].filter((t) => !KNOWN_UNREACHABLE_TYPES.has(t));
    const missing = requiredTypes.filter((t) => !exercised.has(t));
    expect(missing, `schema type(s) never exercised by any fixture: ${missing.join(', ')}`).toEqual(
      [],
    );

    // Sanity check on the exclusion itself: if a future mvdan/sh version (or
    // a shim change that starts calling SplitBraces) makes BraceExp
    // reachable, this test should start failing the exclusion instead of
    // silently under-covering — i.e. the exclusion list should shrink, not
    // grow. This assertion just documents the current, single exception.
    expect([...KNOWN_UNREACHABLE_TYPES]).toEqual(['BraceExp']);
  });

  it('exercises DeclClause.Variant (criterion 4: the motivating regression)', () => {
    const parsed = parseSync(fixture('kitchen-sink.bash.sh'), { dialect: 'bash' });
    const declClauses: ShNode[] = [];
    walk(parsed, (node) => {
      if (node.type === 'DeclClause') declClauses.push(node);
    });
    expect(declClauses.length).toBeGreaterThan(0);
    for (const decl of declClauses) {
      const variant = decl.variant as ShNode | undefined;
      expect(
        variant,
        'DeclClause.Variant must normalize to a child node, not be dropped',
      ).toBeDefined();
      expect(variant?.type).toBe('Lit');
      expect(typeof variant?.value).toBe('string');
    }
    // At least one of the exercised variants is a well-known declare-family
    // keyword — not just present, but carrying the right literal text.
    const variantValues = declClauses.map((d) => (d.variant as ShNode).value as string);
    expect(variantValues).toContain('declare');
  });

  /**
   * Regression test for issue #13: `ParamExp`'s `Exp`/`Repl`/`Slice` fields
   * point to `Expansion`/`Replace`/`Slice` — concrete mvdan/sh structs that
   * do *not* implement `syntax.Node` (no `Pos()`/`End()`), so typedjson
   * never gives them a `Type` discriminator or even a `Pos`/`End` pair.
   * Before the generator discovered these as auxiliary schema types (and
   * `normalize()` learned to synthesize their `range`/`loc` from their own
   * children), the entire `Exp`/`Repl`/`Slice` subtree was silently dropped
   * — `${USER:-nobody}`'s `nobody` default never reached the normalized
   * tree at all. The two-directional coverage test above would already
   * catch a full regression (an unexercised or unknown-typed `Expansion`/
   * `Replace`/`Slice`), but this test pins the actual data — the literal
   * operand text — not just "some node of the right type shape exists."
   */
  it('exercises ParamExp.Exp/.Repl/.Slice (regression for issue #13)', () => {
    const code = fixture('kitchen-sink.bash.sh');
    const parsed = parseSync(code, { dialect: 'bash' });

    const byType = (type: string): ShNode[] => {
      const found: ShNode[] = [];
      walk(parsed, (node) => {
        if (node.type === type) found.push(node);
      });
      return found;
    };

    const expansions = byType('Expansion');
    expect(expansions.length).toBeGreaterThan(0);
    const nobodyDefault = assertDefined(
      expansions.find((exp) => {
        const word = exp.word as ShNode | undefined;
        return word !== undefined && code.slice(word.range[0], word.range[1]) === 'nobody';
      }),
      '${USER:-nobody}\'s "nobody" default must survive normalization, not be dropped',
    );
    // The synthesized Expansion node's own range must still satisfy the
    // slice-fidelity invariant every ShNode carries (design/ARCHITECTURE.md's
    // "Normalized node shape") — here it's derived from its one child
    // (`Word`), so the two ranges coincide exactly.
    expect(code.slice(nobodyDefault.range[0], nobodyDefault.range[1])).toBe('nobody');

    const replaces = byType('Replace');
    expect(replaces.length).toBeGreaterThan(0);
    const fooBarReplace = assertDefined(
      replaces.find((r) => code.slice(r.range[0], r.range[1]) === 'foo/bar'),
      '${USER/foo/bar} must normalize to a Replace node spanning "foo/bar" (Orig.start..With.end)',
    );
    expect((fooBarReplace.orig as ShNode).type).toBe('Word');
    expect((fooBarReplace.with as ShNode).type).toBe('Word');

    const slices = byType('Slice');
    expect(slices.length).toBeGreaterThan(0);
    assertDefined(
      slices.find((s) => code.slice(s.range[0], s.range[1]) === '1:2'),
      '${USER:1:2} must normalize to a Slice node spanning "1:2" (Offset.start..Length.end)',
    );
  });
});
