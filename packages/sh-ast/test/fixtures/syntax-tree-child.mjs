/**
 * Isolated public parse, walk and print probe for one source.
 *
 * Runs in its own process so that a stack overflow anywhere in the binding ends
 * this child, never the test runner or a WASM instance another test uses. A
 * RangeError is reported as its own outcome so tests can reject it explicitly.
 *
 * Input (stdin, JSON): { source, operation, options, clone, arithBounds }.
 * Output (last stdout line, JSON): one outcome record; see test/isolated-tree.ts.
 *
 * Tree facts are gathered with the public walk, so a reported count also shows
 * that walk completed. Operators are listed by source offset, which does not
 * depend on how the tree associates them. Printing is checked without assuming a
 * spelling: the printed text must parse to the same facts, and printing that
 * parse must reproduce the printed text exactly.
 */
import { readFileSync } from 'node:fs';

const lib = await import(process.argv[2]);
const {
  source,
  operation = 'parseSync',
  options = {},
  clone = false,
  arithBounds = false,
} = JSON.parse(readFileSync(0, 'utf8'));

/** Node counts by type and operator codes in source order, from the public walk. */
function facts(file) {
  const counts = {};
  const cmd = [];
  const arith = [];
  lib.walk(file, (node) => {
    if (node === null) return true;
    counts[node.Type] = (counts[node.Type] ?? 0) + 1;
    if (node.Type === 'BinaryCmd') cmd.push([node.OpPos.Offset, node.Op]);
    if (node.Type === 'BinaryArithm') arith.push([node.OpPos.Offset, node.Op]);
    return true;
  });
  const ordered = (pairs) => pairs.sort((a, b) => a[0] - b[0]).map(([, op]) => op);
  return { counts, cmdOperators: ordered(cmd), arithOperators: ordered(arith) };
}

let report;
try {
  const result = lib[operation](source, options);
  const file = result.File ?? result;
  const tree = facts(file);
  const printed = lib.printSync(file);
  const reparsed = lib.parseSync(printed);
  report = {
    outcome: 'parsed',
    facts: tree,
    printed: { facts: facts(reparsed), fixedPoint: lib.printSync(reparsed) === printed },
  };
  if (arithBounds) {
    // Snapshot bounds of every BinaryArithm, ordered by operator offset.
    const operators = [];
    lib.walk(file, (node) => {
      if (node?.Type === 'BinaryArithm') operators.push(node);
      return true;
    });
    operators.sort((a, b) => a.OpPos.Offset - b.OpPos.Offset);
    report.arithBounds = operators.map((node) => {
      const bounds = result.Positions.get(node);
      return [bounds.Pos.Offset, bounds.End.Offset];
    });
  }
  if (clone) {
    try {
      structuredClone(file);
      report.clone = 'ok';
    } catch (error) {
      report.clone = error.name;
    }
    report.afterClone = lib.parseSync('echo still-usable').Type;
  }
} catch (error) {
  if (error instanceof RangeError) {
    report = { outcome: 'RangeError', message: String(error.message) };
  } else if (error instanceof lib.ShParseMaxDepthError) {
    report = {
      outcome: 'refused',
      name: error.name,
      code: error.code,
      maxDepth: error.maxDepth,
      estimatedDepth: error.estimatedDepth,
      partialFile: 'partialFile' in error,
      subsequent: lib.parseSync('echo still-usable').Type,
    };
  } else {
    report = {
      outcome: 'error',
      name: error.name,
      code: error.code,
      message: String(error.message),
    };
  }
}
console.log(JSON.stringify(report));
