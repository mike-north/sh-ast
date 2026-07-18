/**
 * Type-level coverage for the public API surface in design/PACKAGES.md
 * §`sh-ast`.
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import {
  parseSync,
  ShBridgeError,
  ShBridgeInternalError,
  ShInvalidDialectError,
  ShParseError,
  ShParseMaxDepthError,
  visitorKeys,
  walk,
  type ParseOptions,
  type ShellDialect,
  type ShFile,
  type ShNode,
  type ShNodes,
} from '../src/index.js';

expectType<ShFile>(parseSync('echo hi'));
expectType<ShFile>(parseSync('echo hi', {}));
expectType<ShFile>(parseSync('echo hi', { dialect: 'bash' }));
expectType<ShFile>(parseSync('echo hi', { filename: 'a.sh' }));

expectAssignable<ShellDialect>('bash');
expectAssignable<ShellDialect>('posix');
expectAssignable<ShellDialect>('mksh');
expectAssignable<ShellDialect>('bats');
expectAssignable<ShellDialect>('zsh');
// Not a recognized ShellDialect at the type level, even though the runtime
// also rejects it at the value level (criterion 5's "unknown dialect throws").
expectNotAssignable<ShellDialect>('fish');

expectAssignable<ParseOptions>({});
expectAssignable<ParseOptions>({ dialect: 'posix', filename: 'x.sh' });

const err = new ShParseError('bad', { line: 1, column: 1, filename: 'a.sh' });
expectType<string>(err.message);
expectType<number>(err.line);
expectType<number>(err.column);
expectType<string>(err.filename);
expectAssignable<Error>(err);
expectAssignable<ShBridgeError>(err);
expectType<'ESLINT_SH_PARSE_ERROR'>(err.code);

// The error taxonomy for https://github.com/mike-north/eslint-sh/issues/12:
// stable `code` discriminators and a common `ShBridgeError` base, on top of
// the usual `instanceof` narrowing.
const invalidDialectError = new ShInvalidDialectError('fish', ['bash', 'posix']);
expectType<'ESLINT_SH_INVALID_DIALECT'>(invalidDialectError.code);
expectType<string>(invalidDialectError.dialect);
expectAssignable<Error>(invalidDialectError);
expectAssignable<ShBridgeError>(invalidDialectError);
// Not assignable to ShParseError's more specific shape — no .line/.column.
expectNotAssignable<ShParseError>(invalidDialectError);

const internalError = new ShBridgeInternalError('bridge: something unexpected happened');
expectType<'ESLINT_SH_BRIDGE_INTERNAL'>(internalError.code);
expectAssignable<Error>(internalError);
expectAssignable<ShBridgeError>(internalError);
expectNotAssignable<ShParseError>(internalError);

const maxDepthError = new ShParseMaxDepthError(150, 151);
expectType<'ESLINT_SH_PARSE_MAX_DEPTH'>(maxDepthError.code);
expectType<number>(maxDepthError.maxDepth);
expectType<number>(maxDepthError.estimatedDepth);
expectAssignable<Error>(maxDepthError);
expectAssignable<ShBridgeError>(maxDepthError);
expectNotAssignable<ShParseError>(maxDepthError);

expectType<Readonly<Record<string, readonly string[]>>>(visitorKeys);

expectType<(node: ShNode, visit: (node: ShNode, parent: ShNode | null) => void) => void>(walk);

// The public node/position shape is readonly by contract, not convention.
const file = parseSync('echo hi');
expectError((file.stmts = []));
expectError((file.stmts[0] = file));
expectError((file.range[0] = 0));
expectError((file.loc.start.line = 2));
expectError((file.type = 'File'));

/**
 * Generated per-node typings (design/PACKAGES.md: "Full node typings
 * generated alongside visitorKeys") — a couple of representative shapes,
 * including the `DeclClause.Variant` regression (criterion 4 of issue #6:
 * https://github.com/mike-north/eslint-sh/issues/6). Readonly throughout,
 * matching `ShNode`/`ShFile`'s "readonly by contract" typing above.
 */
declare const declClause: ShNodes.ShDeclClauseNode;
expectType<'DeclClause'>(declClause.type);
expectAssignable<ShNode>(declClause);
expectType<ShNodes.ShLitNode | undefined>(declClause.variant);
expectError((declClause.variant = undefined));

declare const callExpr: ShNodes.ShCallExprNode;
expectType<'CallExpr'>(callExpr.type);
expectType<readonly ShNodes.ShWordNode[]>(callExpr.args);
expectError((callExpr.args = []));

declare const stmt: ShNodes.ShStmtNode;
expectType<ShNodes.ShCommandNode | undefined>(stmt.cmd);

expectAssignable<ShNodes.ShAnyNode>(declClause);
expectAssignable<ShNodes.ShAnyNode>(callExpr);
