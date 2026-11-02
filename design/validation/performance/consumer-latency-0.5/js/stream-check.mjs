// Proof: streaming encoder output is byte-identical to the existing map+json.Marshal path, and faster.
import path from 'node:path';
const w = await import(path.resolve('node_modules/sh-ast-stream/dist/wasm-instance.js'));
const wire = await import(path.resolve('node_modules/sh-ast-stream/dist/syntax-wire.js'));
const sh = await import(path.resolve('node_modules/sh-ast-stream/dist/index.js'));
const big = Array.from(
  { length: 100 },
  (_, i) =>
    `f${i}() {\n  local x="v${i} 🎉"\n  if [ -n "$x" ]; then\n    echo "$x" | tr a-z A-Z\n  fi\n}\ncase "$1" in a) f${i};; esac\n`,
).join('');
const fixtures = {
  big,
  html: 'echo "<a>&</a>" > out && cat <<EOF\nline \\u2028 é 中文 🎉\nEOF\n# comment <x>\n',
  invalidUtf8: Uint8Array.from([0x65, 0x63, 0x68, 0x6f, 0x20, 0xff, 0xfe, 0x0a]),
  ctl: 'printf "\\t\\x01"\x01\n',
  arith:
    'for ((i=0;i<3;i++)); do x=$((i*2)); [[ $x =~ ^a ]] && y=${x:1:2}; done\ncoproc foo { :; }\n',
  zshish: 'a=(1 2 3); echo ${a[@]} $(( a[1] + 1 )) <(ls) >(cat)\n',
};
for (const variant of ['LangBash', 'LangZsh', 'LangMirBSDKorn'])
  for (const [name, src] of Object.entries(fixtures)) {
    const b = typeof src === 'string' ? new TextEncoder().encode(src) : src;
    const o = wire.encodeWire({ Variant: sh[variant], KeepComments: true, Filename: 'a.sh' });
    for (const op of ['parse', 'parse-with-positions']) {
      if (name === 'big' && variant === 'LangBash') {
      }
      const a = w.callSyntax(op, b, o),
        l = w.callSyntax('legacy-' + op, b, o);
      if (a !== l) {
        console.log('MISMATCH', variant, name, op, a.length, l.length);
        const i = [...a].findIndex((c, k) => c !== l[k]);
        console.log(a.slice(i - 80, i + 80));
        console.log(l.slice(i - 80, i + 80));
      }
    }
  }
for (const op of ['parse', 'parse-with-positions']) {
  const o = wire.encodeWire({
    Variant: sh.LangBash,
    KeepComments: true,
    Filename: Uint8Array.from([0x61, 0xff]),
  });
  const b = new TextEncoder().encode('echo hi\n');
  const a = w.callSyntax(op, b, o);
  if (a !== w.callSyntax('legacy-' + op, b, o) || !a.includes('Bytes'))
    console.log('BYTES MISMATCH');
}
let streamed = 0,
  fellBack = 0;
for (const [name, src] of Object.entries(fixtures)) {
  const r = w.callSyntax(
    'parse',
    typeof src === 'string' ? new TextEncoder().encode(src) : src,
    wire.encodeWire({ Variant: sh.LangBash, KeepComments: true }),
  );
  r.includes('"Error"') ? fellBack++ : streamed++;
}
console.log('identity check done', {
  streamedFixtures: streamed,
  errorFixturesUsingFallback: fellBack,
});
const b = new TextEncoder().encode(big),
  o = wire.encodeWire({ Variant: sh.LangBash, Filename: 'a.sh', KeepComments: true });
const med = (f) => {
  const xs = [];
  for (let i = 0; i < 35; i++) {
    const s = performance.now();
    f();
    if (i >= 5) xs.push(performance.now() - s);
  }
  xs.sort((a, b) => a - b);
  return +xs[15].toFixed(2);
};
console.table({
  'legacy parse': med(() => w.callSyntax('legacy-parse', b, o)),
  'stream parse': med(() => w.callSyntax('parse', b, o)),
  'legacy parse-with-positions': med(() => w.callSyntax('legacy-parse-with-positions', b, o)),
  'stream parse-with-positions': med(() => w.callSyntax('parse-with-positions', b, o)),
  'parseWithPositionsSync total (stream wasm)': med(() =>
    sh.parseWithPositionsSync(big, { Variant: sh.LangBash, Filename: 'a.sh', KeepComments: true }),
  ),
});
