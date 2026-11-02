// Equivalence + timing: published 0.5.0 vs streaming-encoder wasm vs streaming + JS decode/snapshot prototype.
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
const load = async (p) => import(path.resolve(`node_modules/${p}/dist/index.js`));
const base = await load('sh-ast-05'),
  stream = await load('sh-ast-stream'),
  fast = await load('sh-ast-fast');
const big = Array.from(
  { length: 100 },
  (_, i) =>
    `f${i}() {\n  local x="v${i} 🎉"\n  if [ -n "$x" ]; then\n    echo "$x" | tr a-z A-Z\n  fi\n}\ncase "$1" in a) f${i};; esac\n`,
).join('');
const fixtures = [
  big,
  'echo "<a>&</a>" > out && cat <<EOF\nline é 中文 🎉\nEOF\n# c\n',
  'for ((i=0;i<3;i++)); do x=$((i*2)); [[ $x =~ ^a ]] && y=${x:1:2}; done\n',
];
const o = { Variant: base.LangBash, Filename: 'a.sh', KeepComments: true };
for (const src of fixtures) {
  const a = base.parseWithPositionsSync(src, o),
    b = fast.parseWithPositionsSync(src, o);
  if (!isDeepStrictEqual(a.File, b.File)) throw new Error('File differs');
  const na = [],
    nb = [];
  const coll = (f, out) =>
    (function w(v) {
      if (Array.isArray(v)) return v.forEach(w);
      if (v && typeof v === 'object' && !(v instanceof Uint8Array)) {
        if (typeof v.Type === 'string' && base.SYNTAX_INTERFACES.Node.includes(v.Type)) out.push(v);
        Object.values(v).forEach(w);
      }
    })(f);
  coll(a.File, na);
  coll(b.File, nb);
  na.forEach((n, i) => {
    if (!isDeepStrictEqual(a.Positions.get(n), b.Positions.get(nb[i])))
      throw new Error('positions differ');
  });
}
{
  const fo = { ...o, Filename: Uint8Array.from([0x61, 0xff, 0x2e]) };
  const a = base.parseWithPositionsSync('echo hi # x\n', fo),
    b = fast.parseWithPositionsSync('echo hi # x\n', fo);
  if (!(a.File.Name instanceof Uint8Array) || !isDeepStrictEqual(a.File, b.File))
    throw new Error('bytes File differs');
}
console.log('equivalent on', fixtures.length, 'fixtures');
const med = (f) => {
  const xs = [];
  for (let i = 0; i < 35; i++) {
    const s = performance.now();
    f();
    if (i >= 5) xs.push(performance.now() - s);
  }
  xs.sort((a, b) => a - b);
  return { median: +xs[15].toFixed(2), min: +xs[0].toFixed(2), p90: +xs[27].toFixed(2) };
};
console.table({
  '0.5.0 published': med(() => base.parseWithPositionsSync(big, o)),
  '+ streaming Go encoder': med(() => stream.parseWithPositionsSync(big, o)),
  '+ in-place decodeWire, path-resolve snapshot': med(() => fast.parseWithPositionsSync(big, o)),
});
