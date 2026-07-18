/**
 * `sh-ast/analyze` — the static-analysis layer built on top of the
 * normalized AST from the package root. Its first primitive,
 * {@link resolveWord}, answers "is this word statically a known string,
 * and if so which?" — the question every downstream lint rule or command
 * inventory asks first. Its second, {@link enumerateCommands}, answers
 * "where are all the commands, and how is each one reached?" — finding
 * every `CallExpr` anywhere in the tree, including ones hidden inside
 * command/process substitutions nested in words. Its third,
 * {@link resolveArgv0}, answers "what command is *actually* run, once
 * transparent wrappers like `env`/`sudo`/`nohup` are followed?" — argv0
 * alone is trivially spoofable through those, so this is the question a
 * permission/policy check must ask instead. Facts only: no policy, no
 * hardcoded command/wrapper lists beyond documented, overridable defaults
 * (see {@link WordResolution}'s, {@link CommandSite}'s, and
 * {@link Argv0Resolution}'s doc comments).
 */

export { resolveWord } from './resolve-word.js';
export type { ResolveWordOptions, WordResolution, WordResolutionReason } from './resolve-word.js';

export { enumerateCommands } from './enumerate-commands.js';
export type { CommandContext, CommandSite } from './enumerate-commands.js';

export { DEFAULT_TRANSPARENT_WRAPPERS, resolveArgv0 } from './resolve-argv0.js';
export type {
  Argv0ChainWord,
  Argv0Resolution,
  Argv0UnresolvedReason,
  Argv0UnresolvedWord,
  ResolveArgv0Options,
  WrapperSpec,
} from './resolve-argv0.js';

// Re-exported from the root errors module so a consumer of enumerateCommands/
// resolveArgv0 can `import { ShAnalyzeMaxDepthError } from 'sh-ast/analyze'`
// without also reaching into the root `sh-ast` entry point.
export { ShAnalyzeInvalidWrapperSpecError, ShAnalyzeMaxDepthError } from '../errors.js';

// `ShNode` (resolveWord's parameter type) is deliberately *not* re-exported
// here: it's the root `sh-ast` entry point's type (see `sh-ast`'s own
// `index.ts`), and every caller of `resolveWord` already has a `ShNode` in
// hand from `parseSync`/`walk` there. This is a known, intentional
// "ae-forgotten-export" in this subpath's api-report — `sh-ast/analyze`
// consumes the root layer's type without re-exporting it, rather than
// re-exporting it (and its own transitive doc-linked types) just to
// silence API Extractor.
