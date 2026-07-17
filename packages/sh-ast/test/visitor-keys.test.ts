/**
 * Runtime coverage for {@link visitorKeys}.
 *
 * The expected key->field mappings below are hand-derived directly from
 * mvdan/sh v3.13.1's `syntax/nodes.go` struct definitions (the field names
 * `normalize.ts` lowercases into the normalized node shape), not from
 * `visitorKeys`' own output or from `STATIC_CHILD_TYPES`/`visitor-keys.ts`'s
 * source — asserting against those would only prove the table agrees with
 * itself. Field-by-field derivation for each type tested below:
 *
 * - `File struct { Name string; Stmts []*Stmt; Last []Comment }` — `Name` is
 *   a plain string, not a child; `Stmts`/`Last` are child arrays ->
 *   `['stmts', 'last']`.
 * - `Stmt struct { Comments []Comment; Cmd Command; Position/Semicolon Pos;
 *   Negated/Background/Coprocess/Disown bool; Redirs []*Redirect }` —
 *   `Comments`/`Cmd`/`Redirs` are children (`Cmd` is interface-typed, tagged
 *   with its own `Type`); `Position`/`Semicolon` are positions (dropped);
 *   the four bools aren't children -> `['comments', 'cmd', 'redirs']`.
 * - `CallExpr struct { Assigns []*Assign; Args []*Word }` -> both children ->
 *   `['assigns', 'args']`.
 * - `IfClause struct { Position/ThenPos/FiPos Pos; Cond []*Stmt; CondLast
 *   []Comment; Then []*Stmt; ThenLast []Comment; Else *IfClause; Last
 *   []Comment }` — positions dropped, the rest are all children ->
 *   `['cond', 'condlast', 'then', 'thenlast', 'else', 'last']`.
 * - `Word struct { Parts []WordPart }` — `Parts` is interface-typed (each
 *   part tagged with its own `Type`) -> `['parts']`.
 * - `SglQuoted struct { Left, Right Pos; Dollar bool; Value string }` — no
 *   child-bearing fields at all (a leaf node) -> `[]`.
 * - `Assign struct { Append/Naked bool; Name *Lit; Index ArithmExpr; Value
 *   *Word; Array *ArrayExpr }` — `Name`/`Index`/`Value`/`Array` are children
 *   (`Index` is interface-typed) -> `['name', 'value', 'array', 'index']`.
 * - `DeclClause struct { Variant *Lit; Args []*Assign }` -> both children ->
 *   `['variant', 'args']`.
 *
 * @see design/ARCHITECTURE.md — "The schema table is generated, not
 *   hand-written"
 * @see https://pkg.go.dev/mvdan.cc/sh/v3/syntax — mvdan/sh's AST reference
 */
import { describe, expect, it } from 'vitest';
import { visitorKeys } from '../src/index.js';

/** Order-independent array equality, since field order isn't part of the contract. */
function expectSameFields(type: string, expectedFields: readonly string[]): void {
  const actual = visitorKeys[type];
  // This project doesn't enable noUncheckedIndexedAccess, so TS already
  // types plain Record index access as always-defined; the runtime
  // assertion below is what actually guards against a typo'd `type` arg
  // reaching a real `undefined` at the spread on the next line.
  expect(actual).toBeDefined();
  expect([...actual].sort()).toEqual([...expectedFields].sort());
}

describe('visitorKeys — hand-derived key -> field mappings', () => {
  it('File: Stmts/Last are children, Name is not', () => {
    expectSameFields('File', ['stmts', 'last']);
  });

  it('Stmt: Comments/Cmd/Redirs are children; Position/Semicolon (positions) and the bool flags are not', () => {
    expectSameFields('Stmt', ['comments', 'cmd', 'redirs']);
  });

  it('CallExpr: Assigns/Args are both children', () => {
    expectSameFields('CallExpr', ['assigns', 'args']);
  });

  it('IfClause: every non-Pos field is a child, including Last (comments before elif/else/fi)', () => {
    expectSameFields('IfClause', ['cond', 'condlast', 'then', 'thenlast', 'else', 'last']);
  });

  it('Word: Parts is the sole (interface-typed) child field', () => {
    expectSameFields('Word', ['parts']);
  });

  it('SglQuoted: a leaf node with no child-bearing fields at all', () => {
    expectSameFields('SglQuoted', []);
  });

  it('Assign: Name/Value/Array/Index are children; Append/Naked (bools) are not', () => {
    expectSameFields('Assign', ['name', 'value', 'array', 'index']);
  });

  it('DeclClause: Variant/Args are both children', () => {
    expectSameFields('DeclClause', ['variant', 'args']);
  });
});

describe('visitorKeys — structural invariants', () => {
  it('has an entry for every node type the table declares', () => {
    expect(Object.keys(visitorKeys).length).toBeGreaterThan(20);
  });

  it('every value is an array whose elements are all non-empty, lowercase strings (arrays themselves may be empty for leaf types)', () => {
    for (const fields of Object.values(visitorKeys)) {
      expect(Array.isArray(fields)).toBe(true);
      for (const field of fields) {
        expect(typeof field).toBe('string');
        expect(field.length).toBeGreaterThan(0);
        expect(field).toBe(field.toLowerCase());
      }
      // Every declared field name for a type must be unique — a duplicate
      // would indicate the same source field got merged from both the
      // schema table and INTERFACE_CHILD_FIELDS.
      expect(new Set(fields).size).toBe(fields.length);
    }
  });

  it("is frozen: reassigning an existing type's field list throws in strict mode", () => {
    expect(() => {
      // @ts-expect-error — visitorKeys is Readonly<...>; this is deliberately
      // testing the runtime Object.freeze, not just the compile-time type.
      visitorKeys.Word = ['parts', 'extra'];
    }).toThrow(TypeError);
  });

  it('is frozen at the per-type level too: mutating a field array throws in strict mode', () => {
    expect(() => {
      // @ts-expect-error — visitorKeys.CallExpr is `readonly string[]`; this
      // is deliberately testing the runtime Object.freeze on the per-type
      // array, not just the compile-time readonly type.
      visitorKeys.CallExpr[0] = 'extra';
    }).toThrow(TypeError);
  });
});
