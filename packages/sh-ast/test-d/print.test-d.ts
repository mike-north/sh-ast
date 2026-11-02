/** Collected printing accepts upstream Nodes and exact options, and returns Go bytes when necessary. */
import { expectError, expectType } from 'tsd';
import {
  printSync,
  PrintError,
  PrintPanicError,
  type PrintOptions,
  type GoString,
  type Node,
} from 'sh-ast';

declare const node: Node;
expectType<GoString>(printSync(node));
const options: PrintOptions = {
  Indent: 1n,
  BinaryNextLine: true,
  SwitchCaseIndent: true,
  SpaceRedirects: true,
  KeepPadding: true,
  Minify: false,
  SingleLine: true,
  FunctionNextLine: true,
};
expectType<GoString>(printSync(node, options));
expectType<GoString>(new PrintError('failure').Message);
expectType<'SH_AST_SYNTAX_PRINT'>(new PrintError('failure').code);
expectType<GoString>(new PrintPanicError(new Uint8Array()).Message);
expectType<'SH_AST_SYNTAX_PRINT_PANIC'>(new PrintPanicError('failure').code);
expectError(printSync(node, { Indent: 'two' }));
expectError(printSync(node, { Minify: 1 }));
expectError(printSync(node, { SingleLine: undefined }));
expectError(printSync(node, { unknown: true }));
expectError(printSync({ Type: 'Slice', Offset: null, Length: null }));
expectError(printSync({ Type: 'File' }));
expectError(printSync(null));
