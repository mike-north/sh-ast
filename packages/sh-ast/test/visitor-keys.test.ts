/**
 * Hand-derived child mappings from mvdan/sh v3.13.1 syntax/nodes.go, independent
 * of the generator. Schema metadata describes structure, not Walk semantics.
 */
import { describe, expect, it } from 'vitest';
import { SYNTAX_INTERFACES, SYNTAX_SCHEMA } from '../src/index.js';

/** Selects child-bearing fields; expected names below come from upstream structs. */
function childFields(type: string): string[] {
  return Object.entries(SYNTAX_SCHEMA[type].fields)
    .filter(([, field]) => field.kind === 'struct' || field.kind === 'interface')
    .map(([name]) => name)
    .sort();
}

describe('syntax schema child mappings', () => {
  it.each([
    ['File', ['Stmts', 'Last']],
    ['Stmt', ['Comments', 'Cmd', 'Redirs']],
    ['CallExpr', ['Assigns', 'Args']],
    ['IfClause', ['Cond', 'CondLast', 'Then', 'ThenLast', 'Else', 'Last']],
    ['Word', ['Parts']],
    ['SglQuoted', []],
    ['Assign', ['Name', 'Value', 'Array', 'Index']],
    ['DeclClause', ['Variant', 'Args']],
  ] as const)('%s preserves its upstream child fields', (type, fields) => {
    expect(childFields(type)).toEqual([...fields].sort());
  });
  it('distinguishes concrete children, interfaces and nil slice elements', () => {
    expect(SYNTAX_SCHEMA.Stmt.fields.Cmd).toMatchObject({
      kind: 'interface',
      type: 'Command',
      nullable: true,
    });
    expect(SYNTAX_SCHEMA.File.fields.Stmts).toMatchObject({
      kind: 'struct',
      type: 'Stmt',
      slice: true,
      nullable: true,
      elementNullable: true,
    });
    expect(SYNTAX_SCHEMA.File.fields.Last).toMatchObject({
      kind: 'struct',
      type: 'Comment',
      slice: true,
      nullable: true,
      elementNullable: false,
    });
  });
  it('excludes auxiliary structs from Node while retaining their structural fields', () => {
    for (const type of ['Expansion', 'Replace', 'Slice'])
      expect(SYNTAX_INTERFACES.Node).not.toContain(type);
    expect(childFields('Expansion')).toEqual(['Word']);
    expect(childFields('Replace')).toEqual(['Orig', 'With']);
    expect(childFields('Slice')).toEqual(['Length', 'Offset']);
  });
  it('deeply freezes shared metadata and interface alternatives', () => {
    expect(Reflect.set(SYNTAX_SCHEMA, 'Word', {})).toBe(false);
    expect(Reflect.set(SYNTAX_SCHEMA.Word.fields, 'Extra', {})).toBe(false);
    expect(Reflect.set(SYNTAX_SCHEMA.Word.fields.Parts, 'nullable', false)).toBe(false);
    expect(Reflect.set(SYNTAX_INTERFACES.Node, '0', 'NotANode')).toBe(false);
  });
});
