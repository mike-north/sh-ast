import path from 'node:path';
const w = await import(path.resolve('node_modules/sh-ast-05/dist/wasm-instance.js'));
const wire = await import(path.resolve('node_modules/sh-ast-05/dist/syntax-wire.js'));
const sh = await import('sh-ast-05');
const big = Array.from(
  { length: 100 },
  (_, i) =>
    `f${i}() {\n  local x="v${i} 🎉"\n  if [ -n "$x" ]; then\n    echo "$x" | tr a-z A-Z\n  fi\n}\ncase "$1" in a) f${i};; esac\n`,
).join('');
const r = JSON.parse(
  w.callSyntax(
    'parse-with-positions',
    new TextEncoder().encode(big),
    wire.encodeWire({ Variant: sh.LangBash, KeepComments: true }),
  ),
);
let posRecs = 0,
  posBytes = 0,
  nodes = 0,
  invalidPos = 0;
(function walk(v) {
  if (Array.isArray(v)) return v.forEach(walk);
  if (v && typeof v === 'object') {
    if ('OffsetOverflow' in v) {
      posRecs++;
      posBytes += JSON.stringify(v).length;
      if (!v.IsValid) invalidPos++;
      return;
    }
    if (v.Type) nodes++;
    Object.values(v).forEach(walk);
  }
})(r.File);
const pathBytes = r.Positions.reduce((n, e) => n + JSON.stringify(e.Path).length, 0);
const avgDepth = r.Positions.reduce((n, e) => n + e.Path.length, 0) / r.Positions.length;
console.log({
  fileBytes: JSON.stringify(r.File).length,
  records: nodes,
  posRecsInFile: posRecs,
  posBytesInFile: posBytes,
  invalidPosInFile: invalidPos,
  positionsBytes: JSON.stringify(r.Positions).length,
  entries: r.Positions.length,
  pathBytes,
  avgPathLen: +avgDepth.toFixed(1),
});
// Is the Positions sidecar order identical to a JS schema-order pre-order walk? (enables index correlation without Path)
const schema = sh.SYNTAX_SCHEMA,
  NodeSet = new Set(sh.SYNTAX_INTERFACES.Node);
const order = [];
(function visit(v, p) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.Type !== 'string') return;
  if (NodeSet.has(v.Type) || (v.Type === 'TypedNil' && NodeSet.has(v.Kind)))
    order.push(JSON.stringify(p));
  if (!schema[v.Type]) return;
  for (const [n, f] of Object.entries(schema[v.Type].fields)) {
    if (f.kind !== 'struct' && f.kind !== 'interface') continue;
    const c = v[n];
    if (Array.isArray(c)) c.forEach((it, i) => visit(it, [...p, n, i]));
    else visit(c, [...p, n]);
  }
})(r.File, []);
const goOrder = r.Positions.map((e) => JSON.stringify(e.Path));
console.log({
  sameSet:
    order.length === goOrder.length && new Set(order).size === new Set([...order, ...goOrder]).size,
  sameOrder: order.every((p, i) => p === goOrder[i]),
  firstMismatch: order.findIndex((p, i) => p !== goOrder[i]),
});
const i = order.findIndex((p, i) => p !== goOrder[i]);
if (i >= 0) console.log(order.slice(i, i + 3), goOrder.slice(i, i + 3));
