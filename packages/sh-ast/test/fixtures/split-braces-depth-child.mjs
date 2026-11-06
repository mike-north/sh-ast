/**
 * Isolated public-operation probe using the host's ordinary JavaScript stack.
 * Brace spelling is parsed as one shallow Word before Go's iterative rewrite;
 * generated trees and constructed input are never walked recursively by tests.
 */
import assert from 'node:assert/strict';

const { parseSync, parseWithPositionsSync, printSync, nodePos, splitBraces, ShInternalError } =
  await import(process.argv[2]);
const mode = process.argv[3];
const depth = Number(process.argv[4]);
const attempts = Number(process.argv[5] ?? 1);
const zero = {
  Offset: 0,
  Line: 0,
  Col: 0,
  IsValid: false,
  IsRecovered: false,
  OffsetOverflow: false,
};

/** Capture references and scalar values iteratively, including array lengths. */
function capture(root) {
  const pending = [root];
  const seen = new Set();
  const records = [];
  while (pending.length > 0) {
    const object = pending.pop();
    if (object === null || typeof object !== 'object' || seen.has(object)) continue;
    seen.add(object);
    const entries = Reflect.ownKeys(object).map((key) => [key, object[key]]);
    records.push({ object, entries });
    for (const [, value] of entries) {
      if (value !== null && typeof value === 'object') pending.push(value);
    }
  }
  return records;
}

/** Verify every original property without recursively asserting the deep graph. */
function unchanged(records) {
  for (const { object, entries } of records) {
    assert.deepEqual(
      Reflect.ownKeys(object),
      entries.map(([key]) => key),
    );
    for (const [key, value] of entries) assert.strictEqual(object[key], value);
  }
}

function makeWord() {
  let word;
  if (mode === 'input' || mode === 'warm-input') {
    word = {
      Type: 'Word',
      Parts: [{ Type: 'Lit', Value: 'leaf', ValuePos: zero, ValueEnd: zero }],
    };
    for (let index = 0; index < depth; index++) {
      word = { Type: 'Word', Parts: [{ Type: 'BraceExp', Sequence: false, Elems: [word] }] };
    }
  } else {
    // Braces do not nest the parser's grammar here; they remain raw literal data.
    const source = 'echo ' + '{a,'.repeat(depth) + 'x' + '}'.repeat(depth);
    const file = parseSync(source);
    assert.equal(file.Stmts.length, 1);
    const call = file.Stmts[0].Cmd;
    assert.equal(call.Type, 'CallExpr');
    word = call.Args[1];
    assert.equal(word.Parts.length, 1);
    assert.equal(word.Parts[0].Type, 'Lit');
    if (mode === 'bytes') {
      // A representable Go byte string also exercises recursive output restoration.
      word.Parts[0].Value = new Uint8Array([
        ...new TextEncoder().encode('{a,'.repeat(depth)),
        0xfe,
        ...new TextEncoder().encode('}'.repeat(depth)),
      ]);
    }
  }
  return word;
}
/** Same public recovery sequence follows every accepted or refused warm-up. */
function warmReuse() {
  assert.equal(parseSync('echo retained').Stmts.length, 1);
  const parsed = parseWithPositionsSync('echo retained');
  assert.equal(parsed.Positions.get(parsed.File).Pos.Offset, 0);
  assert.equal(nodePos(parsed.File).Offset, 0);
  assert.equal(printSync(parsed.File), 'echo retained\n');
}

if (mode === 'warm-input') {
  for (const count of [30, 100, 127, 200, 400, 800]) {
    for (const withBrace of [false, true]) {
      for (let attempt = 0; attempt < 8; attempt++) {
        let candidate = {
          Type: 'Word',
          Parts: [{ Type: 'Lit', Value: 'leaf', ValuePos: zero, ValueEnd: zero }],
        };
        for (let index = 0; index < count; index++) {
          candidate = {
            Type: 'Word',
            Parts: [{ Type: 'BraceExp', Sequence: false, Elems: [candidate] }],
          };
        }
        if (withBrace)
          candidate.Parts.push({ Type: 'Lit', Value: '{a,b}', ValuePos: zero, ValueEnd: zero });
        const snapshot = capture(candidate);
        if (count <= 100) assert.equal(splitBraces(candidate), withBrace);
        else {
          assert.throws(
            () => splitBraces(candidate),
            (error) => {
              assert.ok(error instanceof ShInternalError);
              assert.equal(
                error.message,
                'SplitBraces input record depth 257 exceeds the bridge transport limit 256',
              );
              assert.equal(error.cause, undefined);
              return true;
            },
          );
          unchanged(snapshot);
        }
        warmReuse();
      }
    }
  }
}

const observations = [];
for (let iteration = 0; iteration < attempts; iteration++) {
  const word = makeWord();
  const before = capture(word);
  let outcome = 'success';
  let stage;
  try {
    assert.equal(splitBraces(word), mode !== 'input' && mode !== 'warm-input');
  } catch (error) {
    assert.ok(
      error instanceof ShInternalError,
      `raw or wrong failure: ${error.name}: ${error.message}`,
    );
    assert.equal(error.code, 'SH_AST_INTERNAL');
    const inputRefusal =
      error.message === 'SplitBraces input record depth 257 exceeds the bridge transport limit 256';
    const outputRefusal =
      error.message ===
      'SplitBraces output record depth 257 exceeds the bridge transport limit 256';
    assert.ok(inputRefusal || outputRefusal, 'known deep graphs must be refused before a VM trap');
    assert.equal(error.cause, undefined, 'prevention must not fabricate an engine failure');
    stage = inputRefusal ? 'input depth preflight' : 'output depth preflight';
    assert.equal(inputRefusal, mode === 'input' || mode === 'warm-input');
    unchanged(before);
    outcome = 'bridge-resource-failure';
  }
  if (mode !== 'input' && mode !== 'warm-input' && depth >= 1000) {
    assert.equal(
      stage,
      'output depth preflight',
      'known deep output must be refused before a VM trap',
    );
  }
  if (mode !== 'input' && mode !== 'warm-input' && depth <= 100) assert.equal(outcome, 'success');
  const reused = parseSync('echo retained');
  assert.equal(reused.Stmts.length, 1);
  const positioned = parseWithPositionsSync('echo retained');
  assert.equal(positioned.Positions.get(positioned.File).Pos.Offset, 0);
  assert.equal(nodePos(positioned.File).Offset, 0);
  assert.equal(printSync(positioned.File), 'echo retained\n');
  assert.equal(splitBraces({ Type: 'Word', Parts: null }), false);
  // These deliberately over-budget graphs must fail before either recursive
  // transport boundary, independently of JIT warm-up or host stack margins.
  observations.push({ iteration, outcome, stage, unchanged: outcome !== 'success', reused: true });
}
console.log(
  JSON.stringify({ mode, depth, attempts, node: process.version, observations, reused: true }),
);
