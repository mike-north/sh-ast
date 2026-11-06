/** SplitBraces accepts a mutable faithful Word and returns synchronously. */
import { expectError, expectNotAssignable, expectType } from 'tsd';
import { splitBraces, type File, type Word } from '../src/index.js';

declare const word: Word;
declare const file: File;
expectType<boolean>(splitBraces(word));
expectNotAssignable<Promise<boolean>>(splitBraces(word));
expectError(splitBraces(file));
expectError(splitBraces(null));
