/**
 * Raw pattern bytes are not recursive syntax work in the selected Go parser.
 * The binding must not retain a compatibility parser's refusal of this text.
 */
import { describe, expect, it } from 'vitest';
import { LangZsh, parseSync, parseWithPositionsSync } from '../src/index.js';

/** Inputs distinguish opaque spelling from actual nested syntax-budget work. */
const patterns: readonly string[] = [
  `${'(r)'.repeat(200)}foo`,
  `${'$('.repeat(200)}printf foo${')'.repeat(200)}`,
];

describe.each([0, 100000])('opaque patterns with RecoverErrors=%i', (RecoverErrors) => {
  it.each(patterns)('accepts raw pattern bytes without recursive refusal', (pattern) => {
    const source = `echo \${a[(r)${pattern}]}`;
    for (const parse of [parseSync, parseWithPositionsSync]) {
      expect(() => parse(source, { Variant: LangZsh, RecoverErrors })).not.toThrow();
      expect(() => parse('echo alive', { Variant: LangZsh, RecoverErrors })).not.toThrow();
    }
  });
});
