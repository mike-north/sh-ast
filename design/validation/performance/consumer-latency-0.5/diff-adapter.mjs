// Differential: HEAD adapter (TS source) vs prototype adapter (built dist) on varied fixtures.
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseWithPositionsSync, LangBash } from 'sh-ast';
const S = process.env.ADAPTER_BASELINE_DIR;
const oldView = await import(path.join(S, 'oldsrc/syntax-view.ts'));
const oldCoords = await import(path.join(S, 'oldsrc/source-coordinates.ts'));
const newView = await import(path.resolve('dist/language/syntax-view.js'));
const newCoords = await import(path.resolve('dist/language/source-coordinates.js'));
const big = Array.from(
  { length: 100 },
  (_, i) =>
    `f${i}() {\n  local x="v${i} 🎉"\n  if [ -n "$x" ]; then\n    echo "$x" | tr a-z A-Z\n  fi\n}\ncase "$1" in a) f${i};; esac\n`,
).join('');
const fixtures = [
  big,
  '',
  'echo é\r\necho 中文 🎉 # c\r\n',
  'a=(1 2) # x\nf() { # c1\n  # c2\n  echo `x` $(y) ${z:-é}\n} # c3\n',
  'cat <<-EOF\n\tbody 🎉\n\tEOF\nfor ((i=0;i<3;i++)); do :; done\n',
  '\u{10FFFF}x\n\u0080߿ࠀ￿\n',
];
for (const src of fixtures) {
  const p = parseWithPositionsSync(src, { Variant: LangBash, KeepComments: true });
  const a = oldView.adaptSyntaxFile(p.File, src, p.Positions),
    b = newView.adaptSyntaxFile(p.File, src, p.Positions);
  if (!isDeepStrictEqual(a, b))
    throw new Error('view differs for ' + JSON.stringify(src.slice(0, 30)));
  if (
    JSON.stringify(Object.keys(a.stmts[0] ?? {})) !== JSON.stringify(Object.keys(b.stmts[0] ?? {}))
  )
    throw new Error('key order differs');
  const oc = new oldCoords.SourceCoordinates(src),
    nc = new newCoords.SourceCoordinates(src);
  const bytes = Buffer.byteLength(src);
  for (let off = -1; off <= bytes + 2; off++) {
    let x, y;
    try {
      x = oc.fromByteOffset(off);
    } catch (e) {
      x = 'throw';
    }
    try {
      y = nc.fromByteOffset(off);
    } catch (e) {
      y = 'throw';
    }
    if (!isDeepStrictEqual(x, y))
      throw new Error(`coords differ at ${off}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
  }
}
// Lone surrogates only reach SourceCoordinates directly (the parser rejects them).
for (const s of ['a\uD800b\n', '\uDC00\n\uD83D', 'x😀\uD800']) {
  const oc = new oldCoords.SourceCoordinates(s),
    nc = new newCoords.SourceCoordinates(s);
  for (let off = 0; off <= Buffer.byteLength(s) + 1; off++) {
    let x, y;
    try {
      x = oc.fromByteOffset(off);
    } catch {
      x = 'throw';
    }
    try {
      y = nc.fromByteOffset(off);
    } catch {
      y = 'throw';
    }
    if (!isDeepStrictEqual(x, y)) throw new Error('lone surrogate coords differ');
  }
}
console.log(
  'adapter differential: identical on',
  fixtures.length,
  'parsed fixtures + 3 lone-surrogate strings',
);
