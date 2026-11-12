/**
 * The inputs the differential traversal tests run over: every shell source the existing
 * suite parses, parsed once per dialect that accepts it. Sources come from the kitchen-sink
 * fixtures, the walk oracle, the benchmark fixtures, and every string-literal argument the
 * test files pass to parseSync or parseWithPositionsSync (found with the TypeScript parser,
 * so the corpus follows the suite as it grows).
 */
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import type { File } from '../generated/syntax-types.js';
import { LangBash, LangBats, LangMirBSDKorn, LangPOSIX, LangZsh, parseSync } from '../src/index.js';

const testDirectory = new URL('./', import.meta.url);
const benchmarkFixtures = new URL('../../../tools/benchmark/fixtures/', import.meta.url);
const SELF = /^(iterative-traversal-|differential-corpus)/;

/** One parsed corpus entry. @internal */
export interface CorpusEntry {
  readonly label: string;
  readonly file: File;
}

/** Literal first arguments of parse calls in the existing test files. */
function literalsFromTests(): string[] {
  const sources: string[] = [];
  for (const name of readdirSync(testDirectory).filter((entry) => entry.endsWith('.ts'))) {
    if (SELF.test(name)) continue;
    const text = readFileSync(new URL(name, testDirectory), 'utf8');
    const tree = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'parseSync' || node.expression.text === 'parseWithPositionsSync')
      ) {
        if (node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]))
          sources.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return sources;
}

/** Whole-file shell sources kept as fixtures. */
function literalsFromFixtures(): string[] {
  const sources: string[] = [];
  for (const name of readdirSync(new URL('fixtures/', testDirectory))) {
    if (name.endsWith('.sh'))
      sources.push(readFileSync(new URL(`fixtures/${name}`, testDirectory), 'utf8'));
  }
  const oracle = JSON.parse(
    readFileSync(new URL('fixtures/walk-oracle.json', testDirectory), 'utf8'),
  ) as { cases: { source?: unknown }[] };
  for (const entry of oracle.cases)
    if (typeof entry.source === 'string') sources.push(entry.source);
  for (const name of readdirSync(benchmarkFixtures)) {
    const fixture = JSON.parse(readFileSync(new URL(name, benchmarkFixtures), 'utf8')) as {
      source?: unknown;
    };
    if (typeof fixture.source === 'string') sources.push(fixture.source);
  }
  return sources;
}

const VARIANTS = [
  ['bash', LangBash],
  ['posix', LangPOSIX],
  ['mksh', LangMirBSDKorn],
  ['bats', LangBats],
  ['zsh', LangZsh],
] as const;

/** Parses each distinct source under each dialect that accepts it, keeping comments. @internal */
export function buildCorpus(): CorpusEntry[] {
  const distinct = [...new Set([...literalsFromFixtures(), ...literalsFromTests()])];
  const corpus: CorpusEntry[] = [];
  distinct.forEach((source, index) => {
    for (const [name, Variant] of VARIANTS) {
      try {
        corpus.push({
          label: `source#${String(index)}/${name}`,
          file: parseSync(source, { Variant, KeepComments: true }),
        });
      } catch {
        // A source the dialect refuses is simply not an input for that dialect.
      }
    }
  });
  return corpus;
}
