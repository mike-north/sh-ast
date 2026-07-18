/**
 * `sh-ast/analyze` — the static-analysis layer built on top of the
 * normalized AST from the package root. Its first primitive,
 * {@link resolveWord}, answers "is this word statically a known string,
 * and if so which?" — the question every downstream lint rule or command
 * inventory asks first. Facts only: no policy, no hardcoded
 * command/wrapper lists (see {@link WordResolution}'s doc comment).
 */

export { resolveWord } from './resolve-word.js';
export type { WordResolution, WordResolutionReason } from './resolve-word.js';

// `ShNode` (resolveWord's parameter type) is deliberately *not* re-exported
// here: it's the root `sh-ast` entry point's type (see `sh-ast`'s own
// `index.ts`), and every caller of `resolveWord` already has a `ShNode` in
// hand from `parseSync`/`walk` there. This is a known, intentional
// "ae-forgotten-export" in this subpath's api-report — `sh-ast/analyze`
// consumes the root layer's type without re-exporting it, rather than
// re-exporting it (and its own transitive doc-linked types) just to
// silence API Extractor.
