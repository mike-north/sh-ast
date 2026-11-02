/**
 * Public faithful syntax records retain the pinned Go model: all fields are
 * present, nil differs from an empty collection, and auxiliary records are not
 * syntax nodes. These assertions describe intended usage rather than generated
 * schema self-consistency.
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import type {
  Command,
  File,
  GoString,
  Node,
  ParamExp,
  Redirect,
  Slice,
  Stmt,
  SyntaxPos,
} from '../generated/syntax-types.js';
import {
  CmdIn,
  LangAuto,
  LangBash,
  RdrOut,
  type LangVariant,
  type RawOperator,
  type RedirOperator,
} from '../generated/syntax-constants.js';
import { SYNTAX_INTERFACES, SYNTAX_SCHEMA } from '../generated/syntax-schema.js';

declare let file: File;
expectAssignable<File>({ Type: 'File', Name: '', Stmts: null, Last: [] });
expectNotAssignable<File>({ Type: 'File', Stmts: null, Last: [] });
expectType<(Stmt | null)[] | null>(file.Stmts);
expectType<GoString>(file.Name);
file.Name = 'changed.sh';
file.Stmts = [];
file.Stmts = null;
expectError(file.stmts);
expectError(file.Pos);
expectError(file.End);

declare const statement: Stmt;
expectType<boolean>(statement.Background);
expectType<Command | null>(statement.Cmd);
expectType<SyntaxPos>(statement.Semicolon);
expectType<boolean>(statement.Semicolon.IsRecovered);
expectType<boolean>(statement.Semicolon.OffsetOverflow);
expectAssignable<Node>(statement);

declare const parameter: ParamExp;
expectType<Slice | null>(parameter.Slice);
declare const slice: Slice;
expectNotAssignable<Node>(slice);
expectError(slice.Pos);

declare let redirect: Redirect;
redirect.Op = RdrOut;
redirect.Op = 0;
expectNotAssignable<RedirOperator>(CmdIn);
expectNotAssignable<RedirOperator>(0xffffffff);
expectNotAssignable<RedirOperator>(1.5);
declare const rawRedirection: RawOperator<'RedirOperator'>;
declare const rawProcess: RawOperator<'ProcOperator'>;
expectAssignable<RedirOperator>(rawRedirection);
expectNotAssignable<RedirOperator>(rawProcess);

expectAssignable<LangVariant>(LangBash);
expectAssignable<LangVariant>(LangAuto);
expectAssignable<LangVariant>(0);
expectNotAssignable<LangVariant>(-1);
expectAssignable<GoString>('literal 🎉');
expectAssignable<GoString>(new Uint8Array([0xff]));

// Shared reflection metadata is immutable even though the represented AST is
// editable; a consumer must not rewrite validation/traversal interpretation.
expectError((SYNTAX_SCHEMA.File.node = false));
expectError((SYNTAX_SCHEMA.File.fields.Name.kind = 'boolean'));
expectError((SYNTAX_SCHEMA.File.fields = {}));
expectError((SYNTAX_INTERFACES.Node = []));
expectError((SYNTAX_INTERFACES.Node[0] = 'Slice'));
