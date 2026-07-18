/**
 * Unit coverage for the byte->UTF-16 mapping invariant stated in
 * design/ARCHITECTURE.md: "every byte offset the parser emits falls on a
 * UTF-8 code-point boundary (the map throws otherwise)". Not one of the
 * numbered acceptance criteria in issue #4, but a documented invariant this
 * module must uphold — a bad offset should fail loudly, not silently
 * produce a corrupted position.
 */
import { describe, expect, it } from 'vitest';
import { makeByteToUtf16, normalize } from '../src/normalize.js';
import type { JsonValue } from '../src/normalize.js';
import type { ShNode } from '../src/types.js';

describe('makeByteToUtf16', () => {
  it('maps ASCII byte offsets 1:1 to UTF-16 indices', () => {
    const toUtf16 = makeByteToUtf16('echo hi');
    expect(toUtf16(0)).toBe(0);
    expect(toUtf16(4)).toBe(4);
    expect(toUtf16(7)).toBe(7);
  });

  it('maps multibyte byte offsets to their UTF-16 index, not a 1:1 byte count', () => {
    // "é" is 2 bytes (U+00E9) but 1 UTF-16 code unit.
    const toUtf16 = makeByteToUtf16('é!');
    expect(toUtf16(0)).toBe(0);
    expect(toUtf16(2)).toBe(1); // after the 2-byte é, at UTF-16 index 1
    expect(toUtf16(3)).toBe(2); // after "!'
  });

  it('maps a 4-byte astral code point (emoji) to a 2-UTF-16-unit surrogate pair boundary', () => {
    // "🎉" (U+1F389) is 4 bytes in UTF-8 and 2 UTF-16 code units (surrogate pair).
    const toUtf16 = makeByteToUtf16('🎉x');
    expect(toUtf16(0)).toBe(0);
    expect(toUtf16(4)).toBe(2);
    expect(toUtf16(5)).toBe(3);
  });

  it('throws for a byte offset that does not fall on a UTF-8 code point boundary', () => {
    // "é" occupies byte offsets [0,2); offset 1 is mid-code-point.
    const toUtf16 = makeByteToUtf16('é!');
    expect(() => toUtf16(1)).toThrow(/not a UTF-8 code point boundary/);
  });
});

describe('normalize — guard branches', () => {
  // A minimal well-formed Pos/End pair, reused across fixtures below.
  const pos = { Offset: 0, Line: 1, Col: 1 };

  it('throws when the root value is not a node (missing Pos/End)', () => {
    expect(() => normalize({}, '')).toThrow(/root value is not a node \(missing Pos\/End\)/);
  });

  it('throws when a nested field has no resolvable type (no "Type" and no static schema fallback)', () => {
    // `Assign.Index` is a documented `null`-schema field in the generated
    // child-type schema — it holds a child only when the source uses
    // array-index assignment (`a[0]=x`), and typedjson always tags it with
    // its own "Type" in that case. A rawNode-shaped `Index` value with no
    // "Type" of its own has no way to resolve a type: not from itself (no
    // "Type" field) and not from the schema (explicitly `null`).
    const root: JsonValue = {
      Pos: pos,
      End: pos,
      Stmts: [{ Type: 'Assign', Pos: pos, End: pos, Index: { Pos: pos, End: pos } }],
    };
    expect(() => normalize(root, 'x=1')).toThrow(/node without resolvable type/);
  });
});

describe('normalize — synthesized range/loc for non-Node auxiliary structs (issue #13)', () => {
  // `echo ${a:-}` — an empty-default parameter expansion. mvdan/sh's
  // `ParamExp.Exp` (`*Expansion`) never carries `Pos`/`End` (`Expansion`
  // doesn't implement `syntax.Node`), and its `Word` field is `nil` — thus
  // entirely absent from typedjson's output (`omitempty`) — whenever the
  // default is empty, exactly as it is here.
  //
  // Byte offsets below are hand-derived from this literal ASCII string (byte
  // offset == UTF-16 index == 0-based char index, so they're easy to check
  // by eye): "echo ${a:-}" -> e0 c1 h2 o3 _4 $5 {6 a7 :8 -9 }10 (length 11).
  const text = 'echo ${a:-}';
  const posAt = (offset: number): JsonValue => ({ Offset: offset, Line: 1, Col: offset + 1 });

  /**
   * Navigates `File -> stmts[0] -> cmd (CallExpr) -> args[0] (Word) ->
   * parts[0] (ParamExp) -> exp (Expansion)` from a normalized root. Every
   * step below the root falls through `ShNode`'s index signature
   * (`[field: string]: unknown`) rather than a declared property — only
   * `ShFile.stmts` is declared as `readonly ShNode[]`, and `normalize()`
   * itself returns the more generic `ShNode` — so each hop needs its own
   * cast, matching this codebase's existing convention (see
   * `parse.test.ts`'s `file.stmts[0]?.cmd as {...}`).
   */
  function expansionOf(file: ShNode): ShNode {
    const stmt = (file.stmts as ShNode[])[0];
    const cmd = stmt.cmd as ShNode;
    const arg = (cmd.args as ShNode[])[0];
    const paramExp = (arg.parts as ShNode[])[0];
    return paramExp.exp as ShNode;
  }

  function rootWithParamExp(source: string, paramExp: JsonValue): JsonValue {
    return {
      Pos: posAt(0),
      End: posAt(source.length),
      Stmts: [
        {
          Pos: posAt(0),
          End: posAt(source.length),
          Cmd: {
            Type: 'CallExpr',
            Pos: posAt(0),
            End: posAt(source.length),
            Args: [
              {
                Pos: posAt(5),
                End: posAt(source.length),
                Parts: [paramExp],
              },
            ],
          },
        },
      ],
    };
  }

  it("falls back to the enclosing ParamExp's own span when Expansion has no positioned children (Word is nil)", () => {
    const root = rootWithParamExp(text, {
      Type: 'ParamExp',
      Pos: posAt(5),
      End: posAt(text.length),
      Param: { Type: 'Lit', Pos: posAt(7), End: posAt(8), Value: 'a' },
      // `Exp` is a real `Expansion` value (present), but it has no `Pos`/
      // `End` of its own (not a Node) and no `Word` (nil — the default is
      // empty), matching typedjson's actual output for `${a:-}`.
      Exp: { Op: 84 },
    });

    const file = normalize(root, text);
    const exp = expansionOf(file);
    expect(exp.type).toBe('Expansion');
    // No positioned children to derive a span from — falls back to the
    // immediately enclosing real node's own span, i.e. the ParamExp's.
    expect(exp.range).toEqual([5, text.length]);
    expect(text.slice(exp.range[0], exp.range[1])).toBe('${a:-}');
  });

  it("derives Expansion's span from its Word child when present, not the enclosing ParamExp", () => {
    // "echo ${a:-x}" — same shape, but with a non-empty default "x" at byte
    // offset 10 (one byte after the previous fixture's ':').
    const withDefault = 'echo ${a:-x}';
    const root = rootWithParamExp(withDefault, {
      Type: 'ParamExp',
      Pos: posAt(5),
      End: posAt(withDefault.length),
      Param: { Type: 'Lit', Pos: posAt(7), End: posAt(8), Value: 'a' },
      Exp: {
        Op: 84,
        Word: { Parts: [{ Type: 'Lit', Pos: posAt(10), End: posAt(11), Value: 'x' }] },
      },
    });

    const file = normalize(root, withDefault);
    const exp = expansionOf(file);
    const word = exp.word as ShNode;
    expect(word.type).toBe('Word');
    // The synthesized Expansion's range matches its one real child (Word)
    // exactly, not the wider enclosing ParamExp span (5..12).
    expect(exp.range).toEqual([10, 11]);
    expect(withDefault.slice(exp.range[0], exp.range[1])).toBe('x');
  });
});

describe('normalize — regression: SglQuoted/DblQuoted "Dollar" bool flag was dropped (issue #3)', () => {
  // mvdan/sh v3.13.1's `syntax.SglQuoted` struct is `{ Left, Right Pos;
  // Dollar bool /* $'' */; Value string }` — `Dollar` marks ANSI-C quoting
  // ($'...') and is a plain bool, not a position. `normalize()`'s POS_KEYS
  // denylist previously included the bare key "Dollar" unconditionally
  // (reused elsewhere, e.g. `ParamExp.Dollar`, as a real `Pos`), which
  // discarded this bool for *every* node carrying a field named "Dollar" —
  // including SglQuoted/DblQuoted, where it's real, non-positional data.
  // Without it, `$'...'` (ANSI-C quoting) was indistinguishable from plain
  // `'...'` in the normalized tree, which `sh-ast/analyze`'s `resolveWord`
  // needs to know ANSI-C escapes require decoding. This suite exercises
  // `normalize()` directly (not through `parseSync`) so it fails pre-fix
  // regardless of how the WASM shim happens to serialize the field.
  const pos = { Offset: 0, Line: 1, Col: 1 };
  const wordAt = (part: JsonValue): JsonValue => ({
    Type: 'Word',
    Pos: pos,
    End: pos,
    Parts: [part],
  });

  it("preserves SglQuoted.Dollar: true (marks $'...' ANSI-C quoting)", () => {
    const root = wordAt({ Type: 'SglQuoted', Pos: pos, End: pos, Dollar: true, Value: '\\t' });
    const word = normalize(root, "$'\\t'");
    const sglQuoted = (word.parts as ShNode[])[0];
    expect(sglQuoted.type).toBe('SglQuoted');
    expect(sglQuoted.dollar).toBe(true);
  });

  it("omits SglQuoted.dollar when the raw node has no Dollar field (plain '...')", () => {
    // typedjson's `omitempty` never serializes `Dollar: false` at all for
    // plain single-quoted text — this fixture matches that real shape.
    const root = wordAt({ Type: 'SglQuoted', Pos: pos, End: pos, Value: 'rm' });
    const word = normalize(root, "'rm'");
    const sglQuoted = (word.parts as ShNode[])[0];
    expect(sglQuoted.type).toBe('SglQuoted');
    expect(sglQuoted.dollar).toBeUndefined();
  });

  it('preserves DblQuoted.Dollar: true (marks $"..." locale quoting)', () => {
    const root = wordAt({ Type: 'DblQuoted', Pos: pos, End: pos, Dollar: true, Parts: [] });
    const word = normalize(root, '$""');
    const dblQuoted = (word.parts as ShNode[])[0];
    expect(dblQuoted.type).toBe('DblQuoted');
    expect(dblQuoted.dollar).toBe(true);
  });

  it('still drops ParamExp.Dollar (a real Pos, not data) — no fake "dollar" leaks through', () => {
    // `ParamExp.Dollar` is `Pos` (the position of the `$` token), not a
    // bool — this must stay dropped like every other position field, via
    // the generic `!isRawPos(value)` check in `buildFields`, not because
    // "Dollar" is still denylisted by name.
    const root = wordAt({
      Type: 'ParamExp',
      Pos: pos,
      End: pos,
      Dollar: pos,
      Short: true,
      Param: { Type: 'Lit', Pos: pos, End: pos, Value: 'x' },
    });
    const word = normalize(root, '$x');
    const paramExp = (word.parts as ShNode[])[0];
    expect(paramExp.type).toBe('ParamExp');
    expect(paramExp.dollar).toBeUndefined();
    expect(Object.keys(paramExp)).not.toContain('dollar');
  });
});
