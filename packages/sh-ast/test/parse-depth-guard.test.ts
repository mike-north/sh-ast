/**
 * Native resource refusals, grammar-error precedence, and literal-content controls.
 * Every historical fixture remains here even when the native policy changes its
 * outcome. Exact 128-unit boundaries and warmed reuse live in parse-native-budget.
 * These tests cover ordinary callers, not arbitrary pre-existing JS recursion.
 */
import { describe, expect, it } from 'vitest';
import { parseSync, ParseError, ShParseMaxDepthError } from '../src/index.js';

/** Dense adjacent parentheses select arithmetic grammar; retained as a nesting fixture. */
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

/** `n` nested `header ... do BODY; done` loops (covers `for`/`while`/`until`/`select`). */
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

describe('parseSync — typed, catchable native resource error', () => {
  it('throws a ShParseMaxDepthError (not a RangeError) for pathologically deep nesting', () => {
    expect(() => parseSync(nestedSubshells(2000))).toThrow(ShParseMaxDepthError);
  });

  it('the thrown error carries the stable SH_AST_PARSE_MAX_DEPTH code', () => {
    expect.assertions(2);
    try {
      parseSync(nestedSubshells(2000));
    } catch (error) {
      expect(error).toBeInstanceOf(ShParseMaxDepthError);
      expect((error as ShParseMaxDepthError).code).toBe('SH_AST_PARSE_MAX_DEPTH');
    }
  });

  it('the error reports both the limit and the native work counter that tripped it', () => {
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

describe('parseSync — resource refusal preserves the shared WASM instance', () => {
  it('nested subshells past the limit: throws, and a subsequent normal parse still succeeds', () => {
    expect(() => parseSync(nestedSubshells(2000))).toThrow(ShParseMaxDepthError);
    const file = parseSync('echo hi');
    expect(file.Stmts).toHaveLength(1);
  });

  it('nested command substitutions past the limit (the empirically worst vector): throws, and a subsequent normal parse still succeeds', () => {
    expect(() => parseSync(nestedCommandSubstitutions(2000))).toThrow(ShParseMaxDepthError);
    const file = parseSync('echo hi');
    expect(file.Stmts).toHaveLength(1);
  });

  it('a very long pipeline chain past the limit: throws, and a subsequent normal parse still succeeds', () => {
    expect(() => parseSync(pipelineChain(2000))).toThrow(ShParseMaxDepthError);
    const file = parseSync('echo hi');
    expect(file.Stmts).toHaveLength(1);
  });

  it('nested case/esac blocks past the limit: throws, and a subsequent normal parse still succeeds', () => {
    expect(() => parseSync(nestedCase(2000))).toThrow(ShParseMaxDepthError);
    const file = parseSync('echo hi');
    expect(file.Stmts).toHaveLength(1);
  });
});

describe('parseSync — accepted grammar controls', () => {
  it('100 levels of nested subshells still parses', () => {
    const file = parseSync(nestedSubshells(100));
    expect(file.Type).toBe('File');
  });

  it('a 100-stage pipeline still parses', () => {
    const file = parseSync(pipelineChain(100));
    expect(file.Type).toBe('File');
  });

  it('100 nested case/esac blocks still parses', () => {
    const file = parseSync(nestedCase(100));
    expect(file.Type).toBe('File');
  });

  it('a realistic mixed-construct script (nested if/subshell/pipeline, depth well under the limit) still parses', () => {
    let script = 'echo start';
    for (let i = 0; i < 30; i++) {
      script = `if true; then (${script} | cat); fi`;
    }
    const file = parseSync(script);
    expect(file.Type).toBe('File');
  });
});

describe('parseSync — historical 150-unit fixtures exceed the native budget', () => {
  it('150 dense parenthesis levels exceed the native budget', () => {
    expect(() => parseSync(nestedSubshells(150))).toThrow(ShParseMaxDepthError);
  });

  it('151 nested subshells (above the native budget) throws ShParseMaxDepthError', () => {
    expect(() => parseSync(nestedSubshells(151))).toThrow(ShParseMaxDepthError);
  });

  it('150 nested command substitutions exceed the native budget', () => {
    expect(() => parseSync(nestedCommandSubstitutions(150))).toThrow(ShParseMaxDepthError);
  });

  it('151 nested command substitutions (above the native budget) throws ShParseMaxDepthError', () => {
    expect(() => parseSync(nestedCommandSubstitutions(151))).toThrow(ShParseMaxDepthError);
  });

  it('a 150-link pipeline chain exceeds the native budget', () => {
    expect(() => parseSync(pipelineChain(150))).toThrow(ShParseMaxDepthError);
  });

  it('a 151-link pipeline chain (above the native budget) throws ShParseMaxDepthError', () => {
    expect(() => parseSync(pipelineChain(151))).toThrow(ShParseMaxDepthError);
  });
});

describe('parseSync — regression: case-arm pattern terminator is not mistaken for a closing paren', () => {
  it('deeply nested case blocks past the limit are still caught by the guard', () => {
    expect(() => parseSync(nestedCase(2000))).toThrow(ShParseMaxDepthError);
  });

  it('a case block with many (non-nested) sibling arms is not miscounted as deep nesting', () => {
    const arms = Array.from({ length: 300 }, (_, i) => `p${String(i)}) true ;;`).join('\n');
    const file = parseSync(`case x in\n${arms}\nesac`);
    expect(file.Type).toBe('File');
  });
});

describe('parseSync — regression: heredoc bodies cannot be used to hide real nesting from the guard', () => {
  const fakeClosers = ') '.repeat(1200) + 'fi '.repeat(50) + 'esac '.repeat(50);
  it('fake closer tokens inside a heredoc body cannot hide real nesting split across it', () => {
    const input =
      '(\n'.repeat(120) +
      `cat <<EOF\n${fakeClosers}\nEOF\n` +
      '(\n'.repeat(120) +
      'true\n' +
      ')\n'.repeat(240);
    expect(() => parseSync(input)).toThrow(ShParseMaxDepthError);
  });

  it('adjacent opening parens select arithmetic, where << is not a heredoc', () => {
    const input = ['('.repeat(120), 'cat <<EOF', fakeClosers, 'EOF', nestedSubshells(120)].join(
      '\n',
    );
    expect(() => parseSync(input)).toThrow(ParseError);
  });

  it('a real command substitution inside an unquoted heredoc body still counts toward depth', () => {
    const inner = nestedCommandSubstitutions(2000);
    const input = `cat <<EOF\n${inner}\nEOF\n`;
    expect(() => parseSync(input)).toThrow(ShParseMaxDepthError);
  });

  it('a normal, shallow heredoc — including one with parenthesis-like body text — still parses', () => {
    const file = parseSync('cat <<EOF\nhello (world) { not real } fi done esac\nEOF\n');
    expect(file.Type).toBe('File');
  });

  it('a quoted-delimiter heredoc body is fully literal and still parses regardless of its content', () => {
    const file = parseSync("cat <<'EOF'\nliteral $(not expanded) ) ) ) )\nEOF\n");
    expect(file.Type).toBe('File');
  });
});

describe('parseSync — multibyte: quoted multibyte content never miscounts or is miscounted as structure', () => {
  it('a single-quoted string full of emoji/CJK deep inside real nesting does not inflate the native nesting work', () => {
    const payload = "'🎉🎊 深い入れ子 🚀 café 𝕳𝖊𝖑𝖑𝖔'";
    const inner = 'echo ' + payload;
    let script = inner;
    for (let i = 0; i < 100; i++) {
      script = `{ ${script} ; }`;
    }
    const file = parseSync(script);
    expect(file.Type).toBe('File');
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
    expect(file.Type).toBe('File');
  });
});

describe('parseSync — malformed closer fixtures fail grammar before the budget', () => {
  it('the exact stray-brace fixture (n=400) reports ParseError before resource refusal', () => {
    expect(() => parseSync(nestedCaseWithStrayCloser('}', 400))).toThrow(ParseError);
  });

  it('the exact stray-brace fixture (n=1000) reports ParseError before resource refusal', () => {
    expect(() => parseSync(nestedCaseWithStrayCloser('}', 1000))).toThrow(ParseError);
  });

  it('a stray `fi` in case-arm pattern position reports ParseError', () => {
    expect(() => parseSync(nestedCaseWithStrayCloser('fi', 400))).toThrow(ParseError);
  });

  it('a stray `done` in case-arm pattern position reports ParseError', () => {
    expect(() => parseSync(nestedCaseWithStrayCloser('done', 400))).toThrow(ParseError);
  });

  it('a stray `esac` inside subshells reports ParseError', () => {
    const src = '( esac '.repeat(400) + 'true' + ' )'.repeat(400);
    expect(() => parseSync(src)).toThrow(ParseError);
  });

  it('the existing control case — a real, well-formed case block past the limit — still throws correctly', () => {
    expect(() => parseSync(nestedCase(2000))).toThrow(ShParseMaxDepthError);
  });

  it('a shallow script with the same stray-closer shape does not trip the depth guard', () => {
    expect(() => parseSync(nestedCaseWithStrayCloser('}', 10))).not.toThrow(ShParseMaxDepthError);
  });
});

describe('parseSync — regression: `|` inside a case-arm pattern list is alternation, not a pipeline', () => {
  it('a single case arm with 200 pattern alternatives parses fine (no longer miscounted as a 200-stage pipeline)', () => {
    const alternatives = Array.from({ length: 200 }, (_, i) => `pat${String(i)}`).join('|');
    const file = parseSync(`case x in ${alternatives}) true ;; esac`);
    expect(file.Type).toBe('File');
  });

  it("a REAL 151-stage pipeline inside a case arm's action list (body, not pattern) still trips the guard", () => {
    const pipeline = pipelineChain(151);
    expect(() => parseSync(`case x in a) ${pipeline} ;; esac`)).toThrow(ShParseMaxDepthError);
  });

  it('a 149-stage pipeline in a case arm body exceeds the native budget', () => {
    const pipeline = pipelineChain(149);
    expect(() => parseSync(`case x in a) ${pipeline} ;; esac`)).toThrow(ShParseMaxDepthError);
  });

  it('alternation in each arm of a multi-arm case block is correctly treated as inert in every arm, not just the first', () => {
    const file = parseSync('case x in a|b) true ;; c|d) false ;; e|f) : ;; esac');
    expect(file.Type).toBe('File');
  });

  it('a bare `|` immediately after the case keyword and before `in` is not reachable in valid syntax, but a pattern-position `|` right after `in` is still inert', () => {
    const alternatives = Array.from({ length: 200 }, (_, i) => `p${String(i)}`).join('|');
    const file = parseSync(`case x in\n${alternatives}) true ;;\nesac`);
    expect(file.Type).toBe('File');
  });
});

describe('parseSync — test breadth: nested backtick command substitution counts toward depth', () => {
  it('a backtick wrapping 149 command substitutions exceeds the native budget', () => {
    const src = '`' + nestedCommandSubstitutions(149) + '`';
    expect(() => parseSync(src)).toThrow(ShParseMaxDepthError);
  });

  it('a backtick wrapping 150 command substitutions exceeds the native budget', () => {
    const src = '`' + nestedCommandSubstitutions(150) + '`';
    expect(() => parseSync(src)).toThrow(ShParseMaxDepthError);
  });
});

describe('parseSync — loop fixtures exceed the native budget', () => {
  it.each([
    ['for', 'for i in 1;'],
    ['while', 'while true;'],
    ['until', 'until true;'],
    ['select', 'select x in 1;'],
  ] as const)('%s: both 150 and 151 nested loops exceed the native budget', (_label, header) => {
    expect(() => parseSync(nestedLoop(header, 150))).toThrow(ShParseMaxDepthError);
    expect(() => parseSync(nestedLoop(header, 151))).toThrow(ShParseMaxDepthError);
  });
});

describe('parseSync — test breadth: &&/||/|& chain operators are each tested, not just |', () => {
  it.each(['&&', '||', '|&'] as const)(
    'both 150-link and 151-link %s chains exceed the native budget',
    (op) => {
      expect(() => parseSync(chainOperatorChain(op, 150))).toThrow(ShParseMaxDepthError);
      expect(() => parseSync(chainOperatorChain(op, 151))).toThrow(ShParseMaxDepthError);
    },
  );
});

describe('parseSync — test breadth: nested function definitions contribute to depth', () => {
  it('150 nested function definitions exceed the native budget', () => {
    expect(() => parseSync(nestedFunctionDefs(150))).toThrow(ShParseMaxDepthError);
  });

  it('151 nested function definitions throws ShParseMaxDepthError', () => {
    expect(() => parseSync(nestedFunctionDefs(151))).toThrow(ShParseMaxDepthError);
  });
});

describe('parseSync — test breadth: comments/quotes/escapes full of fake structural characters never false-positive', () => {
  it('a comment full of parens/braces/keywords contributes nothing to the native nesting work', () => {
    const fakeStructure =
      '# ' + ') '.repeat(2000) + '} '.repeat(2000) + 'fi done esac ((( {{{ '.repeat(500);
    const file = parseSync(`echo hi ${fakeStructure}\necho bye`);
    expect(file.Type).toBe('File');
  });

  it('a double-quoted string full of fake structural characters contributes nothing to the native nesting work', () => {
    const fakeStructure = '('.repeat(2000) + '{'.repeat(2000) + ' fi done esac ' + ')'.repeat(2000);
    const file = parseSync(`echo "${fakeStructure}"`);
    expect(file.Type).toBe('File');
  });

  it('backslash-escaped parens/braces outside any quoting contribute nothing to the native nesting work', () => {
    const escaped = '\\( \\) \\{ \\} '.repeat(2000);
    const file = parseSync(`echo ${escaped}`);
    expect(file.Type).toBe('File');
  });
});

describe('parseSync — nested arithmetic expansions exceed the native work budget', () => {
  it('75 nested arithmetic expansions exceed the native budget', () => {
    expect(() => parseSync(`echo ${nestedArithmetic(75)}`)).toThrow(ShParseMaxDepthError);
  });

  it('76 nested arithmetic expansions exceed the native budget', () => {
    expect(() => parseSync(`echo ${nestedArithmetic(76)}`)).toThrow(ShParseMaxDepthError);
  });

  it('74 nested arithmetic expansions exceed the native budget', () => {
    expect(() => parseSync(`echo ${nestedArithmetic(74)}`)).toThrow(ShParseMaxDepthError);
  });
});

describe('parseSync — queued heredocs retain source order', () => {
  it('three heredocs queued on one line each start with their own correct delimiter, in order', () => {
    const src = ['cat <<A <<B <<C', 'body-a', 'A', 'body-b', 'B', 'body-c', 'C', ''].join('\n');
    const file = parseSync(src);
    expect(file.Type).toBe('File');
  });

  it('many heredocs queued across many lines all still resolve to their correct bodies', () => {
    const lines: string[] = [];
    const n = 50;
    for (let i = 0; i < n; i++) {
      lines.push(`cat <<DELIM${String(i)}`, `body${String(i)}`, `DELIM${String(i)}`);
    }
    const file = parseSync(lines.join('\n'));
    expect(file.Type).toBe('File');
  });
});
