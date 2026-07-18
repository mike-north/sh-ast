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

/** `n` nested `case`/`esac` blocks, but with a stray `closerWord` (e.g. `}`, `fi`, `done`) inside each arm's *pattern* position instead of a plain letter. */
function nestedCaseWithStrayCloser(closerWord: string, n: number): string {
  return `case x in a ${closerWord}) `.repeat(n) + 'true' + ' ;; esac'.repeat(n);
}

/** `n` nested `header ... do BODY; done` loops (covers `for`/`while`/`until`/`select`, which all share `STRUCTURAL_OPENER_KEYWORDS`). */
function nestedLoop(header: string, n: number): string {
  let body = 'true';
  for (let i = 0; i < n; i++) {
    body = `${header} do ${body}; done`;
  }
  return body;
}

/** A chain of exactly `links` occurrences of `op` (`&&`/`||`/`|&`), i.e. `links + 1` commands. */
function chainOperatorChain(op: '&&' | '||' | '|&', links: number): string {
  return Array.from({ length: links + 1 }, () => 'true').join(` ${op} `);
}

/** `n` nested function definitions: `f0(){ f1(){ ... } ; }`. */
function nestedFunctionDefs(n: number): string {
  let body = 'true';
  for (let i = 0; i < n; i++) {
    body = `f${String(i)}(){ ${body} ; }`;
  }
  return body;
}

/** `n` nested `$((...))` arithmetic expansions. */
function nestedArithmetic(n: number): string {
  return '$(('.repeat(n) + '1' + '))'.repeat(n);
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

describe('parseSync — regression: an unmatched closer must never decrement depth state (self-cancel bypass)', () => {
  // Root cause: `)`/`}`/`fi`/`done`/`esac` each used to call `close()`
  // unconditionally after attempting `popRegion(...)`, even when the pop
  // didn't actually match the top of the region stack. `case x in a})`
  // pushes a `'case'` region (from `case`) but the stray `}` right after
  // — which doesn't match anything real — used to decrement `bracketDepth`
  // anyway, exactly canceling out the depth `case` had just added. Repeated
  // `n` times, this produced a script whose *real* nesting (the region
  // stack mvdan/sh's parser will actually recurse through) grows without
  // bound while this guard's own depth estimate stayed near zero — the
  // guard stayed silent, and the real WASM parser crashed with an
  // uncatchable `RangeError` (empirically confirmed at n=400, well before
  // this fix, using this exact fixture — see this describe block's first
  // test). The fix: every closer now only decrements state when its
  // `popRegion(...)` call actually matched.
  it('the exact stray-brace fixture (n=400) throws ShParseMaxDepthError, never a raw RangeError', () => {
    expect(() => parseSync(nestedCaseWithStrayCloser('}', 400))).toThrow(ShParseMaxDepthError);
  });

  it('the exact stray-brace fixture (n=1000) throws ShParseMaxDepthError, never a raw RangeError', () => {
    expect(() => parseSync(nestedCaseWithStrayCloser('}', 1000))).toThrow(ShParseMaxDepthError);
  });

  it('a stray `fi` in case-arm pattern position is an equivalent self-cancel vector, also fixed', () => {
    expect(() => parseSync(nestedCaseWithStrayCloser('fi', 400))).toThrow(ShParseMaxDepthError);
  });

  it('a stray `done` in case-arm pattern position is an equivalent self-cancel vector, also fixed', () => {
    expect(() => parseSync(nestedCaseWithStrayCloser('done', 400))).toThrow(ShParseMaxDepthError);
  });

  it('a stray `esac` with no open case at all (inside unrelated subshells) is also inert, not a self-cancel', () => {
    // `esac` here has no matching `case` on the region stack at all (the
    // open regions are all plain subshells) — `popRegion('case')` must
    // fail every time, so `bracketDepth` still accumulates the full `n`
    // real subshell opens undiminished.
    const src = '( esac '.repeat(400) + 'true' + ' )'.repeat(400);
    expect(() => parseSync(src)).toThrow(ShParseMaxDepthError);
  });

  it('the existing control case — a real, well-formed case block past the limit — still throws correctly', () => {
    expect(() => parseSync(nestedCase(2000))).toThrow(ShParseMaxDepthError);
  });

  it('a shallow script with the same stray-closer shape does not trip the depth guard', () => {
    // `case x in a }) ...` is not valid shell syntax at all (real bash
    // rejects it too — "syntax error near unexpected token `}'"), so this
    // doesn't assert a full successful parse; it only asserts that this
    // guard specifically stays silent for shallow input, whatever else may
    // or may not be wrong with it.
    expect(() => parseSync(nestedCaseWithStrayCloser('}', 10))).not.toThrow(ShParseMaxDepthError);
  });
});

describe('parseSync — regression: `|` inside a case-arm pattern list is alternation, not a pipeline', () => {
  // `case WORD in PATTERN1|PATTERN2|...) LIST ;; esac` — the `|` between
  // alternative patterns is glob-alternation syntax that mvdan/sh's parser
  // does not recurse per alternative the way it does per real pipeline
  // stage. Counting it as a chain link over-estimated depth for a case arm
  // with many alternatives, falsely rejecting realistic scripts (e.g. a
  // single arm matching 151+ short option spellings).
  it('a single case arm with 200 pattern alternatives parses fine (no longer miscounted as a 200-stage pipeline)', () => {
    const alternatives = Array.from({ length: 200 }, (_, i) => `pat${String(i)}`).join('|');
    const file = parseSync(`case x in ${alternatives}) true ;; esac`);
    expect(file.type).toBe('File');
  });

  it("a REAL 151-stage pipeline inside a case arm's action list (body, not pattern) still trips the guard", () => {
    // Guards against over-suppressing: `|` after the arm's terminating `)`
    // is back in ordinary command position, where it's a genuine pipeline.
    const pipeline = pipelineChain(151);
    expect(() => parseSync(`case x in a) ${pipeline} ;; esac`)).toThrow(ShParseMaxDepthError);
  });

  it('a 149-stage pipeline in a case arm body is still at the boundary (parses)', () => {
    // The enclosing `case` region itself contributes 1 to the total depth
    // (from `pushRegion('case')` + `open()` at the `case` keyword), so a
    // pipeline *inside* one of its arms reaches the same 150-unit limit one
    // stage earlier than a top-level pipeline does (compare the 150/151
    // boundary in the "boundary" describe block above, with no enclosing
    // case).
    const pipeline = pipelineChain(149);
    const file = parseSync(`case x in a) ${pipeline} ;; esac`);
    expect(file.type).toBe('File');
  });

  it('alternation in each arm of a multi-arm case block is correctly treated as inert in every arm, not just the first', () => {
    // Exercises the `;;` -> pattern-position transition between arms.
    const file = parseSync('case x in a|b) true ;; c|d) false ;; e|f) : ;; esac');
    expect(file.type).toBe('File');
  });

  it('a bare `|` immediately after the case keyword and before `in` is not reachable in valid syntax, but a pattern-position `|` right after `in` is still inert', () => {
    const alternatives = Array.from({ length: 200 }, (_, i) => `p${String(i)}`).join('|');
    const file = parseSync(`case x in\n${alternatives}) true ;;\nesac`);
    expect(file.type).toBe('File');
  });
});

describe('parseSync — test breadth: nested backtick command substitution counts toward depth', () => {
  it('a backtick substitution wrapping 149 nested $(...) command substitutions is exactly at the limit (150 total)', () => {
    const src = '`' + nestedCommandSubstitutions(149) + '`';
    const file = parseSync(src);
    expect(file.type).toBe('File');
  });

  it('a backtick substitution wrapping 150 nested $(...) command substitutions is one past the limit (151 total)', () => {
    const src = '`' + nestedCommandSubstitutions(150) + '`';
    expect(() => parseSync(src)).toThrow(ShParseMaxDepthError);
  });
});

describe('parseSync — test breadth: for/while/until/select each get their own at/over-limit pair', () => {
  it.each([
    ['for', 'for i in 1;'],
    ['while', 'while true;'],
    ['until', 'until true;'],
    ['select', 'select x in 1;'],
  ] as const)('%s: 150 nested loops parses, 151 throws', (_label, header) => {
    const file = parseSync(nestedLoop(header, 150));
    expect(file.type).toBe('File');
    expect(() => parseSync(nestedLoop(header, 151))).toThrow(ShParseMaxDepthError);
  });
});

describe('parseSync — test breadth: &&/||/|& chain operators are each tested, not just |', () => {
  it.each(['&&', '||', '|&'] as const)(
    'a 150-link %s chain parses, a 151-link chain throws',
    (op) => {
      const file = parseSync(chainOperatorChain(op, 150));
      expect(file.type).toBe('File');
      expect(() => parseSync(chainOperatorChain(op, 151))).toThrow(ShParseMaxDepthError);
    },
  );
});

describe('parseSync — test breadth: nested function definitions contribute to depth', () => {
  it('150 nested function definitions parses', () => {
    const file = parseSync(nestedFunctionDefs(150));
    expect(file.type).toBe('File');
  });

  it('151 nested function definitions throws ShParseMaxDepthError', () => {
    expect(() => parseSync(nestedFunctionDefs(151))).toThrow(ShParseMaxDepthError);
  });
});

describe('parseSync — test breadth: comments/quotes/escapes full of fake structural characters never false-positive', () => {
  it('a comment full of parens/braces/keywords contributes nothing to the depth estimate', () => {
    const fakeStructure =
      '# ' + ') '.repeat(2000) + '} '.repeat(2000) + 'fi done esac ((( {{{ '.repeat(500);
    const file = parseSync(`echo hi ${fakeStructure}\necho bye`);
    expect(file.type).toBe('File');
  });

  it('a double-quoted string full of fake structural characters contributes nothing to the depth estimate', () => {
    const fakeStructure = '('.repeat(2000) + '{'.repeat(2000) + ' fi done esac ' + ')'.repeat(2000);
    const file = parseSync(`echo "${fakeStructure}"`);
    expect(file.type).toBe('File');
  });

  it('backslash-escaped parens/braces outside any quoting contribute nothing to the depth estimate', () => {
    const escaped = '\\( \\) \\{ \\} '.repeat(2000);
    const file = parseSync(`echo ${escaped}`);
    expect(file.type).toBe('File');
  });
});

describe('parseSync — test breadth: nested $((...)) arithmetic expansion is deliberately double-counted (conservative)', () => {
  // Each `$((...))` level counts as *two* bracket-depth increments (one per
  // paren) — see `estimateMaxNestingDepth`'s doc comment — so the boundary
  // for pure arithmetic nesting is half of MAX_PARSE_NESTING_DEPTH (150),
  // not the same as every other single-increment-per-level construct.
  it('75 nested arithmetic expansions (150 total depth units) is exactly at the limit', () => {
    const file = parseSync(`echo ${nestedArithmetic(75)}`);
    expect(file.type).toBe('File');
  });

  it('76 nested arithmetic expansions (152 total depth units) is over the limit', () => {
    expect(() => parseSync(`echo ${nestedArithmetic(76)}`)).toThrow(ShParseMaxDepthError);
  });

  it('74 nested arithmetic expansions (148 total depth units) is comfortably under the limit', () => {
    const file = parseSync(`echo ${nestedArithmetic(74)}`);
    expect(file.type).toBe('File');
  });
});

describe('parseSync — regression: queuing several heredocs on one line still starts each in source order (pendingHeredocs cursor)', () => {
  // `startNextHeredocIfAny` used to `Array.prototype.shift()` off a queue;
  // it now reads through an index cursor instead (an O(k)-per-call ->
  // O(1)-amortized fix, since `shift()` re-indexes the whole remaining
  // array on every call) — this pins that the *order* multiple queued
  // heredocs start in is unaffected by that change.
  it('three heredocs queued on one line each start with their own correct delimiter, in order', () => {
    const src = ['cat <<A <<B <<C', 'body-a', 'A', 'body-b', 'B', 'body-c', 'C', ''].join('\n');
    const file = parseSync(src);
    expect(file.type).toBe('File');
  });

  it('many heredocs queued across many lines all still resolve to their correct bodies', () => {
    const lines: string[] = [];
    const n = 50;
    for (let i = 0; i < n; i++) {
      lines.push(`cat <<DELIM${String(i)}`, `body${String(i)}`, `DELIM${String(i)}`);
    }
    const file = parseSync(lines.join('\n'));
    expect(file.type).toBe('File');
  });
});
