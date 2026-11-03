/** Public entry points share faithful values and preserve operator-family distinctions. */
import { expectAssignable, expectNotAssignable, expectType } from 'tsd';
import { rawOperator } from 'sh-ast/analyze';
import type { BinCmdOperator, File, Node } from 'sh-ast/analyze';
import { enumerateCommands, resolveWord } from 'sh-ast/analyze';
import type {
  CallExpr,
  CommandContext,
  CommandSite,
  GoString,
  WordResolution,
} from 'sh-ast/analyze';

declare const file: File;
declare const node: Node;
expectType<CommandSite[]>(enumerateCommands(file));
expectType<WordResolution>(resolveWord(node));
expectAssignable<Node>(enumerateCommands(file)[0].node);
expectType<CallExpr>(enumerateCommands(file)[0].node);
expectAssignable<BinCmdOperator>(rawOperator('BinCmdOperator', 500));
expectNotAssignable<BinCmdOperator>(rawOperator('BinAritOperator', 500));
declare const frame: Extract<CommandContext, { kind: 'function' }>;
expectType<GoString>(frame.name);
