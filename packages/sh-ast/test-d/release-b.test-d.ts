/* eslint-disable @typescript-eslint/no-confusing-void-expression, @typescript-eslint/no-invalid-void-type -- tsd must inspect the synchronous void return and rejected calls. */
/** The root entry exposes synchronous upstream traversal and exact-byte printing. */
import { expectError, expectType } from 'tsd';
import {
  parseSync,
  printSync,
  walk,
  PrintError,
  PrintPanicError,
  WalkPanicError,
  type GoString,
  type Node,
  type PrintOptions,
} from 'sh-ast';

const file = parseSync('echo hi');
expectType<void>(
  walk(file, (node) => {
    expectType<Node | null>(node);
    return true;
  }),
);
expectType<GoString>(printSync(file));
const options: PrintOptions = {
  Indent: 2n,
  BinaryNextLine: false,
  SwitchCaseIndent: true,
  SpaceRedirects: true,
  KeepPadding: false,
  Minify: false,
  SingleLine: true,
  FunctionNextLine: false,
};
expectType<GoString>(printSync(file, options));
expectType<GoString>(new PrintError('unsupported').Message);
expectType<GoString>(new PrintPanicError('upstream panic').Message);
expectType<GoString>(new WalkPanicError('upstream panic').Message);
expectError(walk(file, () => Promise.resolve(true)));
expectError(walk(file, () => undefined));
expectError(printSync(file, { Indent: '2' }));
expectError(printSync(file, { Minify: 1 }));
expectError(printSync(file, { UnknownOption: true }));
