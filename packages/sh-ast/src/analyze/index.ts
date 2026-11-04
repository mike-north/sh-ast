/**
 * `sh-ast/analyze` — the static-analysis layer built on top of the
 * faithful upstream syntax records from the package root. Its first primitive,
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
 *
 * The subpath also exposes the faithful record and operator types it consumes,
 * every named operator constant referenced by those types, and rawOperator for
 * unnamed uint32 values. Analyze-only consumers can construct and compare these
 * values without importing the root entry point. Constants retain their upstream
 * family meanings; this adds no command policy or interpretation.
 */

export { resolveWord } from './resolve-word.js';
export type { ResolveWordOptions, WordResolution, WordResolutionReason } from './resolve-word.js';

export { enumerateCommands } from './enumerate-commands.js';
export type { CommandContext, CommandSite } from './enumerate-commands.js';

export {
  DEFAULT_EMBEDDED_COMMAND_INTERPRETERS,
  DEFAULT_TRANSPARENT_WRAPPERS,
  resolveArgv0,
} from './resolve-argv0.js';
export type {
  Argv0ChainWord,
  Argv0Resolution,
  Argv0UnresolvedReason,
  Argv0UnresolvedWord,
  EmbeddedCommandInterpreterSpec,
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
export { ShAnalyzeInvalidWrapperSpecError, ShAnalyzeMaxDepthError, ShAstError } from '../errors.js';

// Re-export faithful record types so analyze consumers can describe their inputs
// and retained command-node identities without a second entry-point import.
export type * from '../../generated/syntax-types.js';
export type {
  BinAritOperator,
  BinCmdOperator,
  BinTestOperator,
  CaseOperator,
  GlobOperator,
  OperatorFamily,
  ParExpOperator,
  ParNamesOperator,
  ProcOperator,
  RawOperator,
  RedirOperator,
  UnAritOperator,
  UnTestOperator,
} from '../../generated/syntax-constants.js';

// Re-export the values referenced by the retained operator unions directly from
// their definitions; the root barrel also owns unrelated parser/schema exports.
export {
  Add,
  AddAssgn,
  AlternateUnset,
  AlternateUnsetOrNull,
  And,
  AndArit,
  AndAssgn,
  AndBoolAssgn,
  AndStmt,
  AndTest,
  AppAll,
  AppAllClob,
  AppClob,
  AppOut,
  ArrayExclude,
  ArrayIntersect,
  Assgn,
  AssignUnset,
  AssignUnsetOrNull,
  BitNegation,
  Break,
  CmdIn,
  CmdInTemp,
  CmdOut,
  Comma,
  DashHdoc,
  Dec,
  DefaultUnset,
  DefaultUnsetOrNull,
  DplIn,
  DplOut,
  Eql,
  ErrorUnset,
  ErrorUnsetOrNull,
  Fallthrough,
  Geq,
  GlobExcept,
  GlobOne,
  GlobOneOrMore,
  GlobZeroOrMore,
  GlobZeroOrOne,
  Gtr,
  Hdoc,
  Inc,
  Leq,
  LowerAll,
  LowerFirst,
  Lss,
  MatchEmpty,
  Minus,
  Mul,
  MulAssgn,
  NamesPrefix,
  NamesPrefixWords,
  Neq,
  Not,
  Or,
  OrArit,
  OrAssgn,
  OrBoolAssgn,
  OrStmt,
  OrTest,
  OtherParamOps,
  Pipe,
  PipeAll,
  Plus,
  Pow,
  PowAssgn,
  Quo,
  QuoAssgn,
  RdrAll,
  RdrAllClob,
  RdrClob,
  RdrIn,
  RdrInOut,
  RdrOut,
  Rem,
  RemAssgn,
  RemLargePrefix,
  RemLargeSuffix,
  RemSmallPrefix,
  RemSmallSuffix,
  Resume,
  ResumeKorn,
  Shl,
  ShlAssgn,
  Shr,
  ShrAssgn,
  Sub,
  SubAssgn,
  TernColon,
  TernQuest,
  TsAfter,
  TsBefore,
  TsBlckSp,
  TsCharSp,
  TsDevIno,
  TsDirect,
  TsEmpStr,
  TsEql,
  TsExec,
  TsExists,
  TsFdTerm,
  TsGIDSet,
  TsGeq,
  TsGrpOwn,
  TsGtr,
  TsLeq,
  TsLss,
  TsMatch,
  TsMatchShort,
  TsModif,
  TsNempStr,
  TsNeq,
  TsNewer,
  TsNmPipe,
  TsNoEmpty,
  TsNoMatch,
  TsNot,
  TsOlder,
  TsOptSet,
  TsParen,
  TsReMatch,
  TsRead,
  TsRefVar,
  TsRegFile,
  TsSmbLink,
  TsSocket,
  TsSticky,
  TsUIDSet,
  TsUsrOwn,
  TsVarSet,
  TsWrite,
  UpperAll,
  UpperFirst,
  WordHdoc,
  Xor,
  XorAssgn,
  XorBool,
  XorBoolAssgn,
} from '../../generated/syntax-constants.js';
export { rawOperator } from '../syntax-operator.js';
