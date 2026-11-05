/**
 * Public-output identity between two built sh-ast packages. Each package runs in
 * its own fresh process over the same corpus, and the supported observable representation of
 * parseSync and parseWithPositionsSync is serialized canonically: record member
 * order, value types, byte strings, typed nils, frozenness, every snapshot
 * observation, and thrown error classes, messages and fields. An exact accepted
 * main build is the integration ground truth; a published release can provide
 * historical comparison where parser semantics match. The serializations must
 * be identical, not merely similar. Dedicated tests cover alias identity,
 * descriptors, mutation, and malformed caller graphs outside this corpus.
 *
 *   node tools/benchmark/identity.mjs --baseline <dist/index.js> --candidate <dist/index.js>
 *   node tools/benchmark/identity.mjs --prepared artifacts.json [--baseline-label 0.7.0]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Sources beyond the benchmark fixtures, chosen to exercise each boundary the
 * transport must preserve: Unicode and escaping, invalid UTF-8 and byte
 * filenames, comments, heredocs, CRLF, recovery sentinels, parse and language
 * errors with partial Files, StopAt, and every dialect.
 */
const EDGE_SOURCES = [
  '',
  "# 🎉 中 e\u0301 \u2028\u2029\necho \"<>&\" '\\x' $'\\t'\n",
  "cat <<EOF\n你好 🎉 $x\nEOF\ncat <<-'Q'\n\tquoted\n\tQ\n",
  'echo a\r\necho b\r\n',
  // Retain the accepted parser's sentinel and resource-policy behavior while
  // comparing transport: the previous published parser predates these fixes.
  'echo a\u0080b\neval "$x"\necho \u0081done\n',
  "cat <<'EOF'\n" + 'a'.repeat(1010) + '\u0080é\u0081🎉\nEOF\necho done\n',
  '(\n'.repeat(127) + ':\n' + ')\n'.repeat(127),
  '(\n'.repeat(128) + ':\n' + ')\n'.repeat(128),
  'echo $('.repeat(63) + 'echo ok' + ')'.repeat(63),
  'echo $('.repeat(64) + 'echo ok' + ')'.repeat(64),
  'echo $(( ' + 'a['.repeat(400) + '1' + ']'.repeat(400) + ' ))',
  '# flat comment\n'.repeat(10001) + 'echo done\n',

  'f() { local -a xs=(1 "two" [3]=x); echo "${xs[@]:1:2}" "${x/a/b}" "${#x}" "${x,,}"; }\n',
  'for ((i = 0; i < 3; i++)); do let "j = i * 2"; echo $((j + 1)); done\n',
  '[[ -n $x && $y =~ ^a.*$ ]] || { echo no; exit 1; } # trailing\n',
  'case $1 in a|b) echo ab ;; *) echo other ;& esac\n',
  'coproc cat; time -p sleep 1 | tee >(wc -l) <(echo in) 2>&1 >/dev/null\n',
  'echo {a,b}{1..3} @(x|y) !(z)\n',
  'while read -r line; do echo "$line"; done < file; until false; do break; done\n',
  'declare -A m=([k]=v); export X=1 Y; readonly Z; select x in a b; do :; done\n',
  'echo )',
  'if true; then',
  '(foo |',
  '$(( 1 +',
  'echo "unterminated',
];

/**
 * Options exercised for each source. A variant name is resolved against each
 * package's exported constants; the last two sets are rejected by the bridge.
 */
const OPTION_SETS = [
  { variant: 'LangBash', KeepComments: true, Filename: 'identity.sh' },
  { variant: 'LangBash' },
  { variant: 'LangPOSIX', KeepComments: true },
  { variant: 'LangMirBSDKorn', KeepComments: true },
  { variant: 'LangBats', KeepComments: true },
  { variant: 'LangZsh', KeepComments: true },
  { variant: 'LangBash', RecoverErrors: 2, KeepComments: true },
  { variant: 'LangBash', StopAt: '$$' },
  { variant: 'LangBash', Filename: new Uint8Array([0x61, 0xff]) },
  { Variant: 999 },
  { variant: 'LangBash', StopAt: 'a b' },
];

/** The corpus: every benchmark fixture plus the edge sources, as strings and bytes. */
function corpus() {
  const fixtures = readdirSync(join(here, 'fixtures'))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8')).source);
  const sources = [...fixtures, ...EDGE_SOURCES];
  const bytes = [
    new Uint8Array([0x65, 0x63, 0x68, 0x6f, 0x20, 0xff, 0xfe, 0x0a]),
    new TextEncoder().encode('echo ok\n# \u00e9\n'),
  ];
  return [...sources, ...bytes];
}

/**
 * Canonical text for any value reachable from a public result. Records keep
 * their own member order; Uint8Array, frozenness and prototypes are explicit,
 * so differences in these represented observations cannot hide behind JSON coercion.
 */
export function describe(value, seen = new Set()) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return `${typeof value}:${String(value)}`;
  if (typeof value === 'function') return 'function';
  if (value instanceof Uint8Array) return `bytes:[${Array.from(value).join(',')}]`;
  assert(!seen.has(value), 'public results must be acyclic');
  seen.add(value);
  try {
    const frozen = Object.isFrozen(value) ? 'frozen:' : '';
    if (Array.isArray(value))
      return `${frozen}[${value.map((item) => describe(item, seen)).join(',')}]`;
    const proto = Object.getPrototypeOf(value);
    const kind = proto === Object.prototype ? '' : `${proto?.constructor?.name ?? 'null'}:`;
    const members = Object.keys(value).map(
      (key) => `${JSON.stringify(key)}:${describe(value[key], seen)}`,
    );
    return `${frozen}${kind}{${members.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/** A thrown value's class, message and enumerable fields, including partial Files. */
function describeError(error) {
  return `throws:${error?.constructor?.name}:${describe(error?.message)}:${describe({ ...error })}`;
}

/** Every stored Node in record order, as the benchmark adapter enumerates them. */
function storedNodes(api, file) {
  const nodes = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object' || value instanceof Uint8Array) return;
    if (api.SYNTAX_INTERFACES.Node.includes(value.Type)) nodes.push(value);
    for (const child of Object.values(value))
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
  };
  visit(file);
  return nodes;
}

/** Runs the corpus against one package and returns one canonical line per case. */
async function observe(entry) {
  const api = await import(pathToFileURL(entry).href);
  const lines = [];
  for (const [sourceIndex, source] of corpus().entries())
    for (const [optionIndex, { variant, ...rest }] of OPTION_SETS.entries()) {
      const options = variant === undefined ? rest : { ...rest, Variant: api[variant] };
      let parsed;
      try {
        parsed = describe(api.parseSync(source, options));
      } catch (error) {
        parsed = describeError(error);
      }
      let positioned;
      try {
        const result = api.parseWithPositionsSync(source, options);
        const observations = storedNodes(api, result.File).map((node) => {
          try {
            return describe(result.Positions.get(node));
          } catch (error) {
            return describeError(error);
          }
        });
        positioned = `${describe(result)}|${observations.join(';')}|copy:${describe(result.Positions.get({ ...result.File }))}`;
      } catch (error) {
        positioned = describeError(error);
      }
      lines.push(JSON.stringify({ sourceIndex, optionIndex, parsed, positioned }));
    }
  return lines;
}

/** Runs observe in a fresh process so packages never share a runtime or module state. */
function observeInProcess(entry) {
  return execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', entry], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
    .trimEnd()
    .split('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values } = parseArgs({
    options: {
      worker: { type: 'string' },
      baseline: { type: 'string' },
      candidate: { type: 'string' },
      prepared: { type: 'string' },
      'baseline-label': { type: 'string', default: '0.7.0' },
      'candidate-label': { type: 'string', default: 'local-candidate' },
    },
  });
  if (values.worker) {
    for (const line of await observe(values.worker)) console.log(line);
  } else {
    let { baseline, candidate } = values;
    if (values.prepared) {
      const { artifacts } = JSON.parse(readFileSync(resolve(values.prepared), 'utf8'));
      const find = (label) => artifacts.find((artifact) => artifact.label === label)?.entry;
      baseline = find(values['baseline-label']);
      candidate = find(values['candidate-label']);
    }
    assert(baseline && candidate, 'baseline and candidate entries are required');
    const expected = observeInProcess(resolve(baseline));
    const actual = observeInProcess(resolve(candidate));
    assert.equal(actual.length, expected.length, 'both packages must observe the whole corpus');
    const mismatches = actual.filter((line, index) => line !== expected[index]);
    const digest = (lines) => createHash('sha256').update(lines.join('\n')).digest('hex');
    console.log(
      JSON.stringify({
        cases: actual.length,
        mismatches: mismatches.length,
        baselineSha256: digest(expected),
        candidateSha256: digest(actual),
      }),
    );
    for (const line of mismatches.slice(0, 5)) console.error(line.slice(0, 2000));
    if (mismatches.length) process.exitCode = 1;
  }
}
