/**
 * Pins how carriage returns at the end of a word surface in raw byte positions.
 * mvdan/sh's lexer keeps a `\r` that precedes `\n` inside the word it is
 * lexing, so unbraced parameter expansions and literals end after the `\r`.
 * sh-ast reports those upstream spans unchanged (design/ARCHITECTURE.md: spans
 * are never invented), and these tests lock that contract so any change is a
 * deliberate, reviewed decision. Expected offsets are hand-derived from the
 * source strings, independent of the bridge.
 */
import { describe, expect, it } from 'vitest';
import { nodeEnd, nodePos, parseSync } from '../src/index.js';
import type { Node } from '../src/index.js';
import { nodes } from './regression-helpers.js';

/**
 * Returns `[start, end]` byte offsets of every node of one type, sorted by
 * start then end. Sorting makes assertions independent of the unspecified
 * enumeration order of `nodes()`.
 */
function spans(source: string, type: Node['Type']): [number, number][] {
  return nodes(parseSync(source))
    .filter((node) => node.Type === type)
    .map((node): [number, number] => [nodePos(node).Offset, nodeEnd(node).Offset])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe('CRLF at the end of a word (upstream span behavior)', () => {
  it.each([
    ['unbraced name before CRLF at end of file', 'ls $z\r\n', [[3, 6]]],
    ['unbraced digit', 'ls $1\r\n', [[3, 6]]],
    ['unbraced special', 'ls $@\r\n', [[3, 6]]],
    ['assignment value', 'x=$z\r\n', [[2, 5]]],
    ['end of file, bare CR', 'ls $z\r', [[3, 5]]],
  ] as const)('%s: ParamExp includes the CR', (_name, source, expected) => {
    expect(spans(source, 'ParamExp')).toEqual(expected);
  });

  it.each([
    ['braced', 'ls ${z}\r\n', [[3, 7]]],
    ['not word-final', 'ls $z y\r\n', [[3, 5]]],
    ['no line ending', 'ls $z', [[3, 5]]],
    ['inside double quotes', 'ls "$z"\r\n', [[4, 6]]],
  ] as const)('%s: ParamExp excludes the CR', (_name, source, expected) => {
    expect(spans(source, 'ParamExp')).toEqual(expected);
  });

  it('carries the CR into the parameter name literal', () => {
    expect(spans('ls $z\r\n', 'Lit')).toEqual([
      [0, 2],
      [4, 6],
    ]);
  });

  it('also ends a plain literal word after the CR', () => {
    expect(spans('ls foo\r\n', 'Lit')).toEqual([
      [0, 2],
      [3, 7],
    ]);
    expect(spans('echo y\r\n', 'Lit')).toEqual([
      [0, 4],
      [5, 7],
    ]);
  });

  it('leaves words ending in a quote, command or arithmetic substitution without the CR', () => {
    expect(spans("ls 'a'\r\n", 'SglQuoted')).toEqual([[3, 6]]);
    expect(spans('ls $(a)\r\n', 'CmdSubst')).toEqual([[3, 7]]);
    expect(spans('ls $((1))\r\n', 'ArithmExp')).toEqual([[3, 9]]);
  });
});
