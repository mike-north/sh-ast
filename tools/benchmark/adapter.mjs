/** Version-aware workload contracts. No adapter imitates a public API a release does not expose. */
import assert from 'node:assert/strict';

/** All measured phases have independent workers so setup/JIT in one cannot warm another. */
export const phases = [
  'import',
  'first-parse',
  'parse',
  'parse-with-positions',
  'walk',
  'bounds-root',
  'bounds-all',
  'snapshot-lookup',
  'print',
  'edited-print',
];
/** Normalized parsing retains comments inherently; faithful parsing requests them explicitly. */
export function optionsFor(api, fixture) {
  if (!api.SYNTAX_SCHEMA) return { dialect: fixture.dialect, filename: 'benchmark.sh' };
  const names = { bash: 'LangBash', posix: 'LangPOSIX', mksh: 'LangMirBSDKorn', bats: 'LangBats' };
  assert.equal(typeof api[names[fixture.dialect]], 'number', 'unsupported dialect mapping');
  return { Variant: api[names[fixture.dialect]], KeepComments: true, Filename: 'benchmark.sh' };
}
/** Inspect stored records, never walk callback copies, and never treat auxiliary records as Nodes. */
export function records(tree) {
  const result = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.Type || value.type) result.push(value);
    for (const child of Object.values(value))
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
  };
  visit(tree);
  return result;
}
/** Marker literals are independently supplied by fixtures; dropping subtrees must fail the run. */
export function verifyTree(tree, fixture, marker = 'BENCHMARK_TOKEN') {
  assert.equal(tree.Type ?? tree.type, 'File');
  const leaves = records(tree).filter(
    (node) => (node.Type ?? node.type) === 'Lit' && (node.Value ?? node.value) === marker,
  );
  assert.equal(leaves.length, fixture.markers, 'all marker leaves must survive');
  return leaves;
}
/** Contract labels prevent normalized traversal and faithful traversal from receiving speed ratios. */
export function contractFor(api, phase) {
  const model = api.SYNTAX_SCHEMA ? 'faithful' : 'normalized';
  if (phase === 'import') return 'module-import';
  if (['first-parse', 'parse'].includes(phase)) return 'parse-source-retain-comments';
  return `${phase}:${model}`;
}
/** Each operation isolates preparation, measured work and post-clock correctness. */
export function operationFor(api, fixture, phase) {
  if (phase === 'import') return null;
  if (['print', 'edited-print'].includes(phase) && !api.printSync) return null;
  if (phase === 'walk' && !api.walk) return null;
  if (phase.startsWith('bounds-') && (!api.nodePos || !api.nodeEnd)) return null;
  if (['parse-with-positions', 'snapshot-lookup'].includes(phase) && !api.parseWithPositionsSync)
    return null;
  const options = optionsFor(api, fixture);
  const parse = () => api.parseSync(fixture.source, options);
  const validate = (tree) => verifyTree(tree, fixture);
  const storedNodes = (tree) =>
    records(tree).filter((node) => api.SYNTAX_INTERFACES.Node.includes(node.Type));
  if (['first-parse', 'parse'].includes(phase))
    return { setup: () => null, run: parse, verify: validate };
  if (phase === 'parse-with-positions')
    return {
      setup: () => null,
      run: () => api.parseWithPositionsSync(fixture.source, options),
      verify: (result) => validate(result.File),
    };
  if (phase === 'snapshot-lookup')
    return {
      setup() {
        const parsed = api.parseWithPositionsSync(fixture.source, options);
        validate(parsed.File);
        return { parsed, nodes: storedNodes(parsed.File) };
      },
      run({ parsed, nodes }) {
        return nodes.map((node) => parsed.Positions.get(node));
      },
      verify(bounds) {
        assert(bounds.length > 0 && bounds.every((bound) => bound?.Pos && bound?.End));
      },
    };
  if (phase === 'walk')
    return {
      setup: parse,
      run(tree) {
        api.walk(tree, () => true);
        return tree;
      },
      verify: validate,
    };
  if (phase.startsWith('bounds-'))
    return {
      setup() {
        const tree = parse();
        validate(tree);
        return phase === 'bounds-root' ? [tree] : storedNodes(tree);
      },
      run(nodes) {
        return nodes.map((node) => [api.nodePos(node), api.nodeEnd(node)]);
      },
      verify(bounds) {
        assert(
          bounds.length > 0 &&
            bounds.every(
              (pair) => pair.length === 2 && pair.every((pos) => Number.isFinite(pos.Offset)),
            ),
        );
      },
    };
  if (['print', 'edited-print'].includes(phase))
    return {
      setup() {
        const tree = parse();
        const leaves = validate(tree);
        if (phase === 'edited-print')
          for (const leaf of leaves) leaf.Value = 'BENCHMARK_EDITED_TOKEN';
        return tree;
      },
      run: (tree) => api.printSync(tree),
      verify(output) {
        verifyTree(
          api.parseSync(output, options),
          fixture,
          phase === 'edited-print' ? 'BENCHMARK_EDITED_TOKEN' : 'BENCHMARK_TOKEN',
        );
      },
    };
  throw new Error(`Unknown phase: ${phase}`);
}

/** Untimed callback evidence catches empty/pruned traversals even if the input tree remains intact. */
export function verifyWalk(api, tree, fixture) {
  const counts = { entries: 0, exits: 0, markerVisits: 0 };
  api.walk(tree, (node) => {
    if (node === null) counts.exits++;
    else {
      counts.entries++;
      if ((node.Type ?? node.type) === 'Lit' && (node.Value ?? node.value) === 'BENCHMARK_TOKEN')
        counts.markerVisits++;
    }
    return true;
  });
  assert.equal(counts.markerVisits, fixture.markers);
  if (api.SYNTAX_SCHEMA) assert.equal(counts.entries, counts.exits);
  return counts;
}

/** Independent source offsets validate byte positions, snapshot stability, and live edited bounds. */
export function verifyBounds(api, tree, fixture, positions) {
  const leaves = verifyTree(tree, fixture);
  let start = 0;
  for (const leaf of leaves) {
    const index = fixture.source.indexOf('BENCHMARK_TOKEN', start);
    assert(index >= 0);
    start = index + 15;
    const offset = Buffer.byteLength(fixture.source.slice(0, index));
    assert.equal(api.nodePos(leaf).Offset, offset);
    assert.equal(api.nodeEnd(leaf).Offset, offset + 15);
    if (positions) {
      const original = positions.get(leaf);
      assert.deepEqual(original, { Pos: api.nodePos(leaf), End: api.nodeEnd(leaf) });
      const end = leaf.ValueEnd;
      leaf.Value = 'BENCHMARK_EDITED_TOKEN';
      // Lit.End is the explicit ValueEnd position, not a length recomputed from Value.
      leaf.ValueEnd = { ...end, Offset: offset + 22, Col: end.Col + 7 };
      assert.equal(api.nodeEnd(leaf).Offset, offset + 22);
      assert.deepEqual(positions.get(leaf), original);
      leaf.Value = 'BENCHMARK_TOKEN';
      leaf.ValueEnd = end;
    }
  }
}

/** Snapshot coverage checks every stored node, excluding auxiliary records and copied callback values. */
export function verifySnapshot(api, parsed) {
  for (const node of records(parsed.File).filter((node) =>
    api.SYNTAX_INTERFACES.Node.includes(node.Type),
  )) {
    assert.deepEqual(parsed.Positions.get(node), {
      Pos: api.nodePos(node),
      End: api.nodeEnd(node),
    });
    assert.equal(parsed.Positions.get({ ...node }), undefined);
  }
}
