/** The published root declaration describes syntax capabilities without analysis aliases. */
import { expectNotAssignable } from 'tsd';
import * as syntax from 'sh-ast';

expectNotAssignable<keyof typeof syntax>('ShAnalyzeMaxDepthError');
expectNotAssignable<keyof typeof syntax>('ShAnalyzeInvalidWrapperSpecError');
expectNotAssignable<keyof typeof syntax>('resolveWord');
expectNotAssignable<keyof typeof syntax>('resolveArgv0');
expectNotAssignable<keyof typeof syntax>('enumerateCommands');
