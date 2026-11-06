/**
 * Brace classification is grounded in Bash §3.5.1 and §3.1.2, independently of
 * this analyzer. The parser must remain a faithful source record and analysis
 * must never rewrite it while asking upstream to recognize expansion syntax.
 */
import { describe, expect, it, vi } from 'vitest';
import { enumerateCommands, resolveArgv0, resolveWord } from '../src/analyze/index.js';
import { parseSync, parseWithPositionsSync, printSync } from '../src/index.js';
import { LangBash, LangPOSIX } from '../generated/syntax-constants.js';
import * as wasm from '../src/wasm-instance.js';
import type { BraceExp, Word } from '../generated/syntax-types.js';

/** Keep test inputs in ordinary argument grammar, including brace-looking tokens. */
function argument(source: string, variant: number = LangBash): Word {
  const file = parseSync(`echo ${source}`, { Variant: variant });
  const command = file.Stmts?.[0]?.Cmd;
  if (command?.Type !== 'CallExpr' || !command.Args?.[1]) throw new Error('missing test word');
  return command.Args[1];
}

/** A complete caller-constructed expansion with hand-defined literal alternatives. */
function knownBrace(): BraceExp {
  return { Type: 'BraceExp', Sequence: false, Elems: [argument('a'), argument('b')] };
}

describe('upstream-backed brace classification', () => {
  it.each([
    '{a,b}',
    'x{a,b}y',
    '{1..3}',
    '{a..c}',
    '{rm,-rf,/x}',
    '{🎉,中}',
    '{é,中}',
    '{a,{b,c}}',
    '{a,b}{c,d}',
    '{a,b{c,d}',
    '{a,"b"}',
    "{a,'b'}",
    '{a,$x}',
  ])('reports potential brace expansion for %s', (source) => {
    expect(resolveWord(argument(source))).toEqual({ static: false, reason: 'brace' });
  });

  it.each([
    ["'{a,b}'", '{a,b}'],
    ['"{a,b}"', '{a,b}'],
    [String.raw`\{a,b\}`, '{a,b}'],
    ['{a}', '{a}'],
    ['{}', '{}'],
    ['a{b', 'a{b'],
    ['{a,b', '{a,b'],
    ['{1..z}', '{1..z}'],
    ['{🎉..中}', '{🎉..中}'],
    ['🎉中é', '🎉中é'],
    ['"{"a,b"}"', '{a,b}'],
    [String.raw`\\\{a,b}`, String.raw`\{a,b}`],
  ])('keeps quoted, escaped, malformed or non-expanding %s static', (source, text) => {
    expect(resolveWord(argument(source))).toEqual({ static: true, text });
  });

  it.each([
    String.raw`a{b\,c}`,
    String.raw`{a,b\}`,
    String.raw`{a\,b,c}`,
    String.raw`\\{a,b}`,
    String.raw`\{a,b}{c}`,
  ])('declines escape-uncertain brace candidate %s', (source) => {
    expect(resolveWord(argument(source))).toEqual({ static: false, reason: 'unsupported' });
  });

  it('does not enter WASM for ordinary or provably protected openings', () => {
    const words = ['ordinary', "'{a,b}'", String.raw`\{a,b\}`].map((source) => argument(source));
    const call = vi.spyOn(wasm, 'callSyntax');
    try {
      for (const word of words) expect(resolveWord(word).static).toBe(true);
      expect(call).not.toHaveBeenCalled();
    } finally {
      call.mockRestore();
    }
  });

  it('retains brace recognition across adjacent caller-constructed literal parts', () => {
    const word = argument('{a,b}');
    const lit = word.Parts?.[0];
    if (lit?.Type !== 'Lit') throw new Error('missing literal');
    word.Parts = [
      { ...lit, Value: '{a,' },
      { ...lit, Value: 'b}' },
    ];
    expect(resolveWord(word)).toEqual({ static: false, reason: 'brace' });
  });

  it('declines escape uncertainty when backslash parity crosses adjacent Lit parts', () => {
    const word = argument('{a,b}');
    const lit = word.Parts?.[0];
    if (lit?.Type !== 'Lit') throw new Error('missing literal');
    word.Parts = [
      { ...lit, Value: '\\' },
      { ...lit, Value: '\\{a,b}' },
    ];
    // Selected Go doubles a trailing backslash in each constructed Lit;
    // these records are not preserved by a binding-specific printer hold.
    expect(printSync(word)).toBe(String.raw`\\\{a,b}`);
    expect(resolveWord(word)).toEqual({ static: false, reason: 'unsupported' });
  });

  it.each([
    ['\\', '{a,b}'],
    ['\\', '\\', '{a,b}'],
    ['\\', '\\', '\\', '{a,b}'],
    ['{a', '\\', ',b}'],
    ['{a,b', '\\', '}'],
    ['{a,', '\\', '{b,c}}'],
  ])('declines a brace word with an escape crossing literal boundaries: %j', (...values) => {
    const word = argument('{a,b}');
    const lit = word.Parts?.[0];
    if (lit?.Type !== 'Lit') throw new Error('missing literal');
    word.Parts = values.map((Value) => ({ ...lit, Value }));
    expect(resolveWord(word)).toEqual({ static: false, reason: 'unsupported' });
  });

  it.each([
    ['{', 'a', ',', 'b', '}'],
    ['{a,', '{b', ',c}', '}'],
  ])('recognizes braces across split delimiters: %j', (...values) => {
    const word = argument('{a,b}');
    const lit = word.Parts?.[0];
    if (lit?.Type !== 'Lit') throw new Error('missing literal');
    word.Parts = values.map((Value) => ({ ...lit, Value }));
    expect(resolveWord(word)).toEqual({ static: false, reason: 'brace' });
  });

  it('keeps quoted part boundaries while recognizing surrounding split literals', () => {
    const word = argument('{a,"b"}');
    const first = word.Parts?.[0];
    if (first?.Type !== 'Lit' || !word.Parts) throw new Error('missing literal');
    word.Parts = [{ ...first, Value: '{' }, { ...first, Value: 'a,' }, ...word.Parts.slice(1)];
    expect(resolveWord(word)).toEqual({ static: false, reason: 'brace' });
    expect(printSync(word)).toBe('{a,"b"}');
  });

  it('declines an unquoted escape crossing into a quoted brace part', () => {
    const word = argument('ordinary');
    const lit = word.Parts?.[0];
    const braceQuote = argument('"{a,b}"').Parts?.[0];
    const suffixQuote = argument('"x"').Parts?.[0];
    if (lit?.Type !== 'Lit' || !braceQuote || !suffixQuote) throw new Error('missing test parts');
    word.Parts = [{ ...lit, Value: '\\' }, braceQuote, { ...lit, Value: '\\' }, suffixQuote];
    expect(printSync(word)).toBe(String.raw`\\"{a,b}"\\"x"`);
    expect(resolveWord(word)).toEqual({ static: false, reason: 'unsupported' });
  });

  it.each(['"{a,b}"', "'{a,b}'", '"ordinary"', "'ordinary'", '""', '$x', 'ordinary'])(
    'declines an escape crossing into %s',
    (source) => {
      const word = argument('ordinary');
      const lit = word.Parts?.[0];
      const following = argument(source).Parts;
      if (lit?.Type !== 'Lit' || !following) throw new Error('missing test parts');
      word.Parts = [{ ...lit, Value: '\\' }, ...following];
      expect(resolveWord(word)).toEqual({ static: false, reason: 'unsupported' });
    },
  );

  it.each([
    [String.raw`a\ b`, 'a b'],
    [String.raw`a\"b`, 'a"b'],
    [String.raw`\\"ordinary"`, String.raw`\ordinary`],
  ])('keeps ordinary parsed escapes local to their literal record: %s', (source, text) => {
    expect(resolveWord(argument(source))).toEqual({ static: true, text });
  });

  it.each(['before', 'after'])(
    'keeps crossed-part uncertainty when a known BraceExp is %s the escape',
    (order) => {
      const word = argument('ordinary');
      const lit = word.Parts?.[0];
      if (lit?.Type !== 'Lit') throw new Error('missing literal');
      const brace = knownBrace();
      word.Parts =
        order === 'before'
          ? [brace, { ...lit, Value: '\\' }, { ...lit, Value: 'x' }]
          : [{ ...lit, Value: '\\' }, brace];
      const before = structuredClone(word);
      expect(resolveWord(word)).toEqual({ static: false, reason: 'unsupported' });
      expect(word).toEqual(before);
    },
  );

  it.each(['"{a,b}"', String.raw`\{a,b\}`, String.raw`a\ b`])(
    'retains a known BraceExp with independently protected sibling %s',
    (source) => {
      const sibling = argument(source).Parts;
      if (!sibling) throw new Error('missing sibling parts');
      for (const Parts of [
        [knownBrace(), ...sibling],
        [...sibling, knownBrace()],
      ]) {
        const word: Word = { Type: 'Word', Parts };
        const before = structuredClone(word);
        expect(resolveWord(word)).toEqual({ static: false, reason: 'brace' });
        expect(word).toEqual(before);
      }
    },
  );

  it.each(['before', 'after'])(
    'keeps whole-word uncertainty for an escaped-comma candidate %s a known BraceExp',
    (order) => {
      const word = argument(String.raw`{a\,b}`);
      const sibling = word.Parts;
      if (!sibling) throw new Error('missing sibling parts');
      word.Parts = order === 'before' ? [...sibling, knownBrace()] : [knownBrace(), ...sibling];
      expect(resolveWord(word)).toEqual({ static: false, reason: 'unsupported' });
    },
  );

  it.each([
    ['~', 'tilde'],
    ['*', 'glob'],
  ])('preserves ordinary %s precedence ahead of a known BraceExp', (source, reason) => {
    const word = argument(source);
    word.Parts = [...(word.Parts ?? []), knownBrace()];
    expect(resolveWord(word)).toEqual({ static: false, reason });
  });

  it('preserves caller records, aliases, source positions and printed output', () => {
    const parsed = parseWithPositionsSync('echo x{🎉,"中"}y');
    const command = parsed.File.Stmts?.[0]?.Cmd;
    if (command?.Type !== 'CallExpr' || !command.Args?.[1]) throw new Error('missing word');
    const word = command.Args[1];
    const before = structuredClone(parsed.File);
    const parts = word.Parts;
    const position = parsed.Positions.get(word);
    const printed = printSync(parsed.File);
    expect(resolveWord(word)).toEqual({ static: false, reason: 'brace' });
    expect(parsed.File).toEqual(before);
    expect(word.Parts).toBe(parts);
    expect(parsed.Positions.get(word)).toBe(position);
    expect(printSync(parsed.File)).toEqual(printed);
    expect(word.Parts?.some((part) => part?.Type === 'BraceExp')).toBe(false);
  });

  it('observes current edits instead of caching brace results on word identity', () => {
    const word = argument('{a,b}');
    const lit = word.Parts?.[0];
    if (lit?.Type !== 'Lit') throw new Error('missing literal');
    expect(resolveWord(word)).toEqual({ static: false, reason: 'brace' });
    lit.Value = 'ordinary';
    expect(resolveWord(word)).toEqual({ static: true, text: 'ordinary' });
    lit.Value = '{中,🎉}';
    expect(resolveWord(word)).toEqual({ static: false, reason: 'brace' });
  });

  it('conservatively reports potential braces without inferring the parser dialect', () => {
    expect(resolveWord(argument('{a,b}', LangPOSIX))).toEqual({ static: false, reason: 'brace' });
  });

  it.each(['{rm,-rf,/x}', 'sudo {rm,-rf,/x}'])(
    'command analyses inherit brace facts: %s',
    (source) => {
      const site = enumerateCommands(parseSync(source))[0];
      expect(site.argv.at(-1)).toEqual({ static: false, reason: 'brace' });
      expect(resolveArgv0(site).effective).toEqual({ static: false, reason: 'brace' });
    },
  );
});
