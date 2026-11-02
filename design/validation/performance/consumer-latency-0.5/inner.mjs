// Attribute parseWithPositionsSync internals (sh-ast 0.5.0 dist). Run from packages/eslint-plugin.
import { createRequire } from 'node:module';
import path from 'node:path';
import { LangBash, parseWithPositionsSync } from 'sh-ast';
const root = path.resolve('node_modules/sh-ast/dist');
const wire = await import(path.join(root, 'syntax-wire.js'));
const wasm = await import(path.join(root, 'wasm-instance.js'));
const snap = await import(path.join(root, 'syntax-snapshot.js'));
const guard = await import(path.join(root, 'parse-depth-guard.js'));
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
const optsWire = wire.encodeWire(opts);
const bytes = new TextEncoder().encode(big);
const respPos = wasm.callSyntax('parse-with-positions', bytes, optsWire);
const respPlain = wasm.callSyntax('parse', bytes, optsWire);
const parsedJson = JSON.parse(respPos);
const decoded = wire.decodeWire(respPos);
console.log(
  JSON.stringify({
    responseBytesWithPositions: respPos.length,
    responseBytesPlain: respPlain.length,
    positionEntries: decoded.Positions.length,
    posJsonBytes: JSON.stringify(parsedJson.Positions).length,
    fileJsonBytes: JSON.stringify(parsedJson.File).length,
  }),
);
const rows = [
  bench('assertUnicodeString', () => wire.assertUnicodeString(big)),
  bench('TextEncoder.encode', () => new TextEncoder().encode(big)),
  bench('assertParseDepthWithinLimit', () => guard.assertParseDepthWithinLimit(big)),
  bench('callSyntax parse (WASM+copy out)', () => wasm.callSyntax('parse', bytes, optsWire)),
  bench('callSyntax parse-with-positions (WASM+copy out)', () =>
    wasm.callSyntax('parse-with-positions', bytes, optsWire),
  ),
  bench('JSON.parse (with positions)', () => JSON.parse(respPos)),
  bench('decodeWire (with positions, incl JSON.parse)', () => wire.decodeWire(respPos)),
  bench('decodeWire (plain, incl JSON.parse)', () => wire.decodeWire(respPlain)),
  bench('isSyntaxFile validation', () => wire.isSyntaxFile(decoded.File)),
  bench('createPositionSnapshot', () =>
    snap.createPositionSnapshot(decoded.File, decoded.Positions),
  ),
  bench('parseWithPositionsSync (total)', () => parseWithPositionsSync(big, opts)),
];
console.table(rows);
