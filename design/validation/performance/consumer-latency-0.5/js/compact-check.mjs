import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseWithPositionsCompact } from './compact.mjs';
const base = await import('sh-ast-05');
const fast = await import(path.resolve('node_modules/sh-ast-fast/dist/index.js'));
const w = await import(path.resolve('node_modules/sh-ast-fast/dist/wasm-instance.js'));
const wire = await import(path.resolve('node_modules/sh-ast-fast/dist/syntax-wire.js'));
const v3 = await import('sh-ast-03');
const big = Array.from(
  { length: 100 },
  (_, i) =>
    `f${i}() {\n  local x="v${i} 🎉"\n  if [ -n "$x" ]; then\n    echo "$x" | tr a-z A-Z\n  fi\n}\ncase "$1" in a) f${i};; esac\n`,
).join('');
const fixtures = [
  big,
  'echo "<a>&</a>" > out && cat <<EOF\nline é 中文 🎉\nEOF\n# c\n',
  'for ((i=0;i<3;i++)); do x=$((i*2)); [[ $x =~ ^a ]] && y=${x:1:2}; done\n',
  'f() { # c1\n  # c2\n  a=(1 2) b=$(echo `x`) ; select x in a b; do :; done\n} # c3\n',
  'cat <<-EOF\n\tbody\n\tEOF\nlet x=1 y=2; declare -A m=([k]=v); echo ${m[k]:-d} ${#m[@]} ${x//a/b} $((x?1:2))\ntime { ! true | false; } |& cat\n',
];
const o = { Variant: base.LangBash, Filename: 'a.sh', KeepComments: true };
const collect = (f) => {
  const out = [];
  (function w(v) {
    if (Array.isArray(v)) return v.forEach(w);
    if (v && typeof v === 'object' && !(v instanceof Uint8Array)) {
      if (typeof v.Type === 'string' && base.SYNTAX_INTERFACES.Node.includes(v.Type)) out.push(v);
      Object.values(v).forEach(w);
    }
  })(f);
  return out;
};
for (const src of fixtures) {
  const a = base.parseWithPositionsSync(src, o),
    c = parseWithPositionsCompact(src, o);
  if (!isDeepStrictEqual(a.File, c.File)) throw new Error('File differs');
  const na = collect(a.File),
    nc = collect(c.File);
  na.forEach((n, i) => {
    if (!isDeepStrictEqual(a.Positions.get(n), c.Positions.get(nc[i])))
      throw new Error('positions differ at ' + i + ' ' + n.Type);
  });
}
console.log('compact sidecar equivalent on', fixtures.length, 'fixtures');
const b = new TextEncoder().encode(big),
  ow = wire.encodeWire(o);
console.log({ compactResponseBytes: w.callSyntax('parse-with-positions-compact', b, ow).length });
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
  '0.3.1 parseSync': med(() => v3.parseSync(big, { dialect: 'bash', filename: 'a.sh' })),
  '0.5.0 parseWithPositionsSync (published)': med(() => base.parseWithPositionsSync(big, o)),
  'P1 stream encoder + P2 JS decode/snapshot': med(() => fast.parseWithPositionsSync(big, o)),
  'P1+P2+P3 compact fused sidecar': med(() => parseWithPositionsCompact(big, o)),
  'WASM only: stream parse (no positions)': med(() => w.callSyntax('parse', b, ow)),
  'WASM only: stream parse-with-positions': med(() => w.callSyntax('parse-with-positions', b, ow)),
  'WASM only: compact parse-with-positions': med(() =>
    w.callSyntax('parse-with-positions-compact', b, ow),
  ),
});
