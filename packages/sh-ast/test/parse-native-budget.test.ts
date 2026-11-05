/**
 * Public resource outcomes across shell grammar families and warm WASM reuse.
 * Every hostile family owns a bounded child process; a raw failure ends that
 * child without invoking a potentially damaged WASM instance again.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Built public exports exercise consumer-visible parsing, not a test-only parser. */
const entry = new URL('../dist/index.js', import.meta.url).href;

/** Real grammar examples from the resource-limit review, with shallow controls. */
const reviewedForms = [
  [
    '4475668956: closed conditional keeps queued heredoc',
    (n: number): string =>
      'echo $('.repeat(n) +
      "if true; then cat <<'EOF'; fi\n" +
      ')\n'.repeat(n) +
      'EOF\n' +
      'echo $('.repeat(n) +
      'echo ok' +
      ')'.repeat(n * 2),
    140,
  ],
  [
    '4475668987: compact let and-assignment',
    (n: number): string => 'let ' + 'a&='.repeat(n) + '1',
    2000,
  ],
  [
    '4475668987: compact let or-assignment',
    (n: number): string => 'let ' + 'a|='.repeat(n) + '1',
    2000,
  ],
  [
    '4475669019: long function header',
    (n: number): string => 'function f { '.repeat(n) + ':; ' + '}; '.repeat(n),
    400,
  ],
  [
    '4475669034: assignment-array element index',
    (n: number): string => 'a=([' + 'a['.repeat(n) + '1' + ']'.repeat(n) + ']=0)',
    1000,
  ],
  [
    '4475669060: spaced function parameters',
    (n: number): string => 'f( ) { '.repeat(n) + ':' + '; }'.repeat(n),
    400,
  ],
  [
    '4475669060: continued function parameters',
    (n: number): string => 'f(\\\n) { '.repeat(n) + ':' + '; }'.repeat(n),
    400,
  ],
  [
    '4475669095: mixed heredoc delimiter',
    (n: number): string =>
      "cat <<'EO'F\n" + 'echo $('.repeat(n) + 'echo ok' + ')'.repeat(n) + '\nEOF\n',
    400,
  ],
  [
    '4475669118: redirect operand is not a reserved word',
    (n: number): string => 'if >fi true; then '.repeat(n) + ':' + '; fi'.repeat(n),
    1500,
  ],
  [
    '4475669136: indexed assignment after another assignment',
    (n: number): string => 'x=1 a[' + 'a['.repeat(n) + '1' + ']'.repeat(n) + ']=0',
    1000,
  ],
  [
    '4475669157: anonymous coprocess',
    (n: number): string => 'coproc { '.repeat(n) + ':' + '; }'.repeat(n),
    400,
  ],
  [
    '4475669157: named coprocess',
    (n: number): string => 'coproc worker { '.repeat(n) + ':' + '; }'.repeat(n),
    400,
  ],
  [
    '4475669174: time option before compound command',
    (n: number): string => 'time -p if true; then '.repeat(n) + ':' + '; fi'.repeat(n),
    1500,
  ],
] as const;

/** Only serializable observations cross the isolation boundary. */
const childSource = `
  import { readFileSync } from 'node:fs';
  const lib = await import(${JSON.stringify(entry)});
  const spec = JSON.parse(readFileSync(0, 'utf8'));
  const observations = [];
  for (let i = 0; i < spec.repetitions; i++) {
    try {
      const result = lib[spec.operation](spec.bytes ? new TextEncoder().encode(spec.source) : spec.source,
        { KeepComments: true, RecoverErrors: spec.recoverErrors, ...spec.options });
      observations.push({ outcome: (result.File ?? result).Type });
    } catch (error) {
      const guarded = error instanceof lib.ShParseMaxDepthError;
      observations.push({ outcome: error.name, code: error.code, maxDepth: error.maxDepth,
        estimatedDepth: error.estimatedDepth, partialFile: 'partialFile' in error,
        subsequent: guarded ? lib.parseSync('echo still-usable').Type : undefined });
      if (!guarded) break;
    }
  }
  console.log(JSON.stringify(observations));
`;

/** Full public calls, rather than an estimator or split parser phase, define acceptance. */
function observe(
  source: string,
  operation = 'parseSync',
  repetitions = 2,
  recoverErrors = 0,
  bytes = false,
  options: Readonly<Record<string, unknown>> = {},
): unknown[] {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    input: JSON.stringify({ source, operation, repetitions, recoverErrors, bytes, options }),
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.signal, child.stderr).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  const result: unknown = JSON.parse(child.stdout.trim().split('\n').at(-1) ?? 'null');
  if (!Array.isArray(result)) throw new Error('isolated parse did not report observations');
  return result;
}

/** A terminal resource refusal has no partial tree and leaves later calls usable. */
const refused = {
  outcome: 'ShParseMaxDepthError',
  code: 'SH_AST_PARSE_MAX_DEPTH',
  maxDepth: 128,
  estimatedDepth: 129,
  partialFile: false,
  subsequent: 'File',
};

describe('native grammar resource budget', () => {
  // Left-associative operators build a deep tree without recursive grammar.
  // The exact issue #71 source must be refused before recursive serialization,
  // with no partial File, while smaller trees and subsequent calls stay usable.
  it.each(['parseSync', 'parseWithPositionsSync'])(
    '%s refuses the 20,000-operator serialization regression (issue #71)',
    (operation) => {
      const source = 'echo $(( ' + '1+'.repeat(20_000) + '1 ))';
      expect(observe(source, operation, 2, 100000)).toEqual([refused, refused]);
      expect(observe('echo $(( ' + '1+'.repeat(125) + '1 ))', operation)).toEqual([
        { outcome: 'File' },
        { outcome: 'File' },
      ]);
    },
    40_000,
  );

  it.each(reviewedForms)(
    '%s refuses deep input through both public operations',
    (_name, make, depth) => {
      for (const operation of ['parseSync', 'parseWithPositionsSync']) {
        const observations = observe(make(depth), operation, 2, 100000);
        expect(observations).toHaveLength(2);
        for (const result of observations) expect(result).toEqual(refused);
      }
    },
    40_000,
  );

  it.each(reviewedForms)(
    '%s accepts the same grammar at shallow depth',
    (_name, make) => {
      expect(observe(make(2))).toEqual([{ outcome: 'File' }, { outcome: 'File' }]);
    },
    20_000,
  );

  it.each([
    ['arithmetic parentheses', 'echo $(( ' + '('.repeat(2000) + '1' + ')'.repeat(2000) + ' ))'],
    ['arithmetic indices', 'echo $(( ' + 'a['.repeat(2000) + '1' + ']'.repeat(2000) + ' ))'],
    ['dense parentheses', '('.repeat(2000) + 'true' + ')'.repeat(2000)],
  ])(
    'repeated %s refusals remain safe after the WASM stack has grown',
    (_name, source) => {
      for (const operation of ['parseSync', 'parseWithPositionsSync']) {
        const observations = observe(source, operation, 20, 100000, true);
        expect(observations).toHaveLength(20);
        for (const result of observations) expect(result).toEqual(refused);
      }
    },
    40_000,
  );

  it.each([
    [
      'subshell statement work',
      (n: number): string => '(\n'.repeat(n) + ':' + ')\n'.repeat(n),
      127,
      128,
    ],
    [
      'statement and word work in substitutions',
      (n: number): string => 'echo $('.repeat(n) + 'echo ok' + ')'.repeat(n),
      63,
      64,
    ],
    [
      'iteratively constructed arithmetic tree',
      (n: number): string => 'echo $(( ' + '1+'.repeat(n) + '1 ))',
      125,
      126,
    ],
  ] as const)(
    '%s crosses the documented native budget',
    (_name, make, accepted, rejected) => {
      expect(observe(make(accepted))).toEqual([{ outcome: 'File' }, { outcome: 'File' }]);
      for (const result of observe(make(rejected))) expect(result).toEqual(refused);
    },
    20_000,
  );

  it.each([
    "if true; then cat <<'EOF'; fi\n" +
      'echo $('.repeat(400) +
      'echo ok' +
      ')'.repeat(400) +
      '\nEOF\n',
    "cat <<E'OF'\n" + 'echo $('.repeat(400) + 'echo ok' + ')'.repeat(400) + '\nEOF\n',
  ])(
    'preserves quoted literal heredoc bodies',
    (source) => {
      expect(observe(source, 'parseWithPositionsSync')).toEqual([
        { outcome: 'File' },
        { outcome: 'File' },
      ]);
    },
    20_000,
  );

  it('retains the unchanged nested-64 benchmark fixture', () => {
    const value: unknown = JSON.parse(
      readFileSync(
        new URL('../../../tools/benchmark/fixtures/nested-64.json', import.meta.url),
        'utf8',
      ),
    );
    if (
      typeof value !== 'object' ||
      value === null ||
      !('source' in value) ||
      typeof value.source !== 'string'
    ) {
      throw new Error('benchmark fixture must contain source');
    }
    expect(observe(value.source, 'parseWithPositionsSync')).toEqual([
      { outcome: 'File' },
      { outcome: 'File' },
    ]);
  }, 20_000);

  it('reports invalid native options before parsing an otherwise over-budget source', () => {
    const source = 'echo $('.repeat(400) + 'echo ok' + ')'.repeat(400);
    expect(observe(source, 'parseSync', 1, 0, false, { Variant: 999 })).toMatchObject([
      { outcome: 'InputError' },
    ]);
  }, 20_000);

  it('the retained legacy ABI also returns error-only refusals and remains reusable', () => {
    const script = `
      import { readFileSync } from 'node:fs';
      import ${JSON.stringify(new URL('../shim/wasm_exec.js', import.meta.url).href)};
      const go = new globalThis.Go();
      const wasm = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(
        new URL(${JSON.stringify(new URL('../shim/sh-ast.wasm', import.meta.url).href)})
      )), go.importObject);
      void go.run(wasm);
      function parse(source) {
        const allocations = [];
        function write(text) {
          const bytes = new TextEncoder().encode(text);
          const pointer = wasm.exports.alloc(bytes.length) >>> 0;
          allocations.push(pointer);
          new Uint8Array(wasm.exports.mem.buffer, pointer, bytes.length).set(bytes);
          return [pointer, bytes.length];
        }
        const text = write(source), dialect = write('bash'), filename = write('legacy.sh');
        const pointer = wasm.exports.process(...text, ...dialect, ...filename) >>> 0;
        allocations.push(pointer);
        const memory = new Uint8Array(wasm.exports.mem.buffer);
        const end = memory.indexOf(0, pointer);
        if (end < pointer) throw new Error('unterminated legacy response');
        const result = JSON.parse(new TextDecoder().decode(memory.subarray(pointer, end)));
        for (const pointer of allocations) wasm.exports.free(pointer);
        return result;
      }
      const source = 'echo $(( ' + 'a['.repeat(2000) + '1' + ']'.repeat(2000) + ' ))';
      const observations = [];
      for (let i = 0; i < 20; i++) {
        try {
          const result = parse(source);
          observations.push({ keys: Object.keys(result), message: result.error?.message,
            reused: Boolean(parse('echo alive').file) });
        } catch (error) {
          observations.push({ error: error.name });
          break;
        }
      }
      console.log(JSON.stringify(observations));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.signal, child.stderr).toBeNull();
    expect(child.status, child.stderr).toBe(0);
    const observations: unknown = JSON.parse(child.stdout.trim());
    expect(observations).toEqual(
      Array.from({ length: 20 }, () => ({
        keys: ['error'],
        message: 'parse resource limit: native node nesting work (129 units) exceeds 128',
        reused: true,
      })),
    );
  }, 20_000);
});
