// Full public call in the real ESLint language dispatch; no split-phase timing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as lib from '../../../packages/sh-ast/dist/index.js';
const consumerRoot = resolve(process.argv[2]);
const { Linter } = await import(
  pathToFileURL(resolve(consumerRoot, 'node_modules/eslint/lib/api.js')).href
);
const { ShellLanguage } = await import(
  pathToFileURL(resolve(consumerRoot, 'dist/language/shell-language.js')).href
);
const spec = JSON.parse(readFileSync(0, 'utf8'));
/** Calls the public synchronous export and checks reuse only after typed refusal. */
function run() {
  try {
    const result = lib[spec.operation ?? 'parseSync'](
      spec.bytes ? new TextEncoder().encode(spec.source) : spec.source,
      {
        KeepComments: spec.keepComments ?? true,
        RecoverErrors: spec.recoverErrors ?? 0,
        Variant: spec.variant ?? lib.LangBash,
      },
    );
    return { outcome: (result.File ?? result).Type };
  } catch (e) {
    let reuse;
    if (e instanceof lib.ShParseMaxDepthError) reuse = lib.parseSync('echo alive').Type;
    return {
      outcome: e.name,
      code: e.code,
      maxDepth: e.maxDepth,
      estimatedDepth: e.estimatedDepth,
      reuse,
    };
  }
}
// Return a controlled ESLint diagnostic after capture to exclude downstream AST traversal.
let result;
let first;
let changed = false;
let iterations = 0;
const language = new ShellLanguage();
language.parse = function () {
  result = run();
  return { ok: false, errors: [{ message: 'probe complete', line: 1, column: 1 }] };
};
const linter = new Linter();
for (let i = 0; i < (spec.repeats ?? 20); i++) {
  if (spec.caller === 'eslint')
    linter.verify(
      spec.source,
      [
        {
          files: ['**/*.sh'],
          plugins: { probe: { languages: { sh: language } } },
          language: 'probe/sh',
        },
      ],
      { filename: 'probe.sh' },
    );
  else result = run();
  iterations++;
  first ??= result;
  if (result.outcome !== first.outcome) changed = true;
  if (result.outcome === 'RangeError') break;
}
console.log(
  JSON.stringify({
    name: spec.name,
    n: spec.n,
    operation: spec.operation ?? 'parseSync',
    expected: spec.expected,
    oldExpected: spec.oldExpected,
    minimumBudget: spec.minimumBudget,
    recoverErrors: spec.recoverErrors ?? 0,
    iterations,
    changed,
    ...result,
  }),
);
