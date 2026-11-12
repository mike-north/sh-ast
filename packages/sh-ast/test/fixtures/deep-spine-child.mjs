/**
 * Isolated probe: runs one traversal over a synthesized left-nested spine on the host's
 * ordinary JavaScript stack and prints what it observed as JSON. The parser refuses chains
 * this long, so the tree is built directly from schema defaults. Construction and every
 * count here are iterative; only the operation under test may recurse.
 *
 * argv: <dist directory URL, trailing slash> <mode> <links>
 */
const [distUrl, mode, linksArg] = process.argv.slice(2);
const links = Number(linksArg);
const load = (name) => import(new URL(name, distUrl).href);
const { SYNTAX_SCHEMA } = await load('index.js');

const zeroPos = {
  Offset: 0,
  Line: 0,
  Col: 0,
  IsValid: false,
  IsRecovered: false,
  OffsetOverflow: false,
};

/** A complete record with schema-default fields, as the test fixtures build them. */
function record(Type, fields = {}) {
  const values = { Type };
  for (const [key, field] of Object.entries(SYNTAX_SCHEMA[Type].fields)) {
    values[key] =
      field.nullable || field.slice
        ? null
        : field.kind === 'position'
          ? { ...zeroPos }
          : field.kind === 'boolean'
            ? false
            : field.kind === 'string'
              ? ''
              : 0;
  }
  return Object.assign(values, fields);
}

/** `true && true && ...` with `links` commands: BinaryCmd.X nests to the left. */
function commandSpine() {
  const command = () =>
    record('Stmt', {
      Cmd: record('CallExpr', {
        Args: [record('Word', { Parts: [record('Lit', { Value: 'true' })] })],
      }),
    });
  let left = command();
  for (let index = 1; index < links; index++) {
    left = record('Stmt', { Cmd: record('BinaryCmd', { X: left, Y: command() }) });
  }
  return left;
}

/** `1+1+...` with `links` terms: BinaryArithm.X nests to the left. */
function arithmeticSpine() {
  const term = () => record('Word', { Parts: [record('Lit', { Value: '1' })] });
  let left = term();
  for (let index = 1; index < links; index++) {
    left = record('BinaryArithm', { X: left, Y: term() });
  }
  return record('ArithmExp', { X: left });
}

/** Counts by Type iteratively, following only fields that hold records or arrays. */
function countTypes(root) {
  const counts = {};
  const pending = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== 'object' || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    if (typeof value.Type === 'string') counts[value.Type] = (counts[value.Type] ?? 0) + 1;
    for (const child of Object.values(value)) pending.push(child);
  }
  return counts;
}

/** Wraps a statement spine in the File the parse path validates and restores. */
function file(stmt) {
  return record('File', { Stmts: [stmt] });
}

const result = { mode, links };
const spine =
  mode.endsWith('arith') || mode === 'bounds-position' ? arithmeticSpine() : commandSpine();
result.expected = countTypes(spine);

switch (mode) {
  case 'walk-command':
  case 'walk-arith': {
    const { walk } = await load('syntax-walk.js');
    const entered = {};
    let exits = 0;
    walk(spine, (node) => {
      if (node === null) exits++;
      else entered[node.Type] = (entered[node.Type] ?? 0) + 1;
      return true;
    });
    result.entered = entered;
    result.exits = exits;
    break;
  }
  case 'walk-prune': {
    const { walk } = await load('syntax-walk.js');
    let seen = 0;
    walk(spine, (node) => {
      if (node !== null) seen++;
      return node === null || node.Type !== 'CallExpr';
    });
    result.seen = seen;
    break;
  }
  case 'walk-cycle': {
    // The deepest left record points back at the root, so Walk never reaches a leaf.
    const { walk } = await load('syntax-walk.js');
    let deepest = spine;
    while (deepest.Cmd?.X) deepest = deepest.Cmd.X;
    deepest.Redirs = [{ ...record('Redirect'), Word: record('Word') }];
    deepest.Cmd = record('BinaryCmd', { X: spine, Y: record('Stmt') });
    try {
      walk(spine, () => true);
      result.error = null;
    } catch (error) {
      result.error = `${error.name}: ${String(error.message).slice(0, 80)}`;
    }
    break;
  }
  case 'walk-throw': {
    const { walk } = await load('syntax-walk.js');
    const sentinel = new Error('stop');
    let thrown;
    let calls = 0;
    try {
      walk(spine, () => {
        if (++calls === links) throw sentinel;
        return true;
      });
    } catch (error) {
      thrown = error;
    }
    result.sameError = thrown === sentinel;
    break;
  }
  case 'encode-command':
  case 'encode-arith': {
    const { encodeWire, decodeWire } = await load('syntax-wire.js');
    const text = encodeWire(spine);
    result.length = text.length;
    // JSON.parse is iterative in V8 for nested objects, so the text round-trips.
    result.roundTripTypes = countTypes(decodeWire(text));
    break;
  }
  case 'encode-cycle': {
    const { encodeWire } = await load('syntax-wire.js');
    // The deepest left record points back at the root: a cycle only visible at full depth.
    let deepest = spine;
    while (deepest.Cmd?.X) deepest = deepest.Cmd.X;
    deepest.Redirs = [spine];
    try {
      encodeWire(spine);
      result.error = null;
    } catch (error) {
      result.error = String(error.message);
    }
    break;
  }
  case 'validate-command':
  case 'validate-arith': {
    const { isSyntaxNode, isSyntaxFile, restoreSyntaxFile } = await load('syntax-wire.js');
    result.node = isSyntaxNode(spine);
    if (mode === 'validate-command') {
      result.file = isSyntaxFile(file(spine));
      // Same depth with compact position tuples, as a parse response spells them.
      const compact = file(spine);
      const pending = [compact];
      while (pending.length > 0) {
        const value = pending.pop();
        if (typeof value !== 'object' || value === null) continue;
        if (Array.isArray(value)) pending.push(...value);
        else {
          if (value.Type === 'Stmt') value.Position = [0, 0, 0, 0];
          pending.push(...Object.values(value));
        }
      }
      result.restored = restoreSyntaxFile(compact);
      result.restoredPosition = compact.Stmts[0].Position;
    }
    break;
  }
  case 'print-command': {
    const { printSync } = await load('index.js');
    try {
      const printed = printSync(spine);
      result.error = null;
      result.printedLength = String(printed).length;
    } catch (error) {
      result.error = `${error.name}: ${String(error.message).slice(0, 200)}`;
    }
    break;
  }
  case 'validate-reject': {
    const { isSyntaxNode } = await load('syntax-wire.js');
    let deepest = spine;
    while (deepest.Cmd?.X) deepest = deepest.Cmd.X;
    deepest.Negated = 'not a boolean';
    result.node = isSyntaxNode(spine);
    break;
  }
  case 'validate-cycle': {
    const { isSyntaxNode } = await load('syntax-wire.js');
    let deepest = spine;
    while (deepest.Cmd?.X) deepest = deepest.Cmd.X;
    deepest.Redirs = [{ ...record('Redirect'), Word: record('Word') }];
    result.acyclic = isSyntaxNode(spine);
    deepest.Cmd = record('BinaryCmd', { X: spine, Y: record('Stmt') });
    result.cyclic = isSyntaxNode(spine);
    break;
  }
  case 'visit-nodes': {
    const { visitNodes } = await load('syntax-snapshot.js');
    const entered = {};
    visitNodes(file(spine), (node) => {
      entered[node.Type] = (entered[node.Type] ?? 0) + 1;
    });
    result.entered = entered;
    break;
  }
  case 'decode-bytes': {
    const { decodeWire } = await load('syntax-wire.js');
    // links nested single-key records with a byte tag at the bottom.
    let text = '{"Bytes":"AQID"}';
    for (let index = 0; index < links; index++) text = `{"X":${text}}`;
    let node = decodeWire(text);
    for (let index = 0; index < links; index++) node = node.X;
    result.bytes = Array.from(node);
    break;
  }
  case 'bounds-position': {
    const { position } = await load('syntax-walk-bounds.js');
    result.position = position(spine.X);
    break;
  }
  default:
    throw new Error(`unknown mode ${mode}`);
}

console.log(JSON.stringify(result));
