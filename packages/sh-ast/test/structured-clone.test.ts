/** Independent editable syntax uses the platform clone algorithm; expectations describe consumer outcomes. */
import { describe, expect, it } from 'vitest';
import type { CallExpr, File, Node, Stmt, Word } from '../generated/syntax-types.js';
import { enumerateCommands, resolveWord } from '../src/analyze/index.js';
import {
  nodeEnd,
  nodePos,
  parseSync,
  parseWithPositionsSync,
  printSync,
  PrintError,
  PrintPanicError,
  walk,
} from '../src/index.js';
import { isSyntaxNode } from '../src/syntax-wire.js';

/** Fixture selectors fail loudly rather than silently accepting a different parsed shape. */
function callOf(stmt: Stmt | null | undefined): CallExpr {
  if (stmt?.Cmd?.Type !== 'CallExpr') throw new Error('Expected command statement');
  return stmt.Cmd;
}

/** The fixture operand is an existing Word whose quoted value can be edited independently. */
function operand(call: CallExpr): Word {
  const word = call.Args?.[1];
  if (!word) throw new Error('Expected operand');
  return word;
}

/** Stored identities include comments and auxiliary descendants, without Walk's value-copy callbacks. */
function storedNodes(value: unknown): Node[] {
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return [];
  if (Array.isArray(value)) return value.flatMap(storedNodes);
  const children = Object.values(value).flatMap(storedNodes);
  return isSyntaxNode(value) ? [value, ...children] : children;
}

/** Record entry order separately from exit events so the fixture's expected syntax is explicit. */
function entryTypes(root: Node): string[] {
  const types: string[] = [];
  walk(root, (node) => {
    if (node) types.push(node.Type);
    return true;
  });
  return types;
}

/** Select the nested body statement instead of reparsing or finding it by source offsets. */
function nestedStatement(file: File): Stmt {
  const clause = file.Stmts?.[0]?.Cmd;
  if (clause?.Type !== 'IfClause' || !clause.Then?.[0]) throw new Error('Expected if body');
  return clause.Then[0];
}

describe('structuredClone syntax contract', () => {
  const roots: readonly {
    name: string;
    source: string;
    select: (file: File) => Node;
    expected: string;
  }[] = [
    {
      name: 'File',
      source: "echo 'old 🎉'\n",
      select: (file) => file,
      expected: "echo 'new 你好 e\u0301'\n",
    },
    {
      name: 'nested Stmt',
      source: "if true; then\n echo 'old 🎉'\nfi\n",
      select: nestedStatement,
      expected: "echo 'new 你好 e\u0301'",
    },
    {
      name: 'Word',
      source: "echo 'old 🎉'\n",
      select: (file) => operand(callOf(file.Stmts?.[0])),
      expected: "'new 你好 e\u0301'",
    },
    {
      name: 'CallExpr',
      source: "echo 'old 🎉'\n",
      select: (file) => callOf(file.Stmts?.[0]),
      expected: "echo 'new 你好 e\u0301'",
    },
  ];

  it.each(roots)(
    'edits a copied $name with hand-derived printed output and leaves original intact',
    ({ source, select, expected }) => {
      const original = select(parseSync(source));
      const before = structuredClone(original);
      const beforePrint = printSync(original);
      const beforeBounds = { Pos: nodePos(original), End: nodeEnd(original) };
      const copy = structuredClone(original);
      let edits = 0;
      walk(copy, (node) => {
        if (node?.Type === 'SglQuoted' && node.Value === 'old 🎉') {
          node.Value = 'new 你好 e\u0301';
          edits++;
        }
        return true;
      });
      expect(edits).toBe(1);
      expect(printSync(copy)).toBe(expected);
      expect(original).toEqual(before);
      expect(printSync(original)).toEqual(beforePrint);
      expect({ Pos: nodePos(original), End: nodeEnd(original) }).toEqual(beforeBounds);
    },
  );

  it('copies original position values while every copied stored Node is foreign to the original snapshot', () => {
    const parsed = parseWithPositionsSync(
      "# 🎉\nif true; then\n echo '你好 e\u0301'\nfi\n# last\n",
      { KeepComments: true },
    );
    const copy = structuredClone(parsed.File);
    const originals = storedNodes(parsed.File);
    const copies = storedNodes(copy);
    expect(copies).toHaveLength(15);
    expect(copies).toHaveLength(originals.length);
    copies.forEach((node, index) => {
      const original = originals[index];
      expect(node).not.toBe(original);
      expect(node).toEqual(original);
      expect(parsed.Positions.get(node)).toBeUndefined();
      expect({ Pos: nodePos(node), End: nodeEnd(node) }).toEqual(parsed.Positions.get(original));
    });
    const copiedPosition = copy.Stmts?.[0]?.Position;
    const originalPosition = parsed.File.Stmts?.[0]?.Position;
    expect(copiedPosition).toEqual(originalPosition);
    expect(copiedPosition).not.toBe(originalPosition);
    if (!copiedPosition || !originalPosition) throw new Error('Expected statement positions');
    copiedPosition.Offset = 999;
    expect(originalPosition.Offset).toBe(7);
  });

  it('walks the copied subtree in the hand-derived original syntax order', () => {
    const original = parseSync("if true; then echo '🎉 你好 e\u0301'; fi\n");
    const expected = [
      'File',
      'Stmt',
      'IfClause',
      'Stmt',
      'CallExpr',
      'Word',
      'Lit',
      'Stmt',
      'CallExpr',
      'Word',
      'Lit',
      'Word',
      'SglQuoted',
    ];
    expect(entryTypes(original)).toEqual(expected);
    expect(entryTypes(structuredClone(original))).toEqual(expected);
  });

  it('retains Uint8Array bytes and TypedNil data without changing existing printer semantics', () => {
    const original = parseSync('echo bytes ${x}\n');
    const command = callOf(original.Stmts?.[0]);
    const literal = operand(command).Parts?.[0];
    if (literal?.Type !== 'Lit') throw new Error('Expected editable literal');
    // Raw invalid UTF-8 is rejected in an unquoted parser token. A consumer can
    // still construct byte-bearing Lit data supported by the faithful printer.
    literal.Value = new Uint8Array([0xfe]);
    const parameter = command.Args?.[2]?.Parts?.[0];
    if (parameter?.Type !== 'ParamExp') throw new Error('Expected parameter expansion');
    // Param takes precedence over NestedParam in the upstream printer. This legal
    // interface tag remains data even though that operation does not print it.
    parameter.NestedParam = { Type: 'TypedNil', Kind: 'Lit' };
    const beforeBounds = { Pos: nodePos(original), End: nodeEnd(original) };
    const before = structuredClone(original);
    const copy = structuredClone(original);
    const copiedCommand = callOf(copy.Stmts?.[0]);
    const copiedParameter = copiedCommand.Args?.[2]?.Parts?.[0];
    if (copiedParameter?.Type !== 'ParamExp') throw new Error('Expected copied parameter');
    expect(copiedParameter.NestedParam).toEqual({ Type: 'TypedNil', Kind: 'Lit' });
    expect(copiedParameter.NestedParam).not.toBe(parameter.NestedParam);
    const copiedLiteral = operand(copiedCommand).Parts?.[0];
    if (copiedLiteral?.Type !== 'Lit' || !(copiedLiteral.Value instanceof Uint8Array))
      throw new Error('Expected byte literals');
    expect(copiedLiteral.Value).toEqual(new Uint8Array([0xfe]));
    expect(copiedLiteral.Value).not.toBe(literal.Value);
    const expected = new Uint8Array([
      0x65, 0x63, 0x68, 0x6f, 0x20, 0xfe, 0x20, 0x24, 0x7b, 0x78, 0x7d, 0x0a,
    ]);
    expect(printSync(copy)).toEqual(expected);
    copiedLiteral.Value[0] = 0xfd;
    expect(printSync(copy)).toEqual(
      new Uint8Array([0x65, 0x63, 0x68, 0x6f, 0x20, 0xfd, 0x20, 0x24, 0x7b, 0x78, 0x7d, 0x0a]),
    );
    expect(printSync(original)).toEqual(expected);
    expect(literal.Value).toEqual(new Uint8Array([0xfe]));
    expect(original).toEqual(before);
    expect({ Pos: nodePos(original), End: nodeEnd(original) }).toEqual(beforeBounds);
    expect(() => printSync(structuredClone({ Type: 'TypedNil', Kind: 'Word' } as const))).toThrow(
      PrintPanicError,
    );
    const comment = parseSync('# comment\n', { KeepComments: true }).Last?.[0];
    if (!comment) throw new Error('Expected comment');
    expect(() => printSync(structuredClone(comment))).toThrow(PrintError);
  });

  it('preserves aliases inside the reachable copy while external holders keep original objects', () => {
    const original = callOf(parseSync('echo old\n').Stmts?.[0]);
    const externalWord = operand(original);
    original.Args?.push(externalWord);
    const copy = structuredClone(original);
    expect(copy.Args?.[1]).toBe(copy.Args?.[2]);
    expect(copy.Args?.[1]).not.toBe(externalWord);
    const copiedLiteral = operand(copy).Parts?.[0];
    if (copiedLiteral?.Type !== 'Lit') throw new Error('Expected literal');
    copiedLiteral.Value = '你好';
    expect(printSync(copy)).toBe('echo 你好 你好');
    expect(printSync(original)).toBe('echo old old');
    expect(externalWord).toBe(original.Args?.[1]);
    expect(printSync(externalWord)).toBe('old');
  });

  it('supports analyze inputs without sharing their retained command identities', () => {
    const original = parseSync("echo '🎉 你好 e\u0301'\n");
    const copy = structuredClone(original);
    const sites = enumerateCommands(copy);
    expect(sites).toHaveLength(1);
    expect(sites[0].node).toBe(copy.Stmts?.[0]?.Cmd);
    expect(sites[0].node).not.toBe(original.Stmts?.[0]?.Cmd);
    expect(sites[0].argv).toEqual([
      { static: true, text: 'echo' },
      { static: true, text: '🎉 你好 e\u0301' },
    ]);
    expect(resolveWord(operand(sites[0].node))).toEqual({ static: true, text: '🎉 你好 e\u0301' });
  });
});
