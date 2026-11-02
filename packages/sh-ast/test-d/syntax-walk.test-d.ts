/* eslint-disable @typescript-eslint/no-confusing-void-expression, @typescript-eslint/no-invalid-void-type -- tsd must inspect void-returning expressions and rejected calls. */
/** Walk accepts every faithful Node and exposes nullable entries/exits without widening the return type. */
import { expectError, expectType } from 'tsd';
import type { GoString, Node } from '../generated/syntax-types.js';
import { ShAstError } from '../src/errors.js';
import { walk, WalkPanicError } from '../src/syntax-walk.js';

declare const node: Node;
expectType<void>(
  walk(node, (entry) => {
    expectType<Node | null>(entry);
    return entry?.Type !== 'CallExpr';
  }),
);
expectType<void>(walk({ Type: 'TypedNil', Kind: 'Word' }, () => false));
expectError(walk(null, () => true));
expectError(walk(node, () => undefined));
expectError(walk(node, (_entry: Node) => true));
expectError(walk(node, () => Promise.resolve(true)));
const failure = new WalkPanicError(new Uint8Array([255]));
expectType<GoString>(failure.Message);
expectType<'SH_AST_WALK_PANIC'>(failure.code);
const base: ShAstError = failure;
expectType<ShAstError>(base);
