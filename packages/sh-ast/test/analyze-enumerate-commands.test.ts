/**
 * Tests for {@link enumerateCommands} (`sh-ast/analyze`) against the
 * acceptance criteria in https://github.com/mike-north/eslint-sh/issues/4.
 *
 * Criterion -> test mapping (see this PR's description for the full table):
 *
 *   1. Compound coverage (one named test per `CommandContext` kind) — the
 *      `describe('enumerateCommands — criterion 1 ...')` block below.
 *   2. Hidden-command coverage (`$(...)` in an argument, `<(...)`, a
 *      redirection target) — the `describe('enumerateCommands — criterion 2
 *      ...')` block.
 *   3. Completeness backstop against an independent oracle — `describe('...
 *      criterion 3 ...')`, which walks the kitchen-sink fixtures using the
 *      *raw generated* `visitorKeys` table (`../generated/visitor-keys.js`)
 *      to count `CallExpr` nodes, deliberately not reusing `enumerateCommands`'
 *      own descent or `walk()`'s structural discovery.
 *   4. Source-order guarantee — `describe('... criterion 4 ...')`.
 *
 * All expected `CommandContext` values below are hand-derived from the
 * shell source being parsed (never captured from running this
 * implementation) — see "Spec-First Test Assertions" in this repo's testing
 * conventions.
 *
 * @see https://pkg.go.dev/mvdan.cc/sh/v3@v3.13.1/syntax — mvdan/sh's AST reference (ground truth for node shapes)
 * @see https://www.gnu.org/software/bash/manual/bash.html#Tilde-Expansion — §3.5.2, colon-tilde vs. command-argument tilde expansion (argv-context regression below)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CommandContext, CommandSite } from '../src/analyze/index.js';
import { enumerateCommands } from '../src/analyze/index.js';
import { ShAnalyzeMaxDepthError } from '../src/index.js';
import { parseSync } from '../src/index.js';
import type { ShellDialect, ShNode } from '../src/index.js';
import { visitorKeys as rawGeneratedVisitorKeys } from '../generated/visitor-keys.js';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

/**
 * Asserts `value` is defined (with `message` as the failure explanation)
 * and returns it narrowed to `T`, without a forbidden non-null assertion —
 * mirrors `kitchen-sink.test.ts`'s/`analyze-resolve-word.test.ts`'s helper
 * of the same name/shape.
 */
function assertDefined<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeDefined();
  if (value === undefined) throw new Error(message);
  return value;
}

/** `enumerateCommands` on `src`, plus the exact source text of each site's `CallExpr`. */
function siteTexts(src: string, dialect?: ShellDialect): readonly string[] {
  const file = parseSync(src, dialect ? { dialect } : undefined);
  return enumerateCommands(file).map((site) => src.slice(site.node.range[0], site.node.range[1]));
}

function enumerate(src: string, dialect?: ShellDialect): readonly CommandSite[] {
  const file = parseSync(src, dialect ? { dialect } : undefined);
  return enumerateCommands(file);
}

/** Finds the (unique) site whose `CallExpr` source text is exactly `text`. */
function siteFor(sites: readonly CommandSite[], src: string, text: string): CommandSite {
  const matches = sites.filter(
    (site) => src.slice(site.node.range[0], site.node.range[1]) === text,
  );
  expect(
    matches,
    `expected exactly one site for ${JSON.stringify(text)}, found ${String(matches.length)}`,
  ).toHaveLength(1);
  return assertDefined(matches[0], 'unreachable — length checked above');
}

// --- Synthetic-node helpers for stack-depth tests below ---
//
// A chain/nesting depth large enough to actually exercise this module's
// iterative-traversal fix or its depth guard is, empirically, also large
// enough to crash mvdan/sh's own WASM parser before `enumerateCommands`
// ever sees the tree (verified: `parseSync` on a real 900+-stage pipeline
// or 900+-deep nested-subshell source string hits its own
// `RangeError: Maximum call stack size exceeded` well before this module's
// depth guard would). These tests therefore build the `ShNode` tree
// directly — bypassing `parseSync` entirely — mirroring the pattern
// `analyze-resolve-word.test.ts` uses for other real-parser-unreachable
// shapes.

const SYNTHETIC_LOC: ShNode['loc'] = { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } };

/** Builds a minimal, otherwise-empty synthetic `ShNode` of the given `type`. */
function syntheticNode(type: string, fields: Readonly<Record<string, unknown>> = {}): ShNode {
  return { type, range: [0, 0], loc: SYNTHETIC_LOC, ...fields };
}

function syntheticCallStmt(name: string): ShNode {
  return syntheticNode('Stmt', {
    cmd: syntheticNode('CallExpr', {
      args: [syntheticNode('Word', { parts: [syntheticNode('Lit', { value: name })] })],
    }),
  });
}

/**
 * A left-nested `BinaryCmd` chain of `n` `CallExpr` stages, mirroring
 * exactly what mvdan/sh itself would produce for `c0 <op> c1 <op> ... <op>
 * c(n-1)` (see `flattenPipelineStages`'s and `visitBinaryCmd`'s doc
 * comments for the shape). `op` is the raw `BinCmdOperator` token value —
 * `13` for `|` (pipeline), `11` for `&&`.
 */
function syntheticBinaryChain(n: number, op: number): ShNode {
  let acc = syntheticCallStmt('c0');
  for (let i = 1; i < n; i += 1) {
    acc = syntheticNode('Stmt', {
      cmd: syntheticNode('BinaryCmd', { op, x: acc, y: syntheticCallStmt(`c${String(i)}`) }),
    });
  }
  return acc;
}

/** `n` levels of `Subshell`-in-`Subshell` nesting around a single inner `CallExpr`. */
function syntheticNestedSubshells(n: number): ShNode {
  let acc = syntheticCallStmt('inner');
  for (let i = 0; i < n; i += 1) {
    acc = syntheticNode('Stmt', { cmd: syntheticNode('Subshell', { stmts: [acc] }) });
  }
  return acc;
}

describe('enumerateCommands — criterion 1: compound coverage (one context kind per test)', () => {
  it("'and'/'or'/'pipeline': `a && b || c | d` yields 4 sites with correct contexts", () => {
    const src = 'a && b || c | d';
    const sites = enumerate(src);
    expect(sites.map((s) => src.slice(s.node.range[0], s.node.range[1]))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);

    const contextOf = (text: string): readonly CommandContext[] =>
      siteFor(sites, src, text).context;
    // `a` is the left side of `&&`, which is itself the left side of `||` —
    // neither side of a `BinaryCmd` tags its left operand, so `a` inherits
    // an empty context.
    expect(contextOf('a')).toEqual([]);
    // `b` is the right side of `&&`.
    expect(contextOf('b')).toEqual([{ kind: 'and', side: 'right' }]);
    // `c | d` (the pipeline) is the right side of `||`, so both its stages
    // inherit that frame, then add their own pipeline stage.
    expect(contextOf('c')).toEqual([
      { kind: 'or', side: 'right' },
      { kind: 'pipeline', stage: 0 },
    ]);
    expect(contextOf('d')).toEqual([
      { kind: 'or', side: 'right' },
      { kind: 'pipeline', stage: 1 },
    ]);
  });

  it("'pipeline': a 3-stage `|`/`|&` mixed chain flattens into one pipeline with stages 0, 1, 2", () => {
    const src = 'a | b |& c';
    const sites = enumerate(src);
    const contextOf = (text: string): readonly CommandContext[] =>
      siteFor(sites, src, text).context;
    expect(contextOf('a')).toEqual([{ kind: 'pipeline', stage: 0 }]);
    expect(contextOf('b')).toEqual([{ kind: 'pipeline', stage: 1 }]);
    expect(contextOf('c')).toEqual([{ kind: 'pipeline', stage: 2 }]);
  });

  it("'subshell': `(a; b)` tags both statements with a subshell frame", () => {
    const src = '(a; b)';
    const sites = enumerate(src);
    expect(sites.map((s) => s.context)).toEqual([[{ kind: 'subshell' }], [{ kind: 'subshell' }]]);
    expect(siteTexts(src)).toEqual(['a', 'b']);
  });

  it("'cmdSubst': a command inside `$(...)` is tagged with a cmdSubst frame", () => {
    const src = 'echo "$(sub)"';
    const sites = enumerate(src);
    const contextOf = (text: string): readonly CommandContext[] =>
      siteFor(sites, src, text).context;
    expect(contextOf('echo "$(sub)"')).toEqual([]);
    expect(contextOf('sub')).toEqual([{ kind: 'cmdSubst' }]);
  });

  it("'procSubst': a command inside `<(...)` is tagged with a procSubst frame", () => {
    const src = 'echo <(sub)';
    const sites = enumerate(src);
    const contextOf = (text: string): readonly CommandContext[] =>
      siteFor(sites, src, text).context;
    expect(contextOf('echo <(sub)')).toEqual([]);
    expect(contextOf('sub')).toEqual([{ kind: 'procSubst' }]);
  });

  it("'if': cond/then/else branches are tagged, and an elif chain nests as else->cond/then", () => {
    const src = 'if c1; then t1; elif c2; then t2; else e1; fi';
    const sites = enumerate(src);
    const contextOf = (text: string): readonly CommandContext[] =>
      siteFor(sites, src, text).context;
    expect(contextOf('c1')).toEqual([{ kind: 'if', branch: 'cond' }]);
    expect(contextOf('t1')).toEqual([{ kind: 'if', branch: 'then' }]);
    // mvdan/sh models `elif` as `IfClause.Else` pointing to another
    // `IfClause` — so `c2`/`t2` are reached through an `else` frame first.
    expect(contextOf('c2')).toEqual([
      { kind: 'if', branch: 'else' },
      { kind: 'if', branch: 'cond' },
    ]);
    expect(contextOf('t2')).toEqual([
      { kind: 'if', branch: 'else' },
      { kind: 'if', branch: 'then' },
    ]);
    expect(contextOf('e1')).toEqual([
      { kind: 'if', branch: 'else' },
      { kind: 'if', branch: 'else' },
      { kind: 'if', branch: 'then' },
    ]);
  });

  it("'case': each branch body is tagged with a case frame (the subject and patterns are not)", () => {
    const src = 'case $x in a) c1;; b) c2;; esac';
    const sites = enumerate(src);
    expect(sites.map((s) => s.context)).toEqual([[{ kind: 'case' }], [{ kind: 'case' }]]);
    expect(siteTexts(src)).toEqual(['c1', 'c2']);
  });

  it("'loop': a `for` loop tags only the body (role: 'body'); a `while` loop tags both cond and body", () => {
    const forSrc = 'for i in 1 2; do body1; done';
    expect(enumerate(forSrc).map((s) => s.context)).toEqual([[{ kind: 'loop', role: 'body' }]]);

    const whileSrc = 'while cond2; do body2; done';
    const whileSites = enumerate(whileSrc);
    const contextOf = (text: string): readonly CommandContext[] =>
      siteFor(whileSites, whileSrc, text).context;
    expect(contextOf('cond2')).toEqual([{ kind: 'loop', role: 'cond' }]);
    expect(contextOf('body2')).toEqual([{ kind: 'loop', role: 'body' }]);
  });

  it("'function': a function body is tagged with the function's name", () => {
    const src = 'greet() { fb; }';
    const sites = enumerate(src);
    expect(sites.map((s) => s.context)).toEqual([[{ kind: 'function', name: 'greet' }]]);
    expect(siteTexts(src)).toEqual(['fb']);
  });

  it("'background': `cmd &` tags the statement with a background frame", () => {
    const src = 'bg &';
    expect(enumerate(src).map((s) => s.context)).toEqual([[{ kind: 'background' }]]);
  });

  it("'negated': `! cmd` tags the statement with a negated frame", () => {
    const src = '! neg';
    expect(enumerate(src).map((s) => s.context)).toEqual([[{ kind: 'negated' }]]);
  });

  it("'coproc': a coproc's statement is tagged with a coproc frame", () => {
    const src = 'coproc cp { cpbody; }';
    expect(enumerate(src).map((s) => s.context)).toEqual([[{ kind: 'coproc' }]]);
    expect(siteTexts(src)).toEqual(['cpbody']);
  });

  it("TimeClause is transparent: `time cmd`'s site has an empty context array, not just a matching count", () => {
    // The kitchen-sink completeness backstop (criterion 3) already proves
    // `time echo timed` contributes exactly one CallExpr site — but a
    // count match alone can't distinguish "correctly transparent" from
    // "wrongly tagged with some frame, but still exactly one site". Assert
    // the context directly.
    const src = 'time timed';
    const sites = enumerate(src);
    expect(sites).toHaveLength(1);
    expect(sites[0]?.context).toEqual([]);
    expect(siteTexts(src)).toEqual(['timed']);
  });
});

describe('enumerateCommands — criterion 2: hidden-command coverage (one test per hiding place)', () => {
  it('finds a command hidden inside `$(...)` in an argument', () => {
    const src = 'echo "prefix $(hidden arg) suffix"';
    expect(siteTexts(src)).toEqual([src, 'hidden arg']);
  });

  it('finds a command hidden inside `<(...)` (process substitution)', () => {
    const src = 'diff <(left) <(right)';
    expect(siteTexts(src)).toEqual([src, 'left', 'right']);
  });

  it('finds a command hidden inside a redirection target', () => {
    const src = 'cat < <(hidden)';
    const sites = enumerate(src);
    const contextOf = (text: string): readonly CommandContext[] =>
      siteFor(sites, src, text).context;
    expect(siteTexts(src)).toEqual(['cat', 'hidden']);
    expect(contextOf('hidden')).toEqual([{ kind: 'procSubst' }]);
  });

  // The four tests below each pin one `scanForHiddenCommands` call site in
  // `visitCommand`'s switch — `CaseClause.word`, `ForClause.loop`,
  // `TestClause.x`, `ArithmCmd.x` — that the review's mutation-testing pass
  // found had *no* test that would fail if that specific call were removed
  // (each site's hidden command still happened to be found by some *other*
  // in-scope scan, or the branch's other coverage masked the omission).
  // Verified for real: temporarily deleting each corresponding
  // `scanForHiddenCommands(...)` line and re-running these four tests
  // fails exactly the matching one, with `sub` missing from the result.

  it('finds a command hidden inside a `case` subject (CaseClause.word)', () => {
    const src = 'case $(sub) in x) : ;; esac';
    const sites = enumerate(src);
    const contextOf = (text: string): readonly CommandContext[] =>
      siteFor(sites, src, text).context;
    expect(siteTexts(src)).toEqual(['sub', ':']);
    expect(contextOf('sub')).toEqual([{ kind: 'cmdSubst' }]);
  });

  it('finds a command hidden inside a `for` loop word list (ForClause.loop)', () => {
    const src = 'for i in $(sub); do :; done';
    const sites = enumerate(src);
    const contextOf = (text: string): readonly CommandContext[] =>
      siteFor(sites, src, text).context;
    expect(siteTexts(src)).toEqual(['sub', ':']);
    expect(contextOf('sub')).toEqual([{ kind: 'cmdSubst' }]);
  });

  it('finds a command hidden inside a `[[ ]]` test operand (TestClause.x)', () => {
    const src = '[[ $(sub) = x ]]';
    expect(siteTexts(src)).toEqual(['sub']);
    const site = assertDefined(enumerate(src)[0], 'unreachable — expected exactly 1 site');
    expect(site.context).toEqual([{ kind: 'cmdSubst' }]);
  });

  it('finds a command hidden inside a `(( ))` arithmetic operand (ArithmCmd.x)', () => {
    const src = '(( $(sub) ))';
    expect(siteTexts(src)).toEqual(['sub']);
    const site = assertDefined(enumerate(src)[0], 'unreachable — expected exactly 1 site');
    expect(site.context).toEqual([{ kind: 'cmdSubst' }]);
  });
});

describe('enumerateCommands — criterion 3: completeness backstop (independent oracle)', () => {
  /**
   * Counts `CallExpr` nodes by walking the tree using the *raw generated*
   * `visitorKeys` table (`generated/visitor-keys.js`, produced by
   * `tools/gen-visitor-keys` from mvdan/sh's own struct definitions) —
   * deliberately a different traversal mechanism than both
   * `enumerateCommands`' hand-written context-aware descent (the thing
   * under test) and `walk()`'s structural discovery (used elsewhere in
   * this test suite/repo). If `enumerateCommands` silently skips a
   * CallExpr-bearing corner of the grammar, this count and
   * `enumerateCommands(...).length` diverge.
   *
   * Excludes a `CallExpr` with zero `args` (mvdan/sh's representation of an
   * assignment-only statement, e.g. `x=1` — the kitchen-sink fixtures
   * contain several) — this bridge's own grammar already distinguishes
   * "no first word to invoke" from "a real command", and
   * `enumerateCommands` documents (and has a dedicated negative test for)
   * not reporting a site for one, since no program runs. This is a narrow,
   * structural exclusion (an `args.length` check on the oracle's own
   * traversal, not a call into `enumerateCommands`), so the oracle stays
   * independent: it would still catch, for example, a `CallExpr` dropped
   * from inside a `<(...)` or a loop body.
   */
  function countCallExprViaGeneratedVisitorKeys(node: ShNode): number {
    const isInvocation =
      node.type === 'CallExpr' && Array.isArray(node.args) && node.args.length > 0;
    let count = isInvocation ? 1 : 0;
    const keys: readonly string[] =
      (rawGeneratedVisitorKeys as Readonly<Record<string, readonly string[]>>)[node.type] ?? [];
    for (const key of keys) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) count += countCallExprViaGeneratedVisitorKeys(child);
        }
      } else if (isNode(value)) {
        count += countCallExprViaGeneratedVisitorKeys(value);
      }
    }
    return count;
  }

  function isNode(value: unknown): value is ShNode {
    return (
      typeof value === 'object' && value !== null && typeof (value as ShNode).type === 'string'
    );
  }

  const fixtures: {
    readonly label: string;
    readonly dialect: ShellDialect;
    readonly file: string;
  }[] = [
    { label: 'bash', dialect: 'bash', file: 'kitchen-sink.bash.sh' },
    { label: 'zsh', dialect: 'zsh', file: 'kitchen-sink.zsh.sh' },
    { label: 'bats', dialect: 'bats', file: 'kitchen-sink.bats.sh' },
  ];

  it.each(fixtures)(
    'finds exactly as many command sites as there are CallExpr nodes in the $label kitchen-sink fixture',
    ({ dialect, file }) => {
      const parsed = parseSync(fixture(file), { dialect });
      const expectedCount = countCallExprViaGeneratedVisitorKeys(parsed);
      expect(expectedCount).toBeGreaterThan(0);
      expect(enumerateCommands(parsed)).toHaveLength(expectedCount);
    },
  );
});

describe('enumerateCommands — criterion 4: source-order guarantee', () => {
  it('returns sites in source order across a mix of contexts', () => {
    const src = [
      'first_cmd',
      'if cond_stmt; then in_then; fi',
      'for i in 1; do in_loop; done',
      'echo "$(nested_last)"',
    ].join('\n');
    expect(siteTexts(src)).toEqual([
      'first_cmd',
      'cond_stmt',
      'in_then',
      'in_loop',
      src.split('\n')[3],
      'nested_last',
    ]);
  });

  it('returns a redirection-target substitution in its true source position, not after the command that structurally owns it', () => {
    // The ProcSubst is discovered while scanning the Stmt's redirs, which
    // this module processes structurally *before* dispatching into `.cmd`
    // — but it is positioned *after* `cmd` in the source, so a naive
    // traversal-order return (without the final range-sort) would still
    // happen to get this right; this test pins the *guarantee* rather than
    // an accident of traversal order.
    const src = 'cmd < <(after)';
    expect(siteTexts(src)).toEqual(['cmd', 'after']);
  });
});

describe('enumerateCommands — negative/edge cases', () => {
  it('an empty script (a File with no statements) yields no command sites', () => {
    // `parseSync` itself cannot produce a `File` with zero statements for
    // fully blank/comment-only source (a pre-existing normalizer
    // limitation unrelated to this module — see design/ARCHITECTURE.md's
    // serialization contract discussion), so this constructs the shape
    // `enumerateCommands` actually depends on directly, to test the
    // contract at its own boundary rather than at parseSync's.
    const emptyFile: ShNode = {
      type: 'File',
      range: [0, 0],
      loc: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
      stmts: [],
    };
    expect(enumerateCommands(emptyFile)).toEqual([]);
  });

  it('a command with a dynamic (non-static) argv0 is still enumerated, with static: false', () => {
    const src = '$cmd arg';
    const sites = enumerate(src);
    expect(sites).toHaveLength(1);
    const site = assertDefined(sites[0], 'unreachable — length checked above');
    expect(site.argv0).toEqual({ static: false, reason: 'expansion' });
    expect(site.argv).toHaveLength(2);
    expect(site.argv[1]).toEqual({ static: true, text: 'arg' });
  });

  it('an assignment-only statement (no argv0) produces no site for itself', () => {
    expect(enumerate('FOO=bar')).toEqual([]);
  });

  it('a command substitution hidden inside an assignment value is still found, even though the assignment itself has no site', () => {
    const src = 'FOO=$(hidden)';
    expect(siteTexts(src)).toEqual(['hidden']);
    const site = assertDefined(enumerate(src)[0], 'unreachable — expected exactly 1 site');
    expect(site.context).toEqual([{ kind: 'cmdSubst' }]);
  });

  it('a command with both a leading assignment and args produces one site (its CallExpr spans both)', () => {
    const src = 'FOO=bar cmd arg';
    // The `CallExpr` node covers `Assigns` and `Args` together (mvdan/sh's
    // `CallExpr struct { Assigns []*Assign; Args []*Word }`), so its source
    // span is the whole statement, not just the invoked words.
    expect(siteTexts(src)).toEqual([src]);
    const site = assertDefined(enumerate(src)[0], 'unreachable — expected exactly 1 site');
    expect(site.argv0).toEqual({ static: true, text: 'cmd' });
    expect(site.argv.map((w) => w.static && w.text)).toEqual(['cmd', 'arg']);
  });
});

describe('enumerateCommands — argv resolved with command-argument semantics (regression: colon-tilde)', () => {
  // Bash Reference Manual §3.5.2 "Tilde Expansion": an unquoted `~`
  // immediately following an unquoted `:` is only special-cased for
  // certain colon-separated *assignment values* (e.g. `PATH=/foo:~/bar`).
  // An ordinary command-argument word has no such rule — only a
  // word-initial unquoted `~` triggers expansion there, so `a:~/b` as a
  // command argument is literal, static text, not a tilde-expansion site.
  // Every `CallExpr` word is command-argument position (never an
  // assignment value), so `enumerateCommands` must resolve `argv`/`argv0`
  // with `resolveWord`'s `{ context: 'command-argument' }` — omitting the
  // option falls back to `resolveWord`'s more conservative
  // `'assignment-value'` default (see `ResolveWordOptions.context`'s doc
  // comment) and would wrongly report this word as `static: false`.
  it('resolves a colon-tilde command argument as static text, not a tilde-expansion site', () => {
    const src = 'cmd a:~/b';
    const sites = enumerate(src);
    expect(sites).toHaveLength(1);
    const site = assertDefined(sites[0], 'unreachable — length checked above');
    expect(site.argv).toHaveLength(2);
    expect(site.argv[1]).toEqual({ static: true, text: 'a:~/b' });
  });

  it('resolves an scp-style host:~/path argument as static text too', () => {
    const src = 'scp host:~/path local';
    expect(siteTexts(src)).toEqual([src]);
    const site = assertDefined(enumerate(src)[0], 'unreachable — expected exactly 1 site');
    expect(site.argv.map((w) => w.static && w.text)).toEqual(['scp', 'host:~/path', 'local']);
  });

  it('a word-initial tilde in a command argument is still reported as a tilde-expansion site (unaffected by the colon-tilde fix)', () => {
    const src = 'cmd ~/b';
    const site = assertDefined(enumerate(src)[0], 'unreachable — expected exactly 1 site');
    expect(site.argv[1]).toEqual({ static: false, reason: 'tilde' });
  });
});

describe('enumerateCommands — multibyte fidelity', () => {
  it('slices a CallExpr node and resolves an argument containing multibyte text correctly', () => {
    const src = 'echo 你好🎉';
    const sites = enumerate(src);
    expect(sites).toHaveLength(1);
    const site = assertDefined(sites[0], 'unreachable — length checked above');
    expect(src.slice(site.node.range[0], site.node.range[1])).toBe(src);
    expect(site.argv).toHaveLength(2);
    expect(site.argv[1]).toEqual({ static: true, text: '你好🎉' });
  });
});

describe('enumerateCommands — binary command operator identification (canary)', () => {
  // Pins the mvdan/sh v3.13.1 `BinCmdOperator` numeric token values this
  // module relies on internally to distinguish `&&`/`||`/`|`/`|&` (see
  // enumerate-commands.ts's `BIN_CMD_OP_*` comment) — not part of any
  // documented wire contract, so this test exists purely to fail loudly,
  // right here, if a future mvdan/sh version renumbers them.
  it.each([
    ['a && b', 'and', { kind: 'and', side: 'right' }],
    ['a || b', 'or', { kind: 'or', side: 'right' }],
  ] as const)('%s classifies the right side as %s', (src, _label, expected) => {
    const [, right] = enumerate(src);
    const rightSite = assertDefined(right, 'unreachable — expected exactly 2 sites');
    expect(rightSite.context).toEqual([expected]);
  });

  it.each(['a | b', 'a |& b'])('%s classifies both sides as a single pipeline', (src) => {
    const sites = enumerate(src);
    expect(sites.map((s) => s.context)).toEqual([
      [{ kind: 'pipeline', stage: 0 }],
      [{ kind: 'pipeline', stage: 1 }],
    ]);
  });
});

describe('enumerateCommands — stack safety: long linear chains traverse iteratively', () => {
  // Both `|`/`|&` pipelines and `&&`/`||` chains left-nest in mvdan/sh's
  // tree (see `flattenPipelineStages`'s and `visitBinaryCmd`'s doc
  // comments), so a chain's length used to consume native call-stack depth
  // linearly — a long enough chain crashed with an uncatchable
  // `RangeError: Maximum call stack size exceeded`. Both are now traversed
  // with an explicit heap-allocated work structure instead of per-stage
  // recursion, so chain length alone never grows real stack depth. 5,000
  // is comfortably past where the old recursive implementation crashed
  // (empirically, well under 1,000) and past `MAX_STRUCTURAL_DEPTH` (500)
  // too — proving chain length is fully decoupled from the depth guard,
  // not just "large enough to not crash yet".
  it('a 5,000-stage pipeline enumerates every stage without a stack overflow', () => {
    const chain = syntheticBinaryChain(5000, 13 /* BIN_CMD_OP_PIPE */);
    const sites = enumerateCommands(chain);
    expect(sites).toHaveLength(5000);
    expect(sites[0]?.argv0).toEqual({ static: true, text: 'c0' });
    expect(sites[0]?.context).toEqual([{ kind: 'pipeline', stage: 0 }]);
    expect(sites[4999]?.argv0).toEqual({ static: true, text: 'c4999' });
    expect(sites[4999]?.context).toEqual([{ kind: 'pipeline', stage: 4999 }]);
  });

  it('a 5,000-link && chain enumerates every link without a stack overflow', () => {
    const chain = syntheticBinaryChain(5000, 11 /* BIN_CMD_OP_AND */);
    const sites = enumerateCommands(chain);
    expect(sites).toHaveLength(5000);
    // The leftmost operand of a left-nested &&-chain inherits the
    // surrounding (empty) context unchanged — only right-hand operands are
    // tagged 'and' — matching the existing 'a && b || c | d' test's
    // documented semantics for the analogous 2-stage case.
    expect(sites[0]?.context).toEqual([]);
    expect(sites[1]?.context).toEqual([{ kind: 'and', side: 'right' }]);
    expect(sites[4999]?.context).toEqual([{ kind: 'and', side: 'right' }]);
  });

  it('a long pipeline nested inside genuine (bounded) subshell nesting still enumerates fully, and the depth counter only reflects the real nesting, not the chain length', () => {
    // Guards against a design that accidentally grows the depth counter
    // per pipeline stage (which would make a long pipeline inside even
    // modest real nesting spuriously trip MAX_STRUCTURAL_DEPTH).
    let tree = syntheticBinaryChain(5000, 13 /* BIN_CMD_OP_PIPE */);
    for (let i = 0; i < 50; i += 1) {
      tree = syntheticNode('Stmt', { cmd: syntheticNode('Subshell', { stmts: [tree] }) });
    }
    const sites = enumerateCommands(tree);
    expect(sites).toHaveLength(5000);
    // 50 subshell frames + 1 pipeline-stage frame for the innermost site.
    expect(sites[0]?.context).toHaveLength(51);
  });
});

describe('enumerateCommands — stack safety: defensive depth guard for genuine nesting', () => {
  // Unlike linear chains, genuinely nested structure (Subshell-in-Subshell,
  // etc.) still recurses — this describes the defensive backstop for that
  // case: enumerateCommands must throw a typed, catchable
  // ShAnalyzeMaxDepthError rather than crash with an uncatchable
  // RangeError, and must not silently return a truncated/partial result.
  it('nesting exactly at MAX_STRUCTURAL_DEPTH (500) still enumerates successfully', () => {
    const sites = enumerateCommands(syntheticNestedSubshells(500));
    expect(sites).toHaveLength(1);
    expect(sites[0]?.context).toHaveLength(500);
    expect(sites[0]?.context.every((frame) => frame.kind === 'subshell')).toBe(true);
  });

  it('nesting one level past MAX_STRUCTURAL_DEPTH (501) throws ShAnalyzeMaxDepthError, not a raw stack overflow', () => {
    expect(() => enumerateCommands(syntheticNestedSubshells(501))).toThrow(ShAnalyzeMaxDepthError);
  });

  it('the thrown error carries the stable ESLINT_SH_ANALYZE_MAX_DEPTH code', () => {
    expect.assertions(2);
    try {
      enumerateCommands(syntheticNestedSubshells(501));
    } catch (error) {
      expect(error).toBeInstanceOf(ShAnalyzeMaxDepthError);
      expect((error as ShAnalyzeMaxDepthError).code).toBe('ESLINT_SH_ANALYZE_MAX_DEPTH');
    }
  });

  it('a shallow, realistic nesting depth (10 levels) is unaffected by the guard', () => {
    const sites = enumerateCommands(syntheticNestedSubshells(10));
    expect(sites).toHaveLength(1);
    expect(sites[0]?.context).toHaveLength(10);
  });
});
