/**
 * Public entry-point contracts for the faithful syntax interface. Assertions
 * describe caller capabilities and rejected misuse, rather than a generated
 * schema's self-consistency.
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import {
  InputError,
  LangBash,
  LangError,
  ParseError,
  RdrOut,
  ShAstError,
  SYNTAX_SCHEMA,
  newPos,
  nodeEnd,
  nodePos,
  parseSync,
  rawOperator,
  type File,
  type GoString,
  type Node,
  type ParseOptions,
  type Redirect,
  type SyntaxPos,
} from '../src/index.js';

expectType<File>(parseSync('echo hi'));
expectType<File>(parseSync(new Uint8Array([0x23]), { KeepComments: true }));
expectType<File>(parseSync('echo', { Variant: LangBash, RecoverErrors: 2n, Filename: 'a.sh' }));
expectAssignable<ParseOptions>({ StopAt: new Uint8Array([0xff]), KeepComments: false });
expectError(parseSync('echo', { dialect: 'bash' }));
expectError(parseSync('echo', { KeepComments: 'true' }));
expectError(parseSync(42));

const file = parseSync('echo hi');
expectType<GoString>(file.Name);
file.Name = 'new.sh';
file.Stmts = null;
file.Stmts = [];
expectError(file.stmts);
expectError(file.Pos);
expectError(file.End);
expectError(file.nonexistentField);
expectAssignable<Node>(file);
expectType<SyntaxPos>(nodePos(file));
expectType<SyntaxPos>(nodeEnd(file));
expectType<SyntaxPos>(newPos(2n ** 64n - 1n, 1, 1));
expectType<boolean>(nodePos(file).OffsetOverflow);

declare let redirect: Redirect;
redirect.Op = RdrOut;
redirect.Op = 0;
redirect.Op = rawOperator('RedirOperator', 0xffffffff);
expectError((redirect.Op = rawOperator('BinCmdOperator', 13)));
expectError((redirect.Op = 1.5));
expectError(rawOperator('UnknownFamily', 1));
expectError((SYNTAX_SCHEMA.File.node = false));
expectError((SYNTAX_SCHEMA.File.fields.Name.kind = 'boolean'));

declare const parseError: ParseError;
expectAssignable<ShAstError>(parseError);
expectType<GoString>(parseError.Message);
expectType<GoString>(parseError.Text);
expectType<SyntaxPos>(parseError.Pos);
expectType<boolean>(parseError.Incomplete);
expectType<File | null>(parseError.File);
expectError(parseError.column);

declare const languageError: LangError;
expectAssignable<ShAstError>(languageError);
expectType<readonly number[]>(languageError.Langs);
expectType<number>(languageError.LangUsed);
expectNotAssignable<ParseError>(languageError);
expectAssignable<ShAstError>(new InputError('invalid operation input'));
