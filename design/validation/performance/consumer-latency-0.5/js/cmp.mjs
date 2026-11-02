// Apples-to-apples parser comparison: sh-ast 0.3.1 parseSync vs 0.5.0 parseSync / parseWithPositionsSync.
import * as v3 from 'sh-ast-03';
import * as v5 from 'sh-ast-05';
import path from 'node:path';
const w3 = await import(path.resolve('node_modules/sh-ast-03/dist/wasm-instance.js'));
const w5 = await import(path.resolve('node_modules/sh-ast-05/dist/wasm-instance.js'));
const wire5 = await import(path.resolve('node_modules/sh-ast-05/dist/syntax-wire.js'));
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
const o5 = { Variant: v5.LangBash, Filename: 'a.sh', KeepComments: true };
const o5w = wire5.encodeWire(o5);
const b5 = new TextEncoder().encode(big);
const raw3 = w3.callParse(big, 'bash', 'a.sh');
const order = process.argv[2] === 'rev';
const cases = [
  () => bench('0.3.1 callParse (WASM only)', () => w3.callParse(big, 'bash', 'a.sh')),
  () =>
    bench('0.3.1 parseSync (total)', () =>
      v3.parseSync(big, { dialect: 'bash', filename: 'a.sh' }),
    ),
  () => bench('0.5.0 callSyntax parse (WASM only)', () => w5.callSyntax('parse', b5, o5w)),
  () => bench('0.5.0 parseSync (total)', () => v5.parseSync(big, o5)),
  () =>
    bench('0.5.0 callSyntax parse-with-positions (WASM only)', () =>
      w5.callSyntax('parse-with-positions', b5, o5w),
    ),
  () => bench('0.5.0 parseWithPositionsSync (total)', () => v5.parseWithPositionsSync(big, o5)),
];
const rows = (order ? cases.reverse() : cases).map((f) => f());
console.log(JSON.stringify({ v03ResponseBytes: raw3.length }));
console.table(rows);
