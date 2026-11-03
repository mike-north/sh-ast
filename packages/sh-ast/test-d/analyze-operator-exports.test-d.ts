/** This consumer names and constructs faithful operators using only the analyze subpath. */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import { AndStmt, Pipe, rawOperator, RdrOut, TsReMatch } from 'sh-ast/analyze';
import type {
  BinaryCmd,
  BinCmdOperator,
  BinTestOperator,
  RawOperator,
  RedirOperator,
} from 'sh-ast/analyze';

declare const command: BinaryCmd;
expectType<boolean>(command.Op === AndStmt);
if (command.Op === Pipe) {
  // An explicitly branded raw value may equal a named token numerically.
  expectType<typeof Pipe | RawOperator<'BinCmdOperator'>>(command.Op);
}
expectAssignable<BinCmdOperator>(AndStmt);
expectAssignable<BinCmdOperator>(Pipe);
expectAssignable<RedirOperator>(RdrOut);
expectAssignable<BinTestOperator>(TsReMatch);
expectType<RawOperator<'BinCmdOperator'>>(rawOperator('BinCmdOperator', 500));
expectAssignable<BinCmdOperator>(rawOperator('BinCmdOperator', 500));
expectNotAssignable<BinCmdOperator>(rawOperator('RedirOperator', 500));
expectError((command.Op = rawOperator('RedirOperator', 500)));
expectError(rawOperator('UnknownFamily', 1));
