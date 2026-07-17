/**
 * Multibyte fidelity test — criterion 2 of
 * https://github.com/mike-north/eslint-sh/issues/4.
 *
 * Ranges/locs are UTF-16 per design/ARCHITECTURE.md's "Normalized node
 * shape", even though mvdan/sh itself reports byte offsets and
 * byte-counting columns. Multibyte fixtures (emoji, CJK, combining marks)
 * are a mandatory, permanent part of this suite per
 * ENG_TEAM_INSTRUCTIONS.md and design/MILESTONES.md — a range bug here
 * silently corrupts autofix output.
 *
 * @see design/ARCHITECTURE.md — "Byte→UTF-16 conversion" and its invariants
 */
import { describe, expect, it } from 'vitest';
import { parseSync, walk } from '../src/index.js';
import type { ShNode } from '../src/index.js';

const sh = String.raw;

/**
 * The UTF-16 index of the start of each 1-based source line, mirroring
 * `normalize.ts`'s own `computeLineStarts` — kept independent (not
 * imported) so this test verifies against its own computation of the
 * loc<->range relationship rather than reusing the implementation under
 * test.
 */
function lineStartIndices(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** Converts a 1-based {line, column} (UTF-16 columns) to a UTF-16 index. */
function indexFromPosition(text: string, position: { line: number; column: number }): number {
  const lineStart = lineStartIndices(text)[position.line - 1] ?? 0;
  return lineStart + (position.column - 1);
}

describe('multibyte range fidelity', () => {
  const code = sh`msg="héllo 🎉 wörld"
# combining é (e + U+0301) and CJK 你好 in a comment
echo "$msg" | grep -q 你好
`;

  it('walks every node and asserts code.slice(range) reproduces the exact source text', () => {
    const file = parseSync(code);
    let visited = 0;
    let litNodesChecked = 0;
    walk(file, (node: ShNode) => {
      visited += 1;
      const [start, end] = node.range;
      expect(start).toBeLessThanOrEqual(end);
      const sliced = code.slice(start, end);
      expect(sliced.length).toBe(end - start);
      // Every node's range must fall within the source bounds.
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(code.length);

      // loc.start/end must be internally consistent with range: independently
      // recomputing a UTF-16 index from the line/column pair must land on
      // exactly the same index range[0]/range[1] reports — computed here
      // from scratch, not by re-deriving range from loc (that would just
      // prove the implementation agrees with itself).
      expect(indexFromPosition(code, node.loc.start)).toBe(start);
      expect(indexFromPosition(code, node.loc.end)).toBe(end);

      // Where the node type implies exact known content, verify the slice
      // matches it byte-for-byte, not just in length — a Lit node's `value`
      // field is its literal text verbatim (this is what makes the multibyte
      // fixture's emoji/CJK/combining-mark content a meaningful check rather
      // than a tautological length comparison).
      if (node.type === 'Lit') {
        expect(typeof node.value).toBe('string');
        expect(sliced).toBe(node.value);
        litNodesChecked += 1;
      }
    });
    // Sanity: the fixture actually produced a non-trivial tree, and the
    // Lit-content check above actually ran (not vacuously skipped).
    expect(visited).toBeGreaterThan(10);
    expect(litNodesChecked).toBeGreaterThan(0);
  });

  it('reproduces exact multibyte text for specific nodes (emoji, CJK, combining mark)', () => {
    const file = parseSync(code);
    const texts: string[] = [];
    walk(file, (node: ShNode) => {
      texts.push(code.slice(node.range[0], node.range[1]));
    });
    expect(texts.some((t) => t.includes('🎉'))).toBe(true);
    expect(texts.some((t) => t.includes('你好'))).toBe(true);
    // The unquoted Lit inside the DblQuoted word: exact multibyte round-trip,
    // including the emoji and the precomposed/decomposed 'ö'.
    expect(texts.some((t) => t === 'héllo 🎉 wörld')).toBe(true);
    // The standalone CJK word `你好` (grep's argument), an exact node text.
    expect(texts.some((t) => t === '你好')).toBe(true);
  });

  it('nests child ranges within parent ranges, except leading comments (documented exception)', () => {
    // design/ARCHITECTURE.md documents one exception to range nesting: a
    // Stmt's leading Comments precede the Stmt's own Pos/End (which cover
    // only the command), so a Comment child's range can fall entirely
    // before its parent Stmt's range. Verified directly by this fixture,
    // whose comment line precedes the statement it is attached to.
    const file = parseSync(code);
    let sawCommentException = false;
    walk(file, (node: ShNode, parent: ShNode | null) => {
      if (!parent) return;
      if (node.type === 'Comment' && node.range[0] < parent.range[0]) {
        sawCommentException = true;
        return;
      }
      expect(node.range[0]).toBeGreaterThanOrEqual(parent.range[0]);
      expect(node.range[1]).toBeLessThanOrEqual(parent.range[1]);
    });
    expect(sawCommentException).toBe(true);
  });

  it('applies a text-range fix after multibyte content and lands at the correct characters', () => {
    // Simulates what an ESLint autofixer does: replace a node's range with
    // new text using string slicing, exactly as `fixer.replaceTextRange`
    // does. If ranges were byte-based instead of UTF-16, this would corrupt
    // (or throw on) the emoji/CJK content.
    const file = parseSync(code);
    const nodes: ShNode[] = [];
    walk(file, (node: ShNode) => {
      nodes.push(node);
    });
    const echoLit = nodes.find((node) => node.type === 'Lit' && node.value === 'echo');
    expect(echoLit).toBeDefined();
    if (!echoLit) {
      throw new Error('unreachable: asserted defined above');
    }
    const [start, end] = echoLit.range;
    const fixed = code.slice(0, start) + 'printf' + code.slice(end);
    expect(fixed).toContain('printf "$msg" | grep -q 你好');
    expect(fixed).toContain('héllo 🎉 wörld');
  });
});
