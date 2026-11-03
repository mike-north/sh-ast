/** Parse-time observations are source-bound snapshots, not a cache for editable node methods. */
import { describe, expect, it } from 'vitest';
import {
  nodeEnd,
  nodePos,
  parseSync,
  parseWithPositionsSync,
  LangMirBSDKorn,
  LangBash,
  LangPOSIX,
  LangBats,
  LangZsh,
} from '../src/index.js';
import { isSyntaxNode } from '../src/syntax-wire.js';

/** Independent field traversal includes auxiliary children without treating them as Nodes. */
function records(value: unknown): object[] {
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return [];
  if (Array.isArray(value)) return value.flatMap(records);
  const children = Object.values(value).flatMap(records);
  return 'Type' in value ? [value, ...children] : children;
}

describe('source-bound parse positions', () => {
  it('observes original bounds without freezing or silently updating editable syntax', () => {
    const parsed = parseWithPositionsSync('# hi', { KeepComments: true });
    const comment = parsed.File.Last?.[0];
    if (!comment) throw new Error('Expected comment');
    const captured = parsed.Positions.get(comment);
    expect(captured).toEqual({ Pos: nodePos(comment), End: nodeEnd(comment) });
    expect(captured?.End.Offset).toBe(4);
    comment.Text = ' hi🎉';
    expect(nodeEnd(comment).Offset).toBe(8);
    expect(parsed.Positions.get(comment)).toBe(captured);
    expect(captured?.End.Offset).toBe(4);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured?.End)).toBe(true);
    expect(Object.isFrozen(comment)).toBe(false);
    expect(parsed.Positions.get({ ...comment })).toBeUndefined();
  });

  it('covers real nodes through auxiliary records and retains exact parser fields', () => {
    const source = '# before\nfor x in 你好; do echo "${x:-🎉}"; done\r\n';
    const parsed = parseWithPositionsSync(source, { KeepComments: true });
    expect(parsed.File).toEqual(parseSync(source, { KeepComments: true }));
    const values = records(parsed.File);
    // Auxiliary records deliberately have no independent source bounds.
    for (const value of values) {
      if (!('Type' in value)) continue;
      if (isSyntaxNode(value)) {
        expect(parsed.Positions.get(value)).toEqual({ Pos: nodePos(value), End: nodeEnd(value) });
      }
      if (value.Type === 'Slice' || value.Type === 'Replace' || value.Type === 'Expansion') {
        expect(
          Reflect.apply(parsed.Positions.get.bind(parsed.Positions), undefined, [value]),
        ).toBeUndefined();
      }
    }
    const root = parsed.Positions.get(parsed.File);
    expect(root).toEqual({ Pos: nodePos(parsed.File), End: nodeEnd(parsed.File) });
  });

  it.each(['', '   \r\n', '# only\n', '(foo |'])(
    'captures empty and recovered source %j',
    (source) => {
      const parsed = parseWithPositionsSync(source, { KeepComments: true, RecoverErrors: 2 });
      expect(parsed.Positions.get(parsed.File)).toEqual({
        Pos: nodePos(parsed.File),
        End: nodeEnd(parsed.File),
      });
    },
  );
});

/** Both parsing entry points preserve all structured error fields and partial syntax. */
it.each(['echo ok; (', '[[ a =~ b ]]'])(
  'preserves upstream failure information for %j',
  (source) => {
    const capture = (operation: () => unknown): Record<string, unknown> => {
      try {
        operation();
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        return Object.fromEntries(Object.entries(error));
      }
      throw new Error('Expected parse failure');
    };
    const options = { Variant: LangMirBSDKorn, Filename: '🎉.sh' };
    expect(capture(() => parseWithPositionsSync(source, options))).toEqual(
      capture(() => parseSync(source, options)),
    );
  },
);

/** Real bridge calls independently observe every node, including Unicode byte spans and recovery. */
it.each([LangBash, LangPOSIX, LangMirBSDKorn, LangBats, LangZsh] as const)(
  'matches live upstream bounds for every occurrence in dialect %s',
  (Variant) => {
    for (const source of [
      '# 🎉 中 e\u0301\r\necho hi\r\n',
      "cat <<'EOF'\n中 🎉 e\u0301\nEOF\n",
      '',
      '# only\n',
      '(foo |',
    ]) {
      const options = { Variant, KeepComments: true, RecoverErrors: 2 };
      const parsed = parseWithPositionsSync(source, options);
      expect(parsed.File).toEqual(parseSync(source, options));
      let count = 0;
      for (const value of records(parsed.File)) {
        if (!isSyntaxNode(value)) continue;
        count++;
        expect(parsed.Positions.get(value)).toEqual({ Pos: nodePos(value), End: nodeEnd(value) });
      }
      expect(count).toBeGreaterThan(0);
    }
  },
);
