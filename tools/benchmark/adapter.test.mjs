/** Adapter outcomes pin work contracts independently of real package speed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { optionsFor, operationFor, verifyTree } from './adapter.mjs';
const fixture = { source: 'echo BENCHMARK_TOKEN\n', markers: 1, dialect: 'posix' };
test('dialect and comment policies are explicit for both API generations', () => {
  assert.deepEqual(optionsFor({}, fixture), { dialect: 'posix', filename: 'benchmark.sh' });
  assert.deepEqual(optionsFor({ SYNTAX_SCHEMA: {}, LangPOSIX: 1 }, fixture), {
    Variant: 1,
    KeepComments: true,
    Filename: 'benchmark.sh',
  });
});
test('missing print remains unsupported, never substituted with source replay', () => {
  assert.equal(operationFor({}, fixture, 'print'), null);
});
test('print reparsing is a verification step outside the measured operation', () => {
  const calls = [];
  const api = {
    parseSync() {
      calls.push('parse');
      return { type: 'File', child: { type: 'Lit', value: 'BENCHMARK_TOKEN' } };
    },
    printSync() {
      calls.push('print');
      return fixture.source;
    },
  };
  const operation = operationFor(api, fixture, 'print');
  const state = operation.setup();
  calls.length = 0;
  const output = operation.run(state);
  assert.deepEqual(calls, ['print']);
  operation.verify(output);
  assert.deepEqual(calls, ['print', 'parse']);
});
test('correctness rejects silently skipped marker leaves', () => {
  assert.throws(() => verifyTree({ type: 'File' }, fixture));
  assert.doesNotThrow(() =>
    verifyTree({ Type: 'File', child: { Type: 'Lit', Value: 'BENCHMARK_TOKEN' } }, fixture),
  );
});

test('traversal verification rejects no-op walk even when its input tree is complete', async () => {
  const { verifyWalk } = await import('./adapter.mjs');
  const tree = { type: 'File', child: { type: 'Lit', value: 'BENCHMARK_TOKEN' } };
  assert.throws(() => verifyWalk({ walk() {} }, tree, fixture));
  const result = verifyWalk(
    {
      walk(root, visit) {
        visit(root);
        visit(root.child);
      },
    },
    tree,
    fixture,
  );
  assert.equal(result.markerVisits, 1);
  assert.equal(result.entries, 2);
});

test('bounds verification rejects finite but incorrect zero offsets in Unicode source', async () => {
  const { verifyBounds } = await import('./adapter.mjs');
  const unicode = { source: '# 你好 🎉 é\necho BENCHMARK_TOKEN\n', markers: 1 };
  const tree = { Type: 'File', child: { Type: 'Lit', Value: 'BENCHMARK_TOKEN' } };
  assert.throws(() =>
    verifyBounds({ nodePos: () => ({ Offset: 0 }), nodeEnd: () => ({ Offset: 0 }) }, tree, unicode),
  );
});
test('snapshot verification rejects a lookup that follows edits instead of the original parse', async () => {
  const { verifyBounds } = await import('./adapter.mjs');
  const tree = {
    Type: 'File',
    child: { Type: 'Lit', Value: 'BENCHMARK_TOKEN', ValueEnd: { Offset: 20, Col: 21 } },
  };
  const api = {
    nodePos: () => ({ Offset: 5 }),
    nodeEnd: (node) => ({ Offset: node.ValueEnd.Offset }),
  };
  assert.throws(() =>
    verifyBounds(api, tree, fixture, {
      get(node) {
        return { Pos: api.nodePos(node), End: api.nodeEnd(node) };
      },
    }),
  );
});

test('snapshot verification covers non-marker nodes and rejects copied-node lookup', async () => {
  const { verifySnapshot } = await import('./adapter.mjs');
  const tree = { Type: 'File', child: { Type: 'Lit', Value: 'BENCHMARK_TOKEN' } };
  const bounds = { Pos: { Offset: 0 }, End: { Offset: 20 } };
  const api = {
    SYNTAX_INTERFACES: { Node: ['File', 'Lit'] },
    nodePos: () => bounds.Pos,
    nodeEnd: () => bounds.End,
  };
  assert.throws(() =>
    verifySnapshot(api, {
      File: tree,
      Positions: { get: (node) => (node === tree ? undefined : bounds) },
    }),
  );
  assert.throws(() => verifySnapshot(api, { File: tree, Positions: { get: () => bounds } }));
  assert.doesNotThrow(() =>
    verifySnapshot(api, {
      File: tree,
      Positions: { get: (node) => (node === tree || node === tree.child ? bounds : undefined) },
    }),
  );
});
