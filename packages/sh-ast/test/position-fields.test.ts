/**
 * Coverage for issue #8: "replace the bare-name POS_KEYS denylist with
 * generated per-(type,field) position data".
 *
 * Three suites:
 *
 *   1. Hand-derived spot checks of the generated `POSITION_FIELDS` table
 *      against mvdan/sh v3.13.1's `syntax/nodes.go` directly (independent
 *      ground truth — not derived from the generator's own logic or from
 *      `normalize.ts`), mirroring `visitor-keys.test.ts`'s convention.
 *   2. Regression tests (criterion 3) for the three latent collisions the
 *      per-(type,field) table exposes beyond `Do`/`Dollar` (already fixed in
 *      issues #2/#3): `ForClause.Select`, `WhileClause.Until`, and
 *      `ArithmExp`/`ArithmCmd.Unsigned` — all plain `bool` fields that the
 *      old bare-name `POS_KEYS` denylist dropped unconditionally, even
 *      though none of them is a `Pos` in *any* mvdan/sh v3.13.1 struct.
 *   3. A completeness cross-check (criterion 4): parses+normalizes the
 *      kitchen-sink corpus (the same three dialect fixtures
 *      `kitchen-sink.test.ts` uses, plus three small snippets exercising the
 *      three collisions above) and walks the *raw* pre-normalization
 *      typedjson tree and the *normalized* tree in lockstep, asserting, for
 *      every field mvdan/sh's own encoder actually produced: a generated
 *      position field is absent from the normalized node, and every other
 *      field survives (present in the normalized node, with the exact same
 *      value for scalars). The oracle throughout is the generated
 *      `POSITION_FIELDS`/`CHILD_TYPE_SCHEMA` tables — never `normalize.ts`'s
 *      own behavior — so this test cannot become tautological.
 *
 * @see https://pkg.go.dev/mvdan.cc/sh/v3@v3.13.1/syntax — mvdan/sh's AST reference
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHILD_TYPE_SCHEMA } from '../generated/child-type-schema.js';
import { POSITION_FIELDS } from '../generated/position-fields.js';
import { parseSync } from '../src/index.js';
import type { ShNode } from '../src/index.js';
import { normalize } from '../src/normalize.js';
import type { JsonValue } from '../src/normalize.js';
import { callParse } from '../src/wasm-instance.js';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

/** Order-independent array equality, since field order isn't part of the contract. */
function expectSameFields(type: string, expectedFields: readonly string[]): void {
  const actual = POSITION_FIELDS[type];
  expect(actual, `no POSITION_FIELDS entry for "${type}"`).toBeDefined();
  expect([...actual].sort()).toEqual([...expectedFields].sort());
}

describe('POSITION_FIELDS — hand-derived from mvdan/sh v3.13.1 syntax/nodes.go', () => {
  it('Stmt: Position/Semicolon are positions; Negated/Background/Coprocess/Disown (bools) and Comments/Cmd/Redirs (children) are not', () => {
    expectSameFields('Stmt', ['Position', 'Semicolon']);
  });

  it('Lit: ValuePos/ValueEnd are positions; Value (string) is not', () => {
    expectSameFields('Lit', ['ValuePos', 'ValueEnd']);
  });

  it('SglQuoted: Left/Right are positions; Dollar (bool) and Value (string) are not', () => {
    expectSameFields('SglQuoted', ['Left', 'Right']);
  });

  it('DblQuoted: Left/Right are positions; Dollar (bool) is not', () => {
    expectSameFields('DblQuoted', ['Left', 'Right']);
  });

  it("ParamExp: Dollar/Rbrace are positions here (unlike SglQuoted/DblQuoted's Dollar, which is a bool)", () => {
    expectSameFields('ParamExp', ['Dollar', 'Rbrace']);
  });

  it('ForClause: ForPos/DoPos/DonePos are positions; Select/Braces (bools), Loop, and Do/DoLast (children) are not', () => {
    expectSameFields('ForClause', ['ForPos', 'DoPos', 'DonePos']);
  });

  it('WhileClause: WhilePos/DoPos/DonePos are positions; Until (bool) and Cond/Do/... (children) are not', () => {
    expectSameFields('WhileClause', ['WhilePos', 'DoPos', 'DonePos']);
  });

  it('ArithmExp: Left/Right are positions; Bracket/Unsigned (bools) and X (child) are not', () => {
    expectSameFields('ArithmExp', ['Left', 'Right']);
  });

  it('ArithmCmd: Left/Right are positions; Unsigned (bool) and X (child) are not', () => {
    expectSameFields('ArithmCmd', ['Left', 'Right']);
  });

  it('CaseClause: Case/In/Esac are positions; Braces (bool) and Word/Items/Last (children) are not', () => {
    expectSameFields('CaseClause', ['Case', 'In', 'Esac']);
  });

  it('File: no field of File itself is a Pos (its Pos()/End() are computed dynamically from Stmts/Last)', () => {
    expectSameFields('File', []);
  });

  it('Assign: has no Pos-typed field at all (its Pos()/End() are computed dynamically from Name/Value/Array/Index)', () => {
    expectSameFields('Assign', []);
  });
});

describe('POSITION_FIELDS — structural invariants', () => {
  it('has an entry for every node type the table declares', () => {
    expect(Object.keys(POSITION_FIELDS).length).toBeGreaterThan(20);
  });

  it('every value is an array of non-empty, Go-cased (capitalized) field names, each unique', () => {
    for (const fields of Object.values(POSITION_FIELDS)) {
      expect(Array.isArray(fields)).toBe(true);
      for (const field of fields) {
        expect(typeof field).toBe('string');
        expect(field.length).toBeGreaterThan(0);
        expect(field[0]).toBe(field[0].toUpperCase());
      }
      expect(new Set(fields).size).toBe(fields.length);
    }
  });

  it("is frozen: reassigning an existing type's field list throws in strict mode", () => {
    expect(() => {
      // @ts-expect-error — deliberately testing the runtime Object.freeze.
      POSITION_FIELDS.Stmt = ['Position', 'Semicolon', 'Extra'];
    }).toThrow(TypeError);
  });
});

describe('parseSync — issue #8: latent POS_KEYS collisions (criterion 3)', () => {
  it('preserves ForClause.Select: true for a "select ... in ...; do ...; done" loop', () => {
    const file = parseSync('select opt in a b; do echo "$opt"; break; done');
    let forClause: ShNode | undefined;
    for (const stmt of file.stmts) {
      if ((stmt as { cmd?: ShNode }).cmd?.type === 'ForClause') {
        forClause = (stmt as { cmd?: ShNode }).cmd;
      }
    }
    expect(forClause, 'expected a ForClause in "select opt in a b; ..."').toBeDefined();
    expect(forClause?.select).toBe(true);
  });

  it('omits ForClause.select for a plain "for ... in ...; do ...; done" loop', () => {
    const file = parseSync('for i in a b; do echo "$i"; done');
    const forClause = (file.stmts[0] as { cmd?: ShNode } | undefined)?.cmd;
    expect(forClause?.type).toBe('ForClause');
    expect(forClause?.select).toBeUndefined();
  });

  it('preserves WhileClause.Until: true for an "until ...; do ...; done" loop', () => {
    const file = parseSync('until false; do echo hi; done');
    const whileClause = (file.stmts[0] as { cmd?: ShNode } | undefined)?.cmd;
    expect(whileClause?.type).toBe('WhileClause');
    expect(whileClause?.until).toBe(true);
  });

  it('omits WhileClause.until for a plain "while ...; do ...; done" loop', () => {
    const file = parseSync('while true; do echo hi; done');
    const whileClause = (file.stmts[0] as { cmd?: ShNode } | undefined)?.cmd;
    expect(whileClause?.type).toBe('WhileClause');
    expect(whileClause?.until).toBeUndefined();
  });

  it('preserves ArithmExp.Unsigned: true for mksh\'s "$((# expr))" form', () => {
    const file = parseSync('echo $((# 1 + 2))\n', { dialect: 'mksh' });
    // File -> Stmt -> CallExpr -> args[1] ("$((# 1 + 2))" Word, args[0] is
    // "echo") -> parts[0] (ArithmExp)
    const cmd = (file.stmts[0] as { cmd?: ShNode } | undefined)?.cmd;
    const args = cmd?.args as ShNode[] | undefined;
    const parts = args?.[1]?.parts as ShNode[] | undefined;
    const arithmExp = parts?.[0];
    expect(arithmExp?.type).toBe('ArithmExp');
    expect(arithmExp?.unsigned).toBe(true);
  });

  it('preserves ArithmCmd.Unsigned: true for mksh\'s "((# expr))" form', () => {
    const file = parseSync('((# 1 + 2))\n', { dialect: 'mksh' });
    const arithmCmd = (file.stmts[0] as { cmd?: ShNode } | undefined)?.cmd;
    expect(arithmCmd?.type).toBe('ArithmCmd');
    expect(arithmCmd?.unsigned).toBe(true);
  });

  it('omits ArithmExp.unsigned/ArithmCmd.unsigned for the plain (signed) forms', () => {
    const file = parseSync('echo $((1 + 2))\n((3 + 4))\n', { dialect: 'mksh' });
    const cmd = (file.stmts[0] as { cmd?: ShNode } | undefined)?.cmd;
    const args = cmd?.args as ShNode[] | undefined;
    const parts = args?.[1]?.parts as ShNode[] | undefined;
    expect(parts?.[0]?.type).toBe('ArithmExp');
    expect(parts?.[0]?.unsigned).toBeUndefined();

    const arithmCmd = (file.stmts[1] as { cmd?: ShNode } | undefined)?.cmd;
    expect(arithmCmd?.type).toBe('ArithmCmd');
    expect(arithmCmd?.unsigned).toBeUndefined();
  });
});

describe('completeness cross-check (criterion 4): raw typedjson tree vs. normalized tree, both directions', () => {
  type JsonObject = Record<string, JsonValue>;

  function isJsonObject(value: JsonValue): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Parses `code` under `dialect` and returns both the raw pre-normalization
   * typedjson tree (straight from the shim, before `normalize()` ever runs)
   * and the fully normalized tree — derived from that exact same raw value —
   * so the two can be walked in lockstep below.
   */
  function parseBoth(code: string, dialect: string): { raw: JsonObject; normalized: ShNode } {
    const envelope: unknown = JSON.parse(callParse(code, dialect, 'input.sh'));
    if (typeof envelope !== 'object' || envelope === null || !('file' in envelope)) {
      throw new Error(`callParse returned an unexpected envelope for: ${code}`);
    }
    const file = (envelope as { file?: unknown }).file;
    if (!isJsonObject(file as JsonValue)) {
      throw new Error(`callParse's envelope had no usable "file" for: ${code}`);
    }
    const raw = file as JsonObject;
    return { raw, normalized: normalize(raw, code) };
  }

  /**
   * Resolves the concrete node type name for a raw sub-object: its own
   * "Type" discriminator when the encoder set one (interface-typed fields
   * and the root — see `shim/internal/nodeencode/encode.go`), else the
   * declared static `childType` the generated `CHILD_TYPE_SCHEMA` assigns to
   * this field (undiscriminated concrete-struct fields, e.g.
   * `Redirect.N` -> `Lit`, or the non-`Node` auxiliary structs `Expansion`/
   * `Replace`/`Slice`). This mirrors how `normalize()` itself resolves a
   * field's child type, but is re-derived here independently from the
   * generated schema table alone.
   */
  function resolveType(raw: JsonObject, declaredChildType: string | null): string {
    if (typeof raw.Type === 'string') return raw.Type;
    if (declaredChildType !== null) return declaredChildType;
    throw new Error(`cannot resolve a type for raw node ${JSON.stringify(raw).slice(0, 160)}`);
  }

  /** Every (nodeType, rawFieldName) pair actually observed across the whole
   * corpus below, whether it turned out to be a position field or real
   * data — used after the corpus loop to assert the three collision fields
   * (criterion 3) were genuinely exercised, not just declared in the table. */
  const observedNonPositionFields = new Set<string>();

  function checkField(
    parentType: string,
    key: string,
    rawValue: JsonValue,
    normalizedParent: ShNode,
  ): void {
    if (key === 'Type' || key === 'Pos' || key === 'End') return;
    const outKey = key.toLowerCase();
    const positionFields: readonly string[] = POSITION_FIELDS[parentType] ?? [];
    const normalizedRecord = normalizedParent as unknown as Record<string, unknown>;

    if (positionFields.includes(key)) {
      expect(
        outKey in normalizedRecord,
        `${parentType}.${key} is a generated position field and must NOT survive as "${outKey}"`,
      ).toBe(false);
      return;
    }

    observedNonPositionFields.add(`${parentType}.${key}`);
    expect(
      outKey in normalizedRecord,
      `${parentType}.${key} is real data (absent from the generated position-fields table) and must survive normalization as "${outKey}"`,
    ).toBe(true);

    const schema = CHILD_TYPE_SCHEMA[parentType] ?? {};
    const declaredChildType = schema[key] ?? null;
    const normalizedValue = normalizedRecord[outKey];

    if (Array.isArray(rawValue)) {
      expect(
        Array.isArray(normalizedValue),
        `${parentType}.${key} must normalize to an array`,
      ).toBe(true);
      const normArr = normalizedValue as unknown[];
      expect(normArr.length).toBe(rawValue.length);
      rawValue.forEach((item, i) => {
        if (isJsonObject(item)) {
          const childType = resolveType(item, declaredChildType);
          checkNode(childType, item, normArr[i] as ShNode);
        } else {
          expect(normArr[i]).toEqual(item);
        }
      });
      return;
    }

    if (isJsonObject(rawValue)) {
      const childType = resolveType(rawValue, declaredChildType);
      checkNode(childType, rawValue, normalizedValue as ShNode);
      return;
    }

    // A plain scalar (string/number/boolean) must survive verbatim.
    expect(normalizedValue).toEqual(rawValue);
  }

  function checkNode(type: string, raw: JsonObject, normalized: ShNode): void {
    expect(normalized.type, `expected a normalized "${type}" node`).toBe(type);
    for (const [key, value] of Object.entries(raw)) {
      checkField(type, key, value, normalized);
    }
  }

  const corpus: { label: string; dialect: string; code: string }[] = [
    { label: 'kitchen-sink/bash', dialect: 'bash', code: fixture('kitchen-sink.bash.sh') },
    { label: 'kitchen-sink/zsh', dialect: 'zsh', code: fixture('kitchen-sink.zsh.sh') },
    { label: 'kitchen-sink/bats', dialect: 'bats', code: fixture('kitchen-sink.bats.sh') },
    {
      label: 'select (ForClause.Select)',
      dialect: 'bash',
      code: 'select opt in a b; do echo "$opt"; break; done\n',
    },
    {
      label: 'until (WhileClause.Until)',
      dialect: 'bash',
      code: 'until false; do echo hi; done\n',
    },
    {
      label: 'mksh unsigned arithmetic (ArithmExp/ArithmCmd.Unsigned)',
      dialect: 'mksh',
      code: 'echo $((# 1 + 2))\n((# 3 + 4))\n',
    },
  ];

  it.each(corpus)(
    '$label: every position field is dropped, every other field survives',
    ({ dialect, code }) => {
      const { raw, normalized } = parseBoth(code, dialect);
      checkNode('File', raw, normalized);
    },
  );

  it('the corpus above genuinely exercises all three criterion-3 collision fields (Select/Until/Unsigned)', () => {
    for (const { dialect, code } of corpus) {
      const { raw, normalized } = parseBoth(code, dialect);
      checkNode('File', raw, normalized);
    }
    expect([...observedNonPositionFields]).toEqual(
      expect.arrayContaining([
        'ForClause.Select',
        'WhileClause.Until',
        'ArithmExp.Unsigned',
        'ArithmCmd.Unsigned',
      ]),
    );
  });
});
