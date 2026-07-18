/**
 * Type-level coverage for `sh-ast/analyze`'s public API surface —
 * criterion 4 of https://github.com/mike-north/eslint-sh/issues/3.
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import { resolveWord } from '../src/analyze/index.js';
import type {
  ResolveWordOptions,
  WordResolution,
  WordResolutionReason,
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
