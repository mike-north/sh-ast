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
// without also reaching into the root `sh-ast` entry point. `ShAstError`
// is the shared base every analyze-layer error extends (see
// `ShAnalyzeMaxDepthError`, `ShAnalyzeInvalidWrapperSpecError`), so it's
// re-exported here too — otherwise a consumer could not `catch`/reference
// the base class without also importing from the root `sh-ast` entry point
// (see #23).
export {
  ShAnalyzeInvalidWrapperSpecError,
  ShAnalyzeMaxDepthError,
  ShAstError,
} from '../errors.js';

// `ShNode` (resolveWord's/enumerateCommands's parameter and CommandSite.node
// type) is re-exported here for the same reason as `ShAstError` above:
// consistency, so a consumer of `sh-ast/analyze` can reference every type
// its public surface mentions without also reaching into the root `sh-ast`
// entry point (see #23). `Position` is re-exported alongside it because
// `ShNode.loc` is defined in terms of it — re-exporting `ShNode` without it
// would just trade one ae-forgotten-export warning for another.
export type { Position, ShNode } from '../types.js';
