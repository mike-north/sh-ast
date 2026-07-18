/**
 * Type-level coverage for `sh-ast/analyze`'s public API surface —
 * criterion 4 of https://github.com/mike-north/eslint-sh/issues/3,
 * criterion 5 of https://github.com/mike-north/eslint-sh/issues/4, and
 * criterion 6 of https://github.com/mike-north/eslint-sh/issues/5.
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import {
  DEFAULT_TRANSPARENT_WRAPPERS,
  enumerateCommands,
  resolveArgv0,
  resolveWord,
} from '../src/analyze/index.js';
import type {
  Argv0ChainWord,
  Argv0Resolution,
  Argv0UnresolvedReason,
  Argv0UnresolvedWord,
  CommandContext,
  CommandSite,
  ResolveArgv0Options,
  ResolveWordOptions,
  WordResolution,
  WordResolutionReason,
  WrapperSpec,
} from '../src/analyze/index.js';
import type { ShNode, ShNodes } from '../src/index.js';

declare const word: ShNodes.ShWordNode;
declare const node: ShNode;

// resolveWord accepts a Word node (or any ShNode-typed value — the runtime
// check on `.type` is not expressible at the type level) and always
// returns WordResolution.
expectType<WordResolution>(resolveWord(word));
expectType<WordResolution>(resolveWord(node));

// resolveWord requires an ShNode argument — arbitrary values are rejected.
expectError(resolveWord(42));
expectError(resolveWord('rm'));
expectError(resolveWord(undefined));
expectError(resolveWord());

// resolveWord's second parameter (ResolveWordOptions) is optional, and
// accepts only the two documented context values.
expectType<WordResolution>(resolveWord(word, {}));
expectType<WordResolution>(resolveWord(word, { context: 'command-argument' }));
expectType<WordResolution>(resolveWord(word, { context: 'assignment-value' }));
expectError(resolveWord(word, { context: 'nonsense' }));
expectAssignable<ResolveWordOptions>({});
expectAssignable<ResolveWordOptions>({ context: 'command-argument' });
expectAssignable<ResolveWordOptions>({ context: 'assignment-value' });
expectNotAssignable<ResolveWordOptions>({ context: 'nonsense' });

// WordResolution is a discriminated union on `static`.
declare const result: WordResolution;
if (result.static) {
  expectType<true>(result.static);
  expectType<string>(result.text);
  // `reason` doesn't exist on the static:true branch.
  expectError(result.reason);
} else {
  expectType<false>(result.static);
  expectType<WordResolutionReason>(result.reason);
  // `text` doesn't exist on the static:false branch.
  expectError(result.text);
}

// Both branches are readonly by contract, matching this package's other
// public result shapes (ShNode/ShFile in ../src/index.js).
if (result.static) {
  expectError((result.text = 'x'));
  expectError((result.static = false));
} else {
  expectError((result.reason = 'tilde'));
  expectError((result.static = true));
}

// Valid construction of both branches.
expectAssignable<WordResolution>({ static: true, text: 'rm' });
expectAssignable<WordResolution>({ static: false, reason: 'expansion' });
expectAssignable<WordResolution>({ static: false, reason: 'tilde' });
expectAssignable<WordResolution>({ static: false, reason: 'glob' });
expectAssignable<WordResolution>({ static: false, reason: 'brace' });
expectAssignable<WordResolution>({ static: false, reason: 'locale' });
expectAssignable<WordResolution>({ static: false, reason: 'unsupported' });

// Invalid construction: wrong shape for each branch.
expectError<WordResolution>({ static: true, reason: 'expansion' });
expectError<WordResolution>({ static: false, text: 'rm' });
expectError<WordResolution>({ static: true, text: 42 });
// An unrecognized reason string is not a valid WordResolutionReason.
expectError<WordResolution>({ static: false, reason: 'nonsense' });

// WordResolutionReason is exactly this closed set of string literals.
expectAssignable<WordResolutionReason>('expansion');
expectAssignable<WordResolutionReason>('tilde');
expectAssignable<WordResolutionReason>('glob');
expectAssignable<WordResolutionReason>('brace');
expectAssignable<WordResolutionReason>('locale');
expectAssignable<WordResolutionReason>('unsupported');
expectNotAssignable<WordResolutionReason>('nonsense');
expectNotAssignable<WordResolutionReason>('unknown');

// A forward-compatible exhaustive switch over `.reason` should compile
// with a `default` case (see WordResolutionReason's semver-policy doc
// comment) — this pins that the type itself doesn't force enumerating
// every member without one.
declare const reason: WordResolutionReason;
switch (reason) {
  case 'expansion':
  case 'tilde':
  case 'glob':
  case 'brace':
  case 'locale':
  case 'unsupported':
    break;
  default:
    break;
}

// enumerateCommands accepts any ShNode (typically a File, but any subtree
// is handled) and always returns an array of CommandSite.
declare const file: ShNodes.ShFileNode;
expectType<CommandSite[]>(enumerateCommands(file));
expectType<CommandSite[]>(enumerateCommands(node));

// enumerateCommands requires an ShNode argument — arbitrary values are
// rejected (unlike resolveWord, there is no runtime `.type` check to
// express here either, but the parameter type itself is still enforced).
expectError(enumerateCommands(42));
expectError(enumerateCommands('rm'));
expectError(enumerateCommands(undefined));
expectError(enumerateCommands());

// CommandSite's shape: node/argv0/argv/context, all readonly.
declare const site: CommandSite;
expectType<ShNode>(site.node);
expectType<WordResolution>(site.argv0);
expectType<readonly WordResolution[]>(site.argv);
expectType<readonly CommandContext[]>(site.context);
expectError((site.node = node));
expectError((site.argv0 = { static: true, text: 'rm' }));
expectError((site.argv = []));
expectError((site.context = []));

// Valid construction of a CommandSite.
expectAssignable<CommandSite>({
  node,
  argv0: { static: true, text: 'rm' },
  argv: [{ static: true, text: 'rm' }],
  context: [],
});

// Invalid construction: missing/wrong-shaped fields.
expectError<CommandSite>({ argv0: { static: true, text: 'rm' }, argv: [], context: [] });
expectError<CommandSite>({ node, argv0: { static: true, text: 'rm' }, argv: [], context: 'bad' });

// CommandContext is a discriminated union on `kind` — every documented
// variant is assignable, and each variant's extra fields are required and
// correctly shaped.
expectAssignable<CommandContext>({ kind: 'and', side: 'right' });
expectAssignable<CommandContext>({ kind: 'or', side: 'right' });
expectAssignable<CommandContext>({ kind: 'pipeline', stage: 0 });
expectAssignable<CommandContext>({ kind: 'subshell' });
expectAssignable<CommandContext>({ kind: 'cmdSubst' });
expectAssignable<CommandContext>({ kind: 'procSubst' });
expectAssignable<CommandContext>({ kind: 'if', branch: 'cond' });
expectAssignable<CommandContext>({ kind: 'if', branch: 'then' });
expectAssignable<CommandContext>({ kind: 'if', branch: 'else' });
expectAssignable<CommandContext>({ kind: 'case' });
expectAssignable<CommandContext>({ kind: 'loop', role: 'body' });
expectAssignable<CommandContext>({ kind: 'loop', role: 'cond' });
expectAssignable<CommandContext>({ kind: 'function', name: 'greet' });
expectAssignable<CommandContext>({ kind: 'background' });
expectAssignable<CommandContext>({ kind: 'negated' });
expectAssignable<CommandContext>({ kind: 'coproc' });

// Invalid CommandContext variants: wrong `side`/`branch`/`role` literal,
// missing required extra field, unrecognized `kind`.
expectError<CommandContext>({ kind: 'and', side: 'left' });
expectError<CommandContext>({ kind: 'and' });
expectError<CommandContext>({ kind: 'pipeline' });
expectError<CommandContext>({ kind: 'pipeline', stage: 'first' });
expectError<CommandContext>({ kind: 'if', branch: 'body' });
expectError<CommandContext>({ kind: 'loop', role: 'else' });
expectError<CommandContext>({ kind: 'function' });
expectError<CommandContext>({ kind: 'nonsense' });

// A `CommandContext` frame is readonly.
declare const frame: CommandContext;
if (frame.kind === 'pipeline') {
  expectError((frame.stage = 1));
}

// A forward-compatible exhaustive switch over `.kind` should compile with
// a `default` case (see CommandContext's semver-policy doc comment,
// mirroring WordResolutionReason's above) — this pins that the type
// itself doesn't force enumerating every member without one.
switch (frame.kind) {
  case 'and':
  case 'or':
  case 'pipeline':
  case 'subshell':
  case 'cmdSubst':
  case 'procSubst':
  case 'if':
  case 'case':
  case 'loop':
  case 'function':
  case 'background':
  case 'negated':
  case 'coproc':
    break;
  default:
    break;
}

// resolveArgv0 accepts a CommandSite and an optional ResolveArgv0Options,
// always returning an Argv0Resolution.
expectType<Argv0Resolution>(resolveArgv0(site));
expectType<Argv0Resolution>(resolveArgv0(site, {}));
expectType<Argv0Resolution>(resolveArgv0(site, { transparentWrappers: [] }));
expectType<Argv0Resolution>(
  resolveArgv0(site, { transparentWrappers: DEFAULT_TRANSPARENT_WRAPPERS }),
);

// resolveArgv0 requires a CommandSite argument — arbitrary values are
// rejected.
expectError(resolveArgv0(42));
expectError(resolveArgv0('rm'));
expectError(resolveArgv0(undefined));
expectError(resolveArgv0());

// ResolveArgv0Options.transparentWrappers must be an array of WrapperSpec.
expectAssignable<ResolveArgv0Options>({});
expectAssignable<ResolveArgv0Options>({ transparentWrappers: [] });
expectAssignable<ResolveArgv0Options>({ transparentWrappers: [{ names: ['with-retry'] }] });
expectNotAssignable<ResolveArgv0Options>({ transparentWrappers: ['env'] });

// DEFAULT_TRANSPARENT_WRAPPERS is exported as a readonly WrapperSpec array
// (data, not a class or a fixed tuple) and is directly usable as a base to
// extend or filter — see criterion 4 (configurability).
expectType<readonly WrapperSpec[]>(DEFAULT_TRANSPARENT_WRAPPERS);
expectType<WrapperSpec[]>([...DEFAULT_TRANSPARENT_WRAPPERS, { names: ['with-retry'] }]);
expectType<WrapperSpec[]>(DEFAULT_TRANSPARENT_WRAPPERS.filter((w) => !w.names.includes('env')));

// Argv0Resolution's shape: chain/effective/assignmentsSkipped, all readonly.
declare const resolution: Argv0Resolution;
expectType<readonly Argv0ChainWord[]>(resolution.chain);
expectType<Argv0ChainWord>(resolution.effective);
expectType<number>(resolution.assignmentsSkipped);
expectError((resolution.chain = []));
expectError((resolution.effective = { static: true, text: 'rm' }));
expectError((resolution.assignmentsSkipped = 0));

// Valid construction of an Argv0Resolution.
expectAssignable<Argv0Resolution>({
  chain: [{ static: true, text: 'rm' }],
  effective: { static: true, text: 'rm' },
  assignmentsSkipped: 0,
});

// Invalid construction: missing/wrong-shaped fields.
expectError<Argv0Resolution>({ effective: { static: true, text: 'rm' }, assignmentsSkipped: 0 });
expectError<Argv0Resolution>({
  chain: [{ static: true, text: 'rm' }],
  effective: { static: true, text: 'rm' },
  assignmentsSkipped: 'zero',
});

// Argv0ChainWord is WordResolution widened with Argv0UnresolvedWord — an
// ordinary WordResolution is still assignable, and so is the new shape.
expectAssignable<Argv0ChainWord>({ static: true, text: 'rm' });
expectAssignable<Argv0ChainWord>({ static: false, reason: 'expansion' });
expectAssignable<Argv0ChainWord>({ static: false, reason: 'unknown-flag' });
expectAssignable<Argv0ChainWord>({ static: false, reason: 'embedded-command' });

// Argv0UnresolvedWord and Argv0UnresolvedReason are exactly this closed set.
expectAssignable<Argv0UnresolvedWord>({ static: false, reason: 'unknown-flag' });
expectAssignable<Argv0UnresolvedWord>({ static: false, reason: 'embedded-command' });
expectError<Argv0UnresolvedWord>({ static: false, reason: 'expansion' });
expectError<Argv0UnresolvedWord>({ static: true, text: 'rm' });
expectAssignable<Argv0UnresolvedReason>('unknown-flag');
expectAssignable<Argv0UnresolvedReason>('embedded-command');
expectNotAssignable<Argv0UnresolvedReason>('expansion');
expectNotAssignable<Argv0UnresolvedReason>('nonsense');

// A forward-compatible exhaustive switch over Argv0UnresolvedReason should
// compile with a `default` case (mirroring WordResolutionReason's and
// CommandContext's semver-policy pattern above).
declare const argv0Reason: Argv0UnresolvedReason;
switch (argv0Reason) {
  case 'unknown-flag':
  case 'embedded-command':
    break;
  default:
    break;
}

// WrapperSpec's shape: only `names` is required; the rest are optional and
// individually typed.
expectAssignable<WrapperSpec>({ names: ['env'] });
expectAssignable<WrapperSpec>({
  names: ['env'],
  skipAssignmentOperands: true,
  noArgFlags: ['-i'],
  argFlags: ['-u'],
  unresolvableFlags: ['-S'],
  stopsChainFlags: ['-v'],
  positionalOperandsBeforeCommand: 1,
});
expectAssignable<WrapperSpec>({ names: ['nice'], noArgFlagPattern: /^-\d+$/ });
expectError<WrapperSpec>({});
expectError<WrapperSpec>({ names: 'env' });
expectError<WrapperSpec>({ names: ['env'], noArgFlags: 'env' });
expectError<WrapperSpec>({ names: ['env'], unresolvableFlags: 'env' });
expectError<WrapperSpec>({ names: ['env'], stopsChainFlags: 'env' });
expectError<WrapperSpec>({ names: ['env'], positionalOperandsBeforeCommand: '1' });
