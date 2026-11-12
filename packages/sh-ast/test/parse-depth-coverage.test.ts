/**
 * Resource-limit regressions for sh-ast#68. Expectations describe the public
 * refusal contract, independently of native counter implementation. Each hostile
 * input gets a fresh subprocess: a regression must not reuse a crashed WASM
 * instance or prevent unrelated tests from finishing.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { Add, Eql, Pipe } from '../src/index.js';
import {
  expectFlatTree,
  expectSameNestingBoundary,
  inArithmeticParens,
  inSubshells,
  inspectIsolated,
  repeated,
} from './isolated-tree.js';

/** The built public entry exercises the same parse boundary consumers use. */
const entry = new URL('../dist/index.js', import.meta.url).href;

/** Known recursive grammar forms, numbered to match the issue's reproductions. */
const depthCases = [
  [
    '1: length expansion before command substitutions',
    'echo ${#x}' + '$('.repeat(400) + 'x' + ')'.repeat(400),
  ],
  [
    '2: parameter expansions in double quotes',
    'echo "' + '${a:-'.repeat(1000) + 'x' + '}'.repeat(1000) + '"',
  ],
  [
    '3: parameter expansions in heredoc',
    'cat <<EOF\n' + '${a:-'.repeat(1000) + 'x' + '}'.repeat(1000) + '\nEOF\n',
  ],
  [
    '4: recursive arithmetic subscripts',
    'echo $(( ' + 'a['.repeat(1000) + '1' + ']'.repeat(1000) + ' ))',
  ],
  ['5: right-associative powers', 'echo $(( ' + '2**'.repeat(2000) + '2 ))'],
  ['6: right-associative assignments', 'echo $(( ' + 'a='.repeat(2000) + '1 ))'],
  ['7: nested ternaries', 'echo $(( ' + 'a?1:'.repeat(2000) + '1 ))'],
  ['8a: parameter slice arithmetic', 'echo ${x:' + 'a?1:'.repeat(2000) + '1}'],
  ['8b: legacy bracket arithmetic', 'echo $[ ' + 'a='.repeat(2000) + '1 ]'],
  ['8c: let arithmetic', 'let ' + 'a='.repeat(2000) + '1'],
  ['8d: arithmetic continuing across newlines', 'echo $(( ' + 'a=\n'.repeat(2000) + '1 ))'],
  ['unary: recursive arithmetic negation', 'echo $(( ' + '!'.repeat(20000) + '1 ))'],
  ['unary: separated arithmetic prefixes', 'echo $(( ' + '+ '.repeat(20000) + '1 ))'],
  [
    'parameter default hash is literal before nested substitutions',
    'echo ${x:- # literal ' + '$('.repeat(400) + 'x' + ')'.repeat(400) + '}',
  ],
] as const;

/** These are ordinary command arguments; none owns a surrounding grammar region. */
const literalKeywordCases = [
  'fi',
  'done',
  'esac',
  'then fi',
  'else done',
  'elif fi',
  'in done',
  'do fi',
  '}',
].map((word) => [
  `ordinary argument ${word}`,
  `echo $(echo ${word}; `.repeat(400) + 'echo ok' + ')'.repeat(400),
]);

/** Quote syntax changes a word's spelling, not whether it occupies command position. */
const quotedCommandCases = [
  '"echo" fi',
  "'echo' done",
  'e\\cho fi',
  'echo "fi"',
  'echo x=done',
].map((command) => [
  `command/argument quoting ${command}`,
  `echo $(${command}; `.repeat(400) + 'echo ok' + ')'.repeat(400),
]);

/** Reports only serializable outcome facts; never calls WASM after a raw failure. */
const childSource = `
  import { readFileSync } from 'node:fs';
  const lib = await import(${JSON.stringify(entry)});
  const { source, operation, bytes, keepComments } = JSON.parse(readFileSync(0, 'utf8'));
  try {
    const result = lib[operation](bytes ? new TextEncoder().encode(source) : source, {
      Variant: lib.LangBash, KeepComments: keepComments,
    });
    const file = result.File ?? result;
    const pending = [file]; const seen = new Set(); const comments = [];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      if (value.Type === 'Comment') comments.push(value);
      pending.push(...Object.values(value));
    }
    comments.sort((a, b) => a.Hash.Offset - b.Hash.Offset);
    const first = comments[0]; const last = comments.at(-1);
    console.log(JSON.stringify({ outcome: 'parsed', type: file.Type, statements: file.Stmts?.length ?? 0,
      comments: comments.length, firstHash: first?.Hash, lastHash: last?.Hash,
      firstSnapshot: first && result.Positions?.get(first)?.Pos,
      lastSnapshot: last && result.Positions?.get(last)?.Pos }));
  } catch (error) {
    const guarded = error instanceof lib.ShParseMaxDepthError;
    let subsequent;
    if (guarded) subsequent = lib.parseSync('echo still-usable').Type;
    console.log(JSON.stringify({ outcome: 'error', name: error.name, code: error.code,
      message: error.message, subsequent }));
  }
`;

/** Each child has a hard deadline, bounded output, and no shared parser state. */
function parseIsolated(
  source: string,
  operation: string,
  bytes = false,
  keepComments = true,
): unknown {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    input: JSON.stringify({ source, operation, bytes, keepComments }),
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.signal, child.stderr).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout.trim().split('\n').at(-1) ?? 'null');
}

describe('recursive input refusal (issue #68)', () => {
  // mvdan's heredoc quote removal uses raw quoted Value bytes, even for ANSI
  // quoting. These terminators deliberately preserve escapes rather than
  // substituting Bash runtime ANSI decoding for the pinned parser's behavior.
  it.each([
    ["$'E\\x4fF'", 'E\\x4fF'],
    ["$'E\\'OF'", "E\\'OF"],
    ['$"E\\"OF"', 'E\\"OF'],
  ])(
    'escaped delimiter %s ends before later nested code',
    (delimiter, terminator) => {
      const source =
        `cat <<${delimiter}\nx\n${terminator}\n` +
        'echo $('.repeat(400) +
        'echo ok' +
        ')'.repeat(400);
      expect(parseIsolated(source, 'parseSync')).toMatchObject({
        outcome: 'error',
        code: 'SH_AST_PARSE_MAX_DEPTH',
        subsequent: 'File',
      });
    },
    20_000,
  );

  it.each(["$'EOF'", '$"EOF"', "E'OF'"])(
    '%s keeps its quoted body literal and resumes the next command',
    (delimiter) => {
      const source =
        `cat <<${delimiter}\n` +
        '$('.repeat(400) +
        'literal' +
        ')'.repeat(400) +
        '\nEOF\necho done\n';
      expect(parseIsolated(source, 'parseWithPositionsSync')).toMatchObject({
        outcome: 'parsed',
        type: 'File',
        statements: 2,
      });
    },
    20_000,
  );
  it.each(depthCases)(
    '%s receives a native resource refusal',
    (_name, source) => {
      expect(parseIsolated(source, 'parseWithPositionsSync')).toMatchObject({
        outcome: 'error',
        name: 'ShParseMaxDepthError',
        code: 'SH_AST_PARSE_MAX_DEPTH',
        subsequent: 'File',
      });
    },
    20_000,
  );

  it.each([...literalKeywordCases, ...quotedCommandCases])(
    '%s cannot close a substitution region',
    (_name, source) => {
      expect(parseIsolated(source, 'parseSync')).toMatchObject({
        outcome: 'error',
        code: 'SH_AST_PARSE_MAX_DEPTH',
        subsequent: 'File',
      });
    },
    20_000,
  );

  it('ordinary esac arguments cannot close nested case regions', () => {
    const source = 'case x in a) echo esac; '.repeat(1_000) + ':' + ';; esac'.repeat(1_000);
    expect(parseIsolated(source, 'parseWithPositionsSync')).toMatchObject({
      outcome: 'error',
      code: 'SH_AST_PARSE_MAX_DEPTH',
      subsequent: 'File',
    });
  }, 20_000);

  it.each(["$'EOF'", '$"EOF"'])(
    '%s heredoc delimiter ends before later nested code',
    (delimiter) => {
      const source =
        `cat <<${delimiter}\nx\nEOF\n` + 'echo $('.repeat(400) + 'echo ok' + ')'.repeat(400);
      expect(parseIsolated(source, 'parseSync')).toMatchObject({
        outcome: 'error',
        code: 'SH_AST_PARSE_MAX_DEPTH',
        subsequent: 'File',
      });
    },
    20_000,
  );

  it('the plain parse entry also refuses the length-expansion bypass', () => {
    expect(parseIsolated(depthCases[0][1], 'parseSync')).toMatchObject({
      outcome: 'error',
      code: 'SH_AST_PARSE_MAX_DEPTH',
      subsequent: 'File',
    });
  }, 20_000);

  it('byte input gets the same refusal as Unicode text', () => {
    expect(parseIsolated(depthCases[0][1], 'parseWithPositionsSync', true)).toMatchObject({
      outcome: 'error',
      code: 'SH_AST_PARSE_MAX_DEPTH',
      subsequent: 'File',
    });
  }, 20_000);

  it('10: a long comment run preserves every comment and its byte position', () => {
    expect(parseIsolated('# comment\n'.repeat(50_000), 'parseWithPositionsSync')).toMatchObject({
      outcome: 'parsed',
      type: 'File',
      comments: 50_000,
      firstHash: { Offset: 0, Line: 1, Col: 1 },
      lastHash: { Offset: 499_990, Line: 50_000, Col: 1 },
      firstSnapshot: { Offset: 0, Line: 1, Col: 1 },
      lastSnapshot: { Offset: 499_990, Line: 50_000, Col: 1 },
    });
  }, 20_000);
});

describe('flat comment runs remain ordinary source', () => {
  it.each([
    ['line-leading comments', '# comment\n'.repeat(10_001)],
    ['blank lines and CRLF do not break recursion', ' \t# comment\r\n \t\r\n'.repeat(10_001)],
    [
      'a trailing comment begins the same recursive run',
      'echo x # trailing\n' + '# next\n'.repeat(10_000),
    ],
  ])(
    '%s preserves the complete comment run',
    (_name, source) => {
      expect(parseIsolated(source, 'parseWithPositionsSync')).toMatchObject({
        outcome: 'parsed',
        type: 'File',
        comments: 10_001,
      });
    },
    20_000,
  );

  it('discarding comments also supports long runs', () => {
    expect(parseIsolated('# comment\n'.repeat(50_000), 'parseSync', false, false)).toMatchObject({
      outcome: 'parsed',
      type: 'File',
      comments: 0,
    });
  }, 20_000);

  it.each([
    ['ten thousand comments', '# comment\n'.repeat(10_000)],
    ['statements break comment runs', ('# comment\n'.repeat(7_500) + ':\n').repeat(3)],
    ['comment-looking quoted data', "echo '" + '# data\n'.repeat(50_000) + "'"],
    ['comment-looking heredoc data', 'cat <<EOF\n' + '# data\n'.repeat(50_000) + 'EOF\n'],
  ])(
    '%s remains accepted',
    (_name, source) => {
      expect(parseIsolated(source, 'parseWithPositionsSync')).toMatchObject({
        outcome: 'parsed',
        type: 'File',
      });
    },
    20_000,
  );
});

describe('smaller grammar controls', () => {
  it.each([
    ['ordinary if arguments', 'echo if\n'.repeat(200)],
    ['ordinary case arguments', 'echo case\n'.repeat(200)],
    ['ordinary loop arguments', 'echo while\n'.repeat(200)],
    ['ordinary then/let arguments', 'echo then let ' + 'a='.repeat(2_000) + '1'],
    ['actual conditional and loop closers', 'if true; then for i in a; do :; done; else :; fi\n'],
    [
      'actual closers inside substitutions',
      'echo $(if true; then :; else :; fi) $(for i in a; do :; done)\n',
    ],
    ['brace closer argument inside a brace group', '{ echo }; echo still; }\n'],
    [
      'quoted command words before ordinary keywords',
      '"echo" fi done esac then else elif in do }\n',
    ],
    ['escaped keyword command and assignment words', '\\fi x=done then=else\n'],
    ['ANSI quoted heredoc delimiter', "cat <<$'EOF'\nx\nEOF\necho done\n"],
    ['locale quoted heredoc delimiter', 'cat <<$"EOF"\nx\nEOF\necho done\n'],
    ['parameter default punctuation is literal', 'echo ${x:-' + 'a?b='.repeat(200) + '}'],
    ['independent let arguments', 'let ' + 'a=1 '.repeat(200)],
    ['quoted let arguments are words', "let '" + 'a='.repeat(200) + "1'"],
    ['let in ordinary argument position', 'echo let ' + 'a='.repeat(200) + '1'],
    [
      'quoted heredoc expansion text is literal',
      "cat <<'EOF'\n" + '${a:-'.repeat(200) + 'x' + '}'.repeat(200) + '\nEOF\n',
    ],
    ['ordinary argument brackets are literal', 'echo ' + 'x['.repeat(200)],
    [
      '100 quoted parameter expansions',
      'echo "' + '${a:-'.repeat(100) + 'x' + '}'.repeat(100) + '"',
    ],
    [
      '100 heredoc parameter expansions',
      'cat <<EOF\n' + '${a:-'.repeat(100) + 'x' + '}'.repeat(100) + '\nEOF\n',
    ],
    ['100 arithmetic subscripts', 'echo $(( ' + 'a['.repeat(100) + '1' + ']'.repeat(100) + ' ))'],
    ['100 powers', 'echo $(( ' + '2**'.repeat(100) + '2 ))'],
    ['100 assignments', 'echo $(( ' + 'a='.repeat(100) + '1 ))'],
    ['100 ternaries', 'echo $(( ' + 'a?1:'.repeat(100) + '1 ))'],
    ['100 let assignments', 'let ' + 'a='.repeat(100) + '1'],
    ['100 arithmetic assignments across newlines', 'echo $(( ' + 'a=\n'.repeat(100) + '1 ))'],
    [
      '100 action pipelines after optional case paren',
      'case x in (a) ' + 'a|'.repeat(100) + 'a;; esac',
    ],
    ['100 unary negations', 'echo $(( ' + '!'.repeat(100) + '1 ))'],
    ['many case pattern alternatives', 'case x in (' + 'a|'.repeat(500) + 'z) :;; esac'],
  ])(
    '%s remains accepted',
    (_name, source) => {
      expect(parseIsolated(source, 'parseWithPositionsSync')).toMatchObject({
        outcome: 'parsed',
        type: 'File',
      });
    },
    20_000,
  );
});

/** Valid historical controls whose native work exceeds the binding's 128-unit policy. */
describe('valid grammar exceeding native nesting work', () => {
  it.each([
    [
      'length expansion and 100 command substitutions',
      'echo ${#x}' + '$('.repeat(100) + 'x' + ')'.repeat(100),
    ],
  ])(
    '%s is refused without invalidating the shared runtime',
    (_name, source) => {
      expect(parseIsolated(source, 'parseWithPositionsSync')).toMatchObject({
        outcome: 'error',
        code: 'SH_AST_PARSE_MAX_DEPTH',
        subsequent: 'File',
      });
    },
    20_000,
  );
});

/** Row 9's pipeline after a parenthesized case pattern, with `links` pipe operators. */
function casePipeline(links: number): string {
  return 'case x in (a) ' + 'a|'.repeat(links) + 'a;; esac';
}

// Flat sequences are not nesting (sh-ast#105). Row 9 and two arithmetic controls
// are long left-associative chains with nothing opened inside anything else, so
// they parse, walk and print; they are pushed far past the length that used to
// overflow. A genuinely nested sibling of each is still refused at 128 units.
describe('flat sequences among the recursive-input forms (issue #105)', () => {
  it.each(['parseSync', 'parseWithPositionsSync'] as const)(
    '9: a 10,000-link pipeline after a parenthesized case pattern parses through %s',
    (operation) => {
      expectFlatTree(inspectIsolated(casePipeline(10_000), { operation }), {
        commands: 10_001,
        cmdOperators: repeated(Pipe, 10_000),
      });
    },
    120_000,
  );

  it('9: subshells around the case are refused at the same depth however long the pipeline is', () => {
    expectSameNestingBoundary(inSubshells, casePipeline(1), casePipeline(10_000));
  }, 600_000);

  it.each([
    ['arithmetic keyword identifiers', 'if+', 200, Add],
    ['comparison operators, which are not assignment chains', 'a==', 500, Eql],
  ] as const)(
    '%s form a flat chain that parses, walks and prints',
    (_name, link, links, operator) => {
      const chain = link.repeat(links) + '1';
      expectFlatTree(
        inspectIsolated('echo $(( ' + chain + ' ))', { operation: 'parseWithPositionsSync' }),
        { commands: 1, arithOperators: repeated(operator, links) },
      );
      expectSameNestingBoundary(inArithmeticParens, link + '1', chain);
    },
    600_000,
  );
});
