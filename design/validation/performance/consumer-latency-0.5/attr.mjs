// Stage attribution for eslint-sh lint latency. Run from packages/eslint-plugin after build.
import { Linter } from 'eslint';
import plugin from './dist/index.js';
import { parseWithPositionsSync, parseSync, LangBash } from 'sh-ast';
import { adaptSyntaxFile } from './dist/language/syntax-view.js';
import { SourceCoordinates } from './dist/language/source-coordinates.js';
import { ShellSourceCode } from './dist/language/shell-source-code.js';
const big = Array.from(
  { length: 100 },
  (_, i) =>
    `f${i}() {\n  local x="v${i} 🎉"\n  if [ -n "$x" ]; then\n    echo "$x" | tr a-z A-Z\n  fi\n}\ncase "$1" in a) f${i};; esac\n`,
).join('');
const N = 30,
  W = 5;
function bench(name, fn) {
  for (let i = 0; i < W; i++) fn();
  const xs = [];
  for (let i = 0; i < N; i++) {
    const s = performance.now();
    fn();
    xs.push(performance.now() - s);
  }
  xs.sort((a, b) => a - b);
  return {
    name,
    median: +xs[N >> 1].toFixed(2),
    min: +xs[0].toFixed(2),
    p90: +xs[Math.floor(N * 0.9)].toFixed(2),
  };
}
const opts = { Variant: LangBash, Filename: 'a.sh', KeepComments: true };
const parsed = parseWithPositionsSync(big, opts);
const ast = adaptSyntaxFile(parsed.File, big, parsed.Positions);
let count = 0;
(function w(n) {
  count++;
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (Array.isArray(v)) v.forEach((c) => c && c.type && w(c));
    else if (v && typeof v === 'object' && v.type && v.range) w(v);
  }
})(ast);
const linter = new Linter();
const cfg = [{ files: ['**/*.sh'], plugins: { sh: plugin }, language: 'sh/sh', rules: {} }];
const rows = [
  bench('parseSync (no positions)', () => parseSync(big, opts)),
  bench('parseWithPositionsSync', () => parseWithPositionsSync(big, opts)),
  bench('SourceCoordinates ctor', () => new SourceCoordinates(big)),
  bench('adaptSyntaxFile (incl. SourceCoordinates)', () =>
    adaptSyntaxFile(parsed.File, big, parsed.Positions),
  ),
  bench('ShellSourceCode ctor + traverse', () => {
    const sc = new ShellSourceCode({ text: big, ast });
    for (const _ of sc.traverse());
  }),
  bench('plugin.languages.sh.parse (parse+adapt)', () =>
    plugin.languages.sh.parse(
      { body: big, path: 'a.sh' },
      { languageOptions: { dialect: 'bash' } },
    ),
  ),
  bench('Linter.verify (total)', () => linter.verify(big, cfg, { filename: 'a.sh' })),
];
console.log(
  JSON.stringify({
    bytes: Buffer.byteLength(big),
    lines: big.split('\n').length,
    viewNodes: count,
  }),
);
console.table(rows);
