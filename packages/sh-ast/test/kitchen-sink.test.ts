/**
 * Cross-dialect fixtures exercise every parser-reachable upstream Node. The
 * required set is independently transcribed from v3.13.1 syntax/nodes.go;
 * schema metadata is checked against it, never used as the coverage oracle.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LangBash, LangBats, LangZsh, SYNTAX_INTERFACES, parseSync } from '../src/index.js';
import { nodes, sourceText } from './regression-helpers.js';

/** Every concrete Node in upstream v3.13.1; Pos and auxiliary structs are excluded. */
const NODE_TYPES = [
  'File',
  'Comment',
  'Stmt',
  'Assign',
  'Redirect',
  'CallExpr',
  'Subshell',
  'Block',
  'IfClause',
  'WhileClause',
  'ForClause',
  'WordIter',
  'CStyleLoop',
  'BinaryCmd',
  'FuncDecl',
  'Word',
  'Lit',
  'SglQuoted',
  'DblQuoted',
  'CmdSubst',
  'ParamExp',
  'ArithmExp',
  'ArithmCmd',
  'BinaryArithm',
  'UnaryArithm',
  'ParenArithm',
  'FlagsArithm',
  'CaseClause',
  'CaseItem',
  'TestClause',
  'BinaryTest',
  'UnaryTest',
  'ParenTest',
  'DeclClause',
  'ArrayExpr',
  'ArrayElem',
  'ExtGlob',
  'ProcSubst',
  'TimeClause',
  'CoprocClause',
  'LetClause',
  'BraceExp',
  'TestDecl',
];
/** BraceExp arises only from the separately invoked SplitBraces operation. */
const PARSER_TYPES = NODE_TYPES.filter((type) => type !== 'BraceExp');
/** Each dialect adds parser forms unavailable in the other fixtures. */
const fixtures = [
  { label: 'bash', Variant: LangBash, file: 'kitchen-sink.bash.sh' },
  { label: 'zsh', Variant: LangZsh, file: 'kitchen-sink.zsh.sh' },
  { label: 'bats', Variant: LangBats, file: 'kitchen-sink.bats.sh' },
];
/** Reads source as written; fixture text is never synthesized from schema output. */
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

describe('kitchen-sink source coverage', () => {
  it.each(fixtures)('parses the $label fixture with only known real nodes', ({ Variant, file }) => {
    const found = nodes(parseSync(fixture(file), { Variant, KeepComments: true }));
    expect(found.length).toBeGreaterThan(0);
    for (const node of found) expect(NODE_TYPES).toContain(node.Type);
  });
  it('covers every independently listed parser-reachable node across all fixtures', () => {
    const found = new Set(
      fixtures.flatMap(({ Variant, file }) =>
        nodes(parseSync(fixture(file), { Variant, KeepComments: true })).map((node) => node.Type),
      ),
    );
    expect([...found].sort()).toEqual([...PARSER_TYPES].sort());
    expect([...SYNTAX_INTERFACES.Node].sort()).toEqual([...NODE_TYPES].sort());
    expect(found.has('BraceExp')).toBe(false);
  });
  it('preserves DeclClause.Variant as a concrete Lit with its declaration keyword', () => {
    const declarations = nodes(parseSync(fixture('kitchen-sink.bash.sh'))).filter(
      (node) => node.Type === 'DeclClause',
    );
    expect(declarations.length).toBeGreaterThan(0);
    for (const declaration of declarations) expect(declaration.Variant?.Type).toBe('Lit');
    expect(declarations.map((node) => node.Variant?.Value)).toContain('declare');
  });
  it('preserves Expansion, Replace and Slice operands without pretending they are Nodes', () => {
    const source = fixture('kitchen-sink.bash.sh');
    const parameters = nodes(parseSync(source)).filter((node) => node.Type === 'ParamExp');
    const defaultValue = parameters.find(
      (node) => node.Exp?.Word && sourceText(source, node.Exp.Word) === 'nobody',
    )?.Exp;
    expect(defaultValue).toBeDefined();
    expect(defaultValue?.Type).toBe('Expansion');
    expect(defaultValue).not.toHaveProperty('range');
    const replacement = parameters.find(
      (node) => node.Repl?.Orig && sourceText(source, node.Repl.Orig) === 'foo',
    )?.Repl;
    if (!replacement?.With) throw new Error('Missing foo/bar replacement');
    expect(sourceText(source, replacement.With)).toBe('bar');
    expect(replacement).not.toHaveProperty('Pos');
    const slice = parameters.find(
      (node) => node.Slice?.Offset && sourceText(source, node.Slice.Offset) === '1',
    )?.Slice;
    if (!slice?.Length) throw new Error('Missing 1:2 slice');
    expect(sourceText(source, slice.Length)).toBe('2');
    expect(slice).not.toHaveProperty('loc');
  });
});
