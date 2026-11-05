/** This consumer names and constructs faithful operators using only the analyze subpath. */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import {
  AndStmt,
  OptUnset,
  OptOn,
  OptOff,
  Pipe,
  rawOperator,
  RdrOut,
  TsReMatch,
} from 'sh-ast/analyze';
import type {
  BinaryCmd,
  BinCmdOperator,
  BinTestOperator,
  OptState,
  ParamExp,
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

// Every required ParamExp state is nameable without importing the root entry.
declare const parameter: ParamExp;
expectType<OptState>(parameter.Split);
expectType<OptState>(parameter.GlobSubst);
expectType<OptState>(parameter.RcExpand);
expectType<0>(OptUnset);
expectType<1>(OptOn);
expectType<2>(OptOff);
expectAssignable<OptState>(OptUnset);
expectAssignable<OptState>(OptOn);
expectAssignable<OptState>(OptOff);
expectAssignable<OptState>(rawOperator('OptState', 255));
expectNotAssignable<OptState>(true);
expectNotAssignable<OptState>(256);
expectError((parameter.Split = rawOperator('RedirOperator', 1)));
