/**
 * Byte-coordinate fidelity for emoji, CJK, accented and combining characters.
 * Expected byte offsets come from the original UTF-8 input, independently of
 * the bridge. Consumers can apply these spans to bytes without corrupting text.
 */
import { describe, expect, it } from 'vitest';
import { nodeEnd, nodePos, parseSync } from '../src/index.js';
import { nodes, nodeRelations, sourceText } from './regression-helpers.js';

const code =
  'msg="héllo 🎉 wörld e\u0301"\n# combining e\u0301 and CJK 你好 in a comment\necho "$msg" | grep -q 你好\n';
const bytes = new TextEncoder().encode(code);

/** Independent conversion of an upstream byte position to an absolute byte index. */
function indexAt(line: number, col: number): number {
  let current = 1;
  let start = 0;
  for (let offset = 0; offset < bytes.length && current < line; offset++) {
    if (bytes[offset] === 10) {
      current++;
      start = offset + 1;
    }
  }
  return start + col - 1;
}

describe('multibyte byte-position fidelity', () => {
  it('keeps every real node within source bytes and literal spans equal their original value', () => {
    const visited = nodes(parseSync(code, { KeepComments: true }));
    expect(visited.length).toBeGreaterThan(10);
    let literals = 0;
    for (const node of visited) {
      const start = nodePos(node);
      const end = nodeEnd(node);
      expect(start.Offset).toBeGreaterThanOrEqual(0);
      expect(end.Offset).toBeLessThanOrEqual(bytes.length);
      expect(start.Offset).toBeLessThanOrEqual(end.Offset);
      expect(indexAt(start.Line, start.Col)).toBe(start.Offset);
      expect(indexAt(end.Line, end.Col)).toBe(end.Offset);
      if (node.Type === 'Lit') {
        literals++;
        expect(sourceText(code, node)).toBe(node.Value);
      }
    }
    expect(literals).toBeGreaterThan(0);
  });
  it('reproduces exact emoji, CJK and decomposed combining text', () => {
    const texts = nodes(parseSync(code)).map((node) => sourceText(code, node));
    expect(texts).toContain('héllo 🎉 wörld e\u0301');
    expect(texts).toContain('你好');
  });
  it('nests node bounds within real parents except attached leading comments', () => {
    let leadingComments = 0;
    for (const { node, parent } of nodeRelations(parseSync(code, { KeepComments: true }))) {
      if (!parent) continue;
      const start = nodePos(node).Offset;
      const parentStart = nodePos(parent).Offset;
      if (node.Type === 'Comment' && start < parentStart) {
        leadingComments++;
        continue;
      }
      expect(start).toBeGreaterThanOrEqual(parentStart);
      expect(nodeEnd(node).Offset).toBeLessThanOrEqual(nodeEnd(parent).Offset);
    }
    expect(leadingComments).toBeGreaterThan(0);
  });

  it('retains leading comments before the attached statement position', () => {
    const file = parseSync(code, { KeepComments: true });
    const stmt = file.Stmts?.[1];
    const comment = stmt?.Comments?.[0];
    if (!stmt || !comment) throw new Error('Missing attached comment');
    expect(nodePos(comment).Offset).toBeLessThan(nodePos(stmt).Offset);
    expect(sourceText(code, comment)).toBe('# combining e\u0301 and CJK 你好 in a comment');
  });
  it('applies a byte-range edit after multibyte text at exactly the command word', () => {
    const echo = nodes(parseSync(code)).find(
      (node) => node.Type === 'Lit' && node.Value === 'echo',
    );
    if (!echo) throw new Error('Missing echo word');
    const fixed = Buffer.concat([
      bytes.slice(0, nodePos(echo).Offset),
      Buffer.from('printf'),
      bytes.slice(nodeEnd(echo).Offset),
    ]).toString('utf8');
    expect(fixed).toBe(code.replace('echo "$msg"', 'printf "$msg"'));
    expect(fixed).toContain('héllo 🎉 wörld e\u0301');
  });
});
