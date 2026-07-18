/**
 * Tests for `parseSync`'s pathological-input-nesting guard —
 * https://github.com/mike-north/sh-ast/issues/14.
 *
 * Empirical crash depths this guard is sized against (measured against the
 * committed `packages/sh-ast/shim/sh-ast.wasm`, this repo's `vitest`/Node
 * environment — see `src/parse-depth-guard.ts`'s `MAX_PARSE_NESTING_DEPTH`
 * doc comment for the full table and methodology): a flat, non-CI-safe
 * script of ~252 nested `$(...)` command substitutions is the *lowest*
 * observed crash depth (worse than nested subshells, pipelines, or
 * `if`/`case`/loop nesting, all of which crash only around depth
 * ~1,000–1,500) — an uncatchable, native-stack-exhausting
 * `RangeError: Maximum call stack size exceeded` thrown from inside the
 * WASM instance itself, not a normal, recoverable parse error. This suite
 * never reproduces that crash directly (it would abort the `vitest`
 * worker process); it only exercises the guard, which is designed to
 * reject any of these inputs with a typed, catchable error well before
 * that point.
 *
 * @see src/parse-depth-guard.ts — the estimator under test (via `parseSync`)
 */
import { describe, expect, it } from 'vitest';
import { parseSync, ShParseMaxDepthError } from '../src/index.js';

/** `n` nested subshells: `(((...true...)))`. */
function nestedSubshells(n: number): string {
  return '('.repeat(n) + 'true' + ')'.repeat(n);
}

/** `n` nested command substitutions: `$($($(...true...)))`. */
function nestedCommandSubstitutions(n: number): string {
  return '$('.repeat(n) + 'true' + ')'.repeat(n);
}

/** A pipeline of exactly `links` `|` operators (i.e. `links + 1` commands). */
function pipelineChain(links: number): string {
  return Array.from({ length: links + 1 }, () => 'true').join(' | ');
}

/** `n` nested `case`/`esac` blocks. */
function nestedCase(n: number): string {
  return 'case x in a) '.repeat(n) + 'true' + ' ;; esac'.repeat(n);
}

describe('parseSync — criterion 1: typed, catchable error before the WASM parser is invoked', () => {
  it('throws a ShParseMaxDepthError (not a RangeError) for pathologically deep nesting', () => {
    expect(() => parseSync(nestedSubshells(2000))).toThrow(ShParseMaxDepthError);
  });

  it('the thrown error carries the stable ESLINT_SH_PARSE_MAX_DEPTH code', () => {
    expect.assertions(2);
    try {
      parseSync(nestedSubshells(2000));
    } catch (error) {
      expect(error).toBeInstanceOf(ShParseMaxDepthError);
      expect((error as ShParseMaxDepthError).code).toBe('ESLINT_SH_PARSE_MAX_DEPTH');
    }
  });

  it('the error reports both the limit and the (over-)estimated depth that tripped it', () => {
    expect.assertions(2);
    try {
      parseSync(nestedSubshells(2000));
    } catch (error) {
      const err = error as ShParseMaxDepthError;
      expect(err.maxDepth).toBeGreaterThan(0);
      expect(err.estimatedDepth).toBeGreaterThan(err.maxDepth);
    }
  });
});

describe('parseSync — criterion 2a: regression — pathological input never wedges the shared WASM instance', () => {
  // Each of these constructs a script whose nesting is deep enough that,
  // pre-guard, it would risk the uncatchable native stack overflow this
  // issue is about. The critical assertion in each test is the *second*
  // one: a normal parseSync call right after catching the guard's error
  // must still succeed, proving the shared WASM instance was never even
  // invoked with the pathological input (see `parse.ts`: the guard runs
  // strictly before `callParse`).
  it('nested subshells past the limit: throws, and a subsequent normal parse still succeeds', () => {
    expect(() => parseSync(nestedSubshells(2000))).toThrow(ShParseMaxDepthError);
    const file = parseSync('echo hi');
    expect(file.stmts).toHaveLength(1);
  });

  it('nested command substitutions past the limit (the empirically worst vector): throws, and a subsequent normal parse still succeeds', () => {
    expect(() => parseSync(nestedCommandSubstitutions(2000))).toThrow(ShParseMaxDepthError);
    const file = parseSync('echo hi');
    expect(file.stmts).toHaveLength(1);
  });

  it('a very long pipeline chain past the limit: throws, and a subsequent normal parse still succeeds', () => {
    expect(() => parseSync(pipelineChain(2000))).toThrow(ShParseMaxDepthError);
    const file = parseSync('echo hi');
    expect(file.stmts).toHaveLength(1);
  });

  it('nested case/esac blocks past the limit: throws, and a subsequent normal parse still succeeds', () => {
    expect(() => parseSync(nestedCase(2000))).toThrow(ShParseMaxDepthError);
    const file = parseSync('echo hi');
    expect(file.stmts).toHaveLength(1);
  });
});

describe('parseSync — criterion 2b: realistic deep-but-legitimate scripts still parse', () => {
  it('100 levels of nested subshells still parses', () => {
    const file = parseSync(nestedSubshells(100));
    expect(file.type).toBe('File');
  });

  it('a 100-stage pipeline still parses', () => {
    const file = parseSync(pipelineChain(100));
    expect(file.type).toBe('File');
  });

  it('100 nested case/esac blocks still parses', () => {
    const file = parseSync(nestedCase(100));
    expect(file.type).toBe('File');
  });

  it('a realistic mixed-construct script (nested if/subshell/pipeline, depth well under the limit) still parses', () => {
    let script = 'echo start';
    for (let i = 0; i < 30; i++) {
      script = `if true; then (${script} | cat); fi`;
    }
    const file = parseSync(script);
    expect(file.type).toBe('File');
  });
});

describe('parseSync — boundary: exactly at the limit parses, one past it throws', () => {
  it('150 nested subshells (at the limit) still parses', () => {
    const file = parseSync(nestedSubshells(150));
    expect(file.type).toBe('File');
  });

  it('151 nested subshells (one past the limit) throws ShParseMaxDepthError', () => {
    expect(() => parseSync(nestedSubshells(151))).toThrow(ShParseMaxDepthError);
  });

  it('150 nested command substitutions (at the limit) still parses', () => {
    const file = parseSync(nestedCommandSubstitutions(150));
    expect(file.type).toBe('File');
  });

  it('151 nested command substitutions (one past the limit) throws ShParseMaxDepthError', () => {
    expect(() => parseSync(nestedCommandSubstitutions(151))).toThrow(ShParseMaxDepthError);
  });

  it('a 150-link pipeline chain (at the limit) still parses', () => {
    const file = parseSync(pipelineChain(150));
    expect(file.type).toBe('File');
  });

  it('a 151-link pipeline chain (one past the limit) throws ShParseMaxDepthError', () => {
    expect(() => parseSync(pipelineChain(151))).toThrow(ShParseMaxDepthError);
  });
});

describe('parseSync — regression: case-arm pattern terminator is not mistaken for a closing paren', () => {
  // `case WORD in PATTERN)` uses a bare `)` to terminate each arm's pattern
  // list — not a closing paren for anything. An earlier version of this
  // guard's scanner treated every `)` as closing whatever bracket-ish
  // region was currently open, so a case arm's terminator immediately
  // (and incorrectly) "closed" the case block's own depth contribution —
  // silently *under*-counting real nesting for every arm after the first,
  // letting deeply nested `case` blocks slip through uncaught. This test
  // reproduces that scenario directly: without the fix, this input's
  // estimated depth would be a small, roughly-constant number regardless
  // of `n` (since each arm's stray `)` immediately unwound the nesting),
  // so the guard would never fire even at deeply pathological depths.
  it('deeply nested case blocks past the limit are still caught by the guard', () => {
    expect(() => parseSync(nestedCase(2000))).toThrow(ShParseMaxDepthError);
  });

  it('a case block with many (non-nested) sibling arms is not miscounted as deep nesting', () => {
    const arms = Array.from({ length: 300 }, (_, i) => `p${String(i)}) true ;;`).join('\n');
    const file = parseSync(`case x in\n${arms}\nesac`);
    expect(file.type).toBe('File');
  });
});

describe('parseSync — regression: heredoc bodies cannot be used to hide real nesting from the guard', () => {
  // A heredoc body is inert data as far as the real shell grammar is
  // concerned — a `)`/`fi`/`esac`-looking sequence inside `<<EOF ... EOF`
  // is just text, never a real closer. An earlier version of this guard's
  // scanner had no heredoc awareness at all, so a heredoc body full of
  // fake closer tokens placed *between* two batches of genuinely nested
  // parens would blind-pop-close the first batch's open regions,
  // under-counting the true combined depth (split across the heredoc)
  // below the guard's limit even though the real parser sees it as one
  // continuous, pathologically deep nesting.
  it('fake closer tokens inside a heredoc body cannot hide real nesting split across it', () => {
    const fakeClosers = ') '.repeat(1200) + 'fi '.repeat(50) + 'esac '.repeat(50);
    const input = [
      nestedSubshells(120).slice(0, 120), // just the opening parens
      'cat <<EOF',
      fakeClosers,
      'EOF',
      nestedSubshells(120), // a second, independent batch of full nesting
    ].join('\n');
    expect(() => parseSync(input)).toThrow(ShParseMaxDepthError);
  });

  it('a real command substitution inside an unquoted heredoc body still counts toward depth', () => {
    const inner = nestedCommandSubstitutions(2000);
    const input = `cat <<EOF\n${inner}\nEOF\n`;
    expect(() => parseSync(input)).toThrow(ShParseMaxDepthError);
  });

  it('a normal, shallow heredoc — including one with parenthesis-like body text — still parses', () => {
    const file = parseSync('cat <<EOF\nhello (world) { not real } fi done esac\nEOF\n');
    expect(file.type).toBe('File');
  });

  it('a quoted-delimiter heredoc body is fully literal and still parses regardless of its content', () => {
    const file = parseSync("cat <<'EOF'\nliteral $(not expanded) ) ) ) )\nEOF\n");
    expect(file.type).toBe('File');
  });
});

describe('parseSync — multibyte: quoted multibyte content never miscounts or is miscounted as structure', () => {
  // Nesting via `{ ... ; }` brace groups here (rather than `(...)`
  // subshells) deliberately avoids an unrelated shell-grammar ambiguity:
  // two or more adjacent leading `(` at the start of a statement (`((…))`)
  // is mvdan/sh's/bash's arithmetic-command syntax, not nested subshells,
  // and a non-arithmetic payload like a quoted emoji string inside it
  // produces a real, unrelated `ShParseError` — nothing to do with this
  // guard. Brace groups have no such ambiguity.
  it('a single-quoted string full of emoji/CJK deep inside real nesting does not inflate the depth estimate', () => {
    // The quoted payload itself contains no real structural characters
    // (they're literal data inside single quotes), so wrapping the same
    // 100-level nesting around a multibyte payload must parse exactly
    // like the plain-ASCII case.
    const payload = "'🎉🎊 深い入れ子 🚀 café 𝕳𝖊𝖑𝖑𝖔'";
    const inner = 'echo ' + payload;
    let script = inner;
    for (let i = 0; i < 100; i++) {
      script = `{ ${script} ; }`;
    }
    const file = parseSync(script);
    expect(file.type).toBe('File');
  });

  it('a single-quoted string of emoji/CJK past the limit in surrounding real nesting is still caught', () => {
    const payload = "'🎉🎊 深い入れ子 🚀'";
    const inner = 'echo ' + payload;
    let script = inner;
    for (let i = 0; i < 200; i++) {
      script = `{ ${script} ; }`;
    }
    expect(() => parseSync(script)).toThrow(ShParseMaxDepthError);
  });

  it('a lone multibyte-heavy single-quoted string with no real nesting at all still parses', () => {
    const payload = '🎉'.repeat(500) + '深い入れ子'.repeat(500);
    const file = parseSync(`echo '${payload}'`);
    expect(file.type).toBe('File');
  });
});
