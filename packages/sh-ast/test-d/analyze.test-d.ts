/**
 * Type-level coverage for `sh-ast/analyze`'s public API surface —
 * criterion 4 of https://github.com/mike-north/eslint-sh/issues/3.
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import { resolveWord } from '../src/analyze/index.js';
import type { WordResolution, WordResolutionReason } from '../src/analyze/index.js';
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
expectNotAssignable<WordResolutionReason>('nonsense');
expectNotAssignable<WordResolutionReason>('unknown');
