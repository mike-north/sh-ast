/**
 * The selected Go syntax reads reverse-subscript patterns as opaque literals.
 * Faithful records retain their bytes and bounds; a Walk inventory cannot infer
 * that literal pattern text contains no executable shell substitutions.
 */
import { describe, expect, it } from 'vitest';
import {
  LangZsh,
  ParseError,
  nodeEnd,
  nodePos,
  parseSync,
  parseWithPositionsSync,
  printSync,
  walk,
} from '../src/index.js';
import type { File, Node } from '../src/index.js';

/** Observes represented syntax nodes without reparsing literal pattern data. */
function nodes(file: File): Node[] {
  const result: Node[] = [];
  walk(file, (node) => {
    if (node !== null) {
      result.push(node);
    }
    return true;
  });
  return result;
}

describe('selected Go reverse-subscript representation', () => {
  it.each(['foo*', '$(printf foo)', '$needle', "don't*", "$'foo$needle'"])(
    'retains %s as an opaque Word/Lit with source byte bounds',
    (pattern) => {
      const source = `echo é \${a[(r)${pattern}]}\n`;
      const parsed = parseWithPositionsSync(source, { Variant: LangZsh });
      const represented = nodes(parsed.File);
      const literal = represented.find((node) => node.Type === 'Lit' && node.Value === pattern);
      expect(literal?.Type).toBe('Lit');
      if (literal?.Type !== 'Lit') {
        throw new Error('Expected the selected Go raw pattern literal');
      }
      expect([nodePos(literal).Offset, nodeEnd(literal).Offset]).toEqual([
        15,
        15 + Buffer.byteLength(pattern),
      ]);
      expect(parsed.Positions.get(literal)).toMatchObject({
        Pos: { Offset: 15 },
        End: { Offset: 15 + Buffer.byteLength(pattern) },
      });
      expect(represented.filter((node) => node.Type === 'CmdSubst')).toHaveLength(0);
      expect(represented.filter((node) => node.Type === 'CallExpr')).toHaveLength(1);
      expect(
        represented.filter((node) => node.Type === 'ParamExp').map((node) => node.Param?.Value),
      ).toEqual(['a']);
      for (const options of [{}, { KeepPadding: true }]) {
        expect(printSync(parsed.File, options)).toBe(source);
      }
    },
  );

  it('retains the selected parser refusal for nested character-class text', () => {
    // This is the selected Go grammar limit, not a claim that Zsh rejects it.
    expect(() => parseSync('echo ${a[(r)foo[0-9]]}\n', { Variant: LangZsh })).toThrow(ParseError);
  });
});
