// Summarize a .cpuprofile: self time by function and by package bucket.
import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = p.timeDeltas;
let total = 0;
for (let i = 0; i < p.samples.length; i++) {
  const n = byId.get(p.samples[i]);
  const d = dt[i] / 1000;
  total += d;
  const cf = n.callFrame;
  const url = cf.url
    .replace(/.*node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?/, '')
    .replace(/.*\/packages\/eslint-plugin\//, 'eslint-plugin/')
    .replace(/^file:\/\//, '');
  const k = `${cf.functionName || '(anon)'} @ ${url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
  self.set(k, (self.get(k) ?? 0) + d);
}
const bucket = new Map();
for (const [k, v] of self) {
  const b = /wasm-function|wasm:/.test(k)
    ? 'wasm'
    : /eslint-plugin\//.test(k)
      ? 'eslint-plugin adapter'
      : /sh-ast/.test(k)
        ? 'sh-ast JS'
        : /eslint|esquery|@eslint/.test(k)
          ? 'eslint'
          : /\(garbage collector\)/.test(k)
            ? 'GC'
            : /\(idle\)|\(program\)|\(root\)/.test(k)
              ? 'idle/program'
              : 'other';
  bucket.set(b, (bucket.get(b) ?? 0) + v);
}
console.log('total ms', total.toFixed(0));
console.table(
  [...bucket]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ bucket: k, ms: +v.toFixed(1), pct: +((100 * v) / total).toFixed(1) })),
);
console.table(
  [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, +(process.argv[3] ?? 25))
    .map(([k, v]) => ({ fn: k.slice(0, 95), ms: +v.toFixed(1) })),
);
