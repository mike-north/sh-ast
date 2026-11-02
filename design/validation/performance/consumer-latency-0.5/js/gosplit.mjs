// Go-side phase split using a locally built, instrumented copy of the 0.5.0 shim.
import path from 'node:path';
const pkg = process.argv[2] ?? 'sh-ast-instr';
const w = await import(path.resolve(`node_modules/${pkg}/dist/wasm-instance.js`));
const wire = await import(path.resolve(`node_modules/${pkg}/dist/syntax-wire.js`));
const sh = await import(path.resolve(`node_modules/${pkg}/dist/index.js`));
const big = Array.from(
  { length: 100 },
  (_, i) =>
    `f${i}() {\n  local x="v${i} 🎉"\n  if [ -n "$x" ]; then\n    echo "$x" | tr a-z A-Z\n  fi\n}\ncase "$1" in a) f${i};; esac\n`,
).join('');
const b = new TextEncoder().encode(big);
const o = wire.encodeWire({ Variant: sh.LangBash, Filename: 'a.sh', KeepComments: true });
const med = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
for (const op of ['parse', 'parse-with-positions']) {
  const acc = {};
  const wall = [];
  for (let i = 0; i < 35; i++) {
    const s = performance.now();
    w.callSyntax(op, b, o);
    const e = performance.now() - s;
    if (i < 5) continue;
    wall.push(e);
    if (pkg === 'sh-ast-instr') {
      const t = JSON.parse(w.callSyntax('timings', new Uint8Array(), '{}')).T;
      for (const [k, v] of Object.entries(t)) (acc[k] ??= []).push(v);
    }
  }
  const out = { op, callSyntaxWallMs: +med(wall).toFixed(2) };
  for (const [k, v] of Object.entries(acc))
    out[k.replace('_us', '_ms')] = k.endsWith('_us') ? +(med(v) / 1000).toFixed(2) : med(v);
  console.log(JSON.stringify(out));
}
