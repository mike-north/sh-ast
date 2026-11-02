// PROTOTYPE: parseWithPositionsSync over the compact, path-free sidecar (op parse-with-positions-compact).
import path from 'node:path';
const dir = path.resolve('node_modules/sh-ast-fast/dist');
const { callSyntax } = await import(path.join(dir, 'wasm-instance.js'));
const { decodeWire, encodeWire, isSyntaxFile, isSyntaxPos, isGoString } = await import(
  path.join(dir, 'syntax-wire.js')
);
const { SYNTAX_SCHEMA, SYNTAX_INTERFACES } = await import(path.join(dir, 'index.js'));
const NODE = new Set(SYNTAX_INTERFACES.Node);
const childCache = new Map();
const childFields = (t) => {
  let n = childCache.get(t);
  if (!n) {
    n = Object.entries(SYNTAX_SCHEMA[t].fields)
      .filter(([, f]) => f.kind === 'struct' || f.kind === 'interface')
      .map(([k]) => k);
    childCache.set(t, n);
  }
  return n;
};
const pos = (a, i) =>
  Object.freeze({
    Offset: a[i],
    Line: a[i + 1],
    Col: a[i + 2],
    IsValid: (a[i + 3] & 1) !== 0,
    IsRecovered: (a[i + 3] & 2) !== 0,
    OffsetOverflow: (a[i + 3] & 4) !== 0,
  });
export function parseWithPositionsCompact(source, options) {
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
  const r = decodeWire(callSyntax('parse-with-positions-compact', bytes, encodeWire(options)));
  if (r.Error !== undefined) throw new Error('prototype covers success only');
  if (!isSyntaxFile(r.File)) throw new Error('invalid File');
  const nodes = [];
  (function visit(v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v) || typeof v.Type !== 'string')
      return;
    if (NODE.has(v.Type) || (v.Type === 'TypedNil' && NODE.has(v.Kind))) nodes.push(v);
    if (!Object.hasOwn(SYNTAX_SCHEMA, v.Type)) return;
    for (const name of childFields(v.Type)) {
      const c = v[name];
      if (Array.isArray(c)) for (const x of c) visit(x);
      else visit(c);
    }
  })(r.File);
  const flat = r.Positions;
  if (!Array.isArray(flat) || flat.length !== nodes.length * 8)
    throw new Error('sidecar does not cover every parsed node');
  const errors = new Map(r.PositionErrors.map(([i, pe, ee]) => [i, pe ?? ee]));
  const obs = new WeakMap();
  for (let n = 0; n < nodes.length; n++) {
    const e = errors.get(n);
    if (e !== undefined) {
      if (!isGoString(e)) throw new Error('bad error');
      obs.set(nodes[n], { error: e });
      continue;
    }
    const P = pos(flat, n * 8),
      E = pos(flat, n * 8 + 4);
    if (!isSyntaxPos(P) || !isSyntaxPos(E)) throw new Error('invalid position observation');
    obs.set(nodes[n], { positions: Object.freeze({ Pos: P, End: E }) });
  }
  return Object.freeze({
    File: r.File,
    Positions: Object.freeze({
      get(node) {
        const o = obs.get(node);
        if (o === undefined) return undefined;
        if ('error' in o) throw new Error(String(o.error));
        return o.positions;
      },
    }),
  });
}
