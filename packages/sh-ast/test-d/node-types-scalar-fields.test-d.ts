/**
 * Type-level coverage for https://github.com/mike-north/sh-ast/issues/22:
 * "Verify then fix: generated node types leave key fields as `unknown`
 * (e.g. `ShLitNode.value`), contradicting 'fully-typed' claim".
 *
 * Reproduction (documented in the PR body) found that every scalar leaf
 * field on a generated node — `bool`, `string`, and mvdan/sh's
 * `uint32`-backed operator-enum fields — fell through the generator's old
 * "only child/interface fields get concrete types" classification into the
 * `[field: string]: unknown` catch-all on `ShNode`. The `expectType`
 * assertions below fail against the pre-fix `node-types.d.ts` (each leaf
 * reports its exact type as `unknown`) and pass once
 * `tools/gen-visitor-keys` classifies scalar fields too.
 *
 * The negative assertions are written as `expectNotAssignable<typeof
 * node.field>(wrongValue)` — a value of an incompatible scalar type checked
 * against the field's own type. This direction fails while the field is
 * still `unknown` (everything is assignable to `unknown`, so the wrong value
 * would be accepted), so the negatives too are real reproduction guards, not
 * assertions that quietly pass against the pre-fix types. It also avoids
 * assigning to the readonly property, which would error on readonly-ness
 * regardless of the value type.
 *
 * `ShWordNode.parts` (also called out in the issue) was already correctly
 * typed as `readonly ShWordPartNode[]` before this fix — array/child fields
 * were never affected, only scalar leaves were — so it's asserted here only
 * as a non-regression check, not as a fixed case.
 */
import { expectNotAssignable, expectType } from 'tsd';
import type { ShNodes } from '../src/index.js';

// `ShLitNode.value` — the issue's anchor case. mvdan/sh's `Lit.Value` is a
// plain Go `string`; the shim copies it through unchanged.
declare const lit: ShNodes.ShLitNode;
expectType<string | undefined>(lit.value);
expectNotAssignable<typeof lit.value>(42);

// `ShFileNode.name` — another plain `string` leaf (mvdan/sh's `File.Name`).
declare const file: ShNodes.ShFileNode;
expectType<string | undefined>(file.name);
expectNotAssignable<typeof file.name>(42);

// `ShCommentNode.text` — plain `string` leaf (mvdan/sh's `Comment.Text`).
declare const comment: ShNodes.ShCommentNode;
expectType<string | undefined>(comment.text);
expectNotAssignable<typeof comment.text>(true);

// `ShSglQuotedNode` — a `string` leaf (`Value`) and a `bool` leaf
// (`Dollar`, the `$'...'` ANSI-C quoting flag) on the same node, per the
// issue's "quoted values" example.
declare const sglQuoted: ShNodes.ShSglQuotedNode;
expectType<string | undefined>(sglQuoted.value);
expectType<boolean | undefined>(sglQuoted.dollar);
expectNotAssignable<typeof sglQuoted.value>(42);
expectNotAssignable<typeof sglQuoted.dollar>('yes');

// `ShStmtNode` — plain `bool` leaves (`Negated`/`Background`/`Coprocess`/
// `Disown`); each asserted per-field so a regression on any one is caught.
declare const stmt: ShNodes.ShStmtNode;
expectType<boolean | undefined>(stmt.negated);
expectType<boolean | undefined>(stmt.background);
expectType<boolean | undefined>(stmt.coprocess);
expectType<boolean | undefined>(stmt.disown);
expectNotAssignable<typeof stmt.negated>('true');
expectNotAssignable<typeof stmt.background>('true');
expectNotAssignable<typeof stmt.coprocess>('true');
expectNotAssignable<typeof stmt.disown>('true');

// `ShWhileClauseNode.until` — another `bool` leaf, distinct node shape.
declare const whileClause: ShNodes.ShWhileClauseNode;
expectType<boolean | undefined>(whileClause.until);
expectNotAssignable<typeof whileClause.until>(1);

// Operator-enum fields (`RedirOperator`, `BinAritOperator`, `CaseOperator`,
// ...): mvdan/sh types these as named `uint32`-backed types that implement
// only `fmt.Stringer`, not `json.Marshaler` — the shim's typedjson-derived
// encoder therefore serializes them as plain JSON numbers, not strings, so
// the generated type is `number`, matching the actual wire shape rather
// than the Go type's nominal name.
declare const redirect: ShNodes.ShRedirectNode;
expectType<number | undefined>(redirect.op);
expectNotAssignable<typeof redirect.op>('clobber');

declare const binaryArithm: ShNodes.ShBinaryArithmNode;
expectType<number | undefined>(binaryArithm.op);
expectNotAssignable<typeof binaryArithm.op>('add');

declare const caseItem: ShNodes.ShCaseItemNode;
expectType<number | undefined>(caseItem.op);
expectNotAssignable<typeof caseItem.op>(';;');

// Non-regression: `ShWordNode.parts` was already concretely typed as an
// array of the `WordPart` child-interface union before this fix — array
// and node-reference fields were never routed through the `unknown`
// catch-all, only scalar leaves were.
declare const word: ShNodes.ShWordNode;
expectType<readonly ShNodes.ShWordPartNode[]>(word.parts);

// Non-regression: `ShAssignNode.name`/`.value` (also called out in the
// issue) were already concretely typed — mvdan/sh's `Assign.Name`/`.Value`
// are `*Lit`/`*Word`, real node references, not scalar leaves.
declare const assign: ShNodes.ShAssignNode;
expectType<ShNodes.ShLitNode | undefined>(assign.name);
expectType<ShNodes.ShWordNode | undefined>(assign.value);
// But `Assign.Append`/`.Naked` (`+=` and the no-`=` `declare` form) *are*
// scalar `bool` leaves, and were unknown pre-fix.
expectType<boolean | undefined>(assign.append);
expectType<boolean | undefined>(assign.naked);
expectNotAssignable<typeof assign.append>('yes');
expectNotAssignable<typeof assign.naked>('yes');
