/**
 * Type-level coverage for https://github.com/mike-north/sh-ast/issues/22:
 * "Verify then fix: generated node types leave key fields as `unknown`
 * (e.g. `ShLitNode.value`), contradicting 'fully-typed' claim".
 *
 * Every scalar leaf field the generator now makes concrete is asserted here
 * — all 44 node/field pairs, not a sample — so a generator regression that
 * misclassifies any one of them (back to `unknown`, or to the wrong scalar)
 * fails this suite. Regeneration/`regenerate-match` only proves byte
 * determinism; these assertions prove semantic correctness.
 *
 * The expected type of each field is derived **independently** from the
 * pinned upstream `mvdan.cc/sh/v3 v3.13.1` struct definitions, not copied
 * from the generated `.d.ts` (which would be tautological): Go `string` →
 * `string`, Go `bool` → `boolean`, and mvdan/sh's `token`-backed operator
 * enums (`RedirOperator`, `BinAritOperator`, `CaseOperator`, `ProcOperator`,
 * `GlobOperator`, `ParNamesOperator`, `ParExpOperator`, `UnAritOperator`,
 * `UnTestOperator`, `BinTestOperator`, `BinCmdOperator`) → `number`, because
 * those types implement only `fmt.Stringer`, not `json.Marshaler`, so the
 * shim's encoder serializes them as JSON numbers. Field names are the Go
 * field names fully lowercased, per the serialization contract (`TempFile`
 * → `tempfile`, `RsrvWord` → `rsrvword`, etc.).
 *
 * Each `expectType` (positive) fails against the pre-fix `node-types.d.ts`
 * (the leaf is `unknown`); each `expectNotAssignable<typeof node.field>`
 * negative asserts an incompatible scalar against the field's own type,
 * which also fails while the field is still `unknown` (everything is
 * assignable to `unknown`) — so both directions guard the reproduction.
 *
 * @see https://github.com/mvdan/sh/blob/v3.13.1/syntax/nodes.go
 * @see https://github.com/mvdan/sh/blob/v3.13.1/syntax/tokens.go
 */
import { expectNotAssignable, expectType } from 'tsd';
import type { ShNodes } from 'sh-ast';

// --- ShArithmCmdNode ---
declare const arithmCmd: ShNodes.ShArithmCmdNode;
expectType<boolean | undefined>(arithmCmd.unsigned);
expectNotAssignable<typeof arithmCmd.unsigned>('x');

// --- ShArithmExpNode ---
declare const arithmExp: ShNodes.ShArithmExpNode;
expectType<boolean | undefined>(arithmExp.bracket);
expectType<boolean | undefined>(arithmExp.unsigned);
expectNotAssignable<typeof arithmExp.bracket>('x');
expectNotAssignable<typeof arithmExp.unsigned>('x');

// --- ShAssignNode --- (Assign.Append `+=`, Assign.Naked no-`=` declare form)
declare const assign: ShNodes.ShAssignNode;
expectType<boolean | undefined>(assign.append);
expectType<boolean | undefined>(assign.naked);
expectNotAssignable<typeof assign.append>('x');
expectNotAssignable<typeof assign.naked>('x');
// Non-regression: name/value were already typed as node references, not
// scalar leaves (mvdan/sh's `Assign.Name`/`.Value` are `*Lit`/`*Word`).
expectType<ShNodes.ShLitNode | undefined>(assign.name);
expectType<ShNodes.ShWordNode | undefined>(assign.value);

// --- ShBinaryArithmNode --- (BinAritOperator → number)
declare const binaryArithm: ShNodes.ShBinaryArithmNode;
expectType<number | undefined>(binaryArithm.op);
expectNotAssignable<typeof binaryArithm.op>('x');

// --- ShBinaryCmdNode --- (BinCmdOperator → number)
declare const binaryCmd: ShNodes.ShBinaryCmdNode;
expectType<number | undefined>(binaryCmd.op);
expectNotAssignable<typeof binaryCmd.op>('x');

// --- ShBinaryTestNode --- (BinTestOperator → number)
declare const binaryTest: ShNodes.ShBinaryTestNode;
expectType<number | undefined>(binaryTest.op);
expectNotAssignable<typeof binaryTest.op>('x');

// --- ShBraceExpNode ---
declare const braceExp: ShNodes.ShBraceExpNode;
expectType<boolean | undefined>(braceExp.sequence);
expectNotAssignable<typeof braceExp.sequence>('x');

// --- ShCaseClauseNode ---
declare const caseClause: ShNodes.ShCaseClauseNode;
expectType<boolean | undefined>(caseClause.braces);
expectNotAssignable<typeof caseClause.braces>('x');

// --- ShCaseItemNode --- (CaseOperator → number)
declare const caseItem: ShNodes.ShCaseItemNode;
expectType<number | undefined>(caseItem.op);
expectNotAssignable<typeof caseItem.op>('x');

// --- ShCmdSubstNode ---
declare const cmdSubst: ShNodes.ShCmdSubstNode;
expectType<boolean | undefined>(cmdSubst.backquotes);
expectType<boolean | undefined>(cmdSubst.tempfile);
expectType<boolean | undefined>(cmdSubst.replyvar);
expectNotAssignable<typeof cmdSubst.backquotes>('x');
expectNotAssignable<typeof cmdSubst.tempfile>('x');
expectNotAssignable<typeof cmdSubst.replyvar>('x');

// --- ShCommentNode ---
declare const comment: ShNodes.ShCommentNode;
expectType<string | undefined>(comment.text);
expectNotAssignable<typeof comment.text>(42);

// --- ShDblQuotedNode ---
declare const dblQuoted: ShNodes.ShDblQuotedNode;
expectType<boolean | undefined>(dblQuoted.dollar);
expectNotAssignable<typeof dblQuoted.dollar>('x');

// --- ShExpansionNode --- (ParExpOperator → number)
declare const expansion: ShNodes.ShExpansionNode;
expectType<number | undefined>(expansion.op);
expectNotAssignable<typeof expansion.op>('x');

// --- ShExtGlobNode --- (GlobOperator → number)
declare const extGlob: ShNodes.ShExtGlobNode;
expectType<number | undefined>(extGlob.op);
expectNotAssignable<typeof extGlob.op>('x');

// --- ShFileNode ---
declare const file: ShNodes.ShFileNode;
expectType<string | undefined>(file.name);
expectNotAssignable<typeof file.name>(42);

// --- ShForClauseNode ---
declare const forClause: ShNodes.ShForClauseNode;
expectType<boolean | undefined>(forClause.select);
expectType<boolean | undefined>(forClause.braces);
expectNotAssignable<typeof forClause.select>('x');
expectNotAssignable<typeof forClause.braces>('x');

// --- ShFuncDeclNode ---
declare const funcDecl: ShNodes.ShFuncDeclNode;
expectType<boolean | undefined>(funcDecl.rsrvword);
expectType<boolean | undefined>(funcDecl.parens);
expectNotAssignable<typeof funcDecl.rsrvword>('x');
expectNotAssignable<typeof funcDecl.parens>('x');

// --- ShLitNode --- (the issue's anchor case: mvdan/sh's `Lit.Value` string)
declare const lit: ShNodes.ShLitNode;
expectType<string | undefined>(lit.value);
expectNotAssignable<typeof lit.value>(42);

// --- ShParamExpNode --- (Names is ParNamesOperator → number; rest bool)
declare const paramExp: ShNodes.ShParamExpNode;
expectType<boolean | undefined>(paramExp.short);
expectType<boolean | undefined>(paramExp.excl);
expectType<boolean | undefined>(paramExp.length);
expectType<boolean | undefined>(paramExp.width);
expectType<boolean | undefined>(paramExp.isset);
expectType<number | undefined>(paramExp.names);
expectNotAssignable<typeof paramExp.short>('x');
expectNotAssignable<typeof paramExp.excl>('x');
expectNotAssignable<typeof paramExp.length>('x');
expectNotAssignable<typeof paramExp.width>('x');
expectNotAssignable<typeof paramExp.isset>('x');
expectNotAssignable<typeof paramExp.names>('x');

// --- ShProcSubstNode --- (ProcOperator → number)
declare const procSubst: ShNodes.ShProcSubstNode;
expectType<number | undefined>(procSubst.op);
expectNotAssignable<typeof procSubst.op>('x');

// --- ShRedirectNode --- (RedirOperator → number)
declare const redirect: ShNodes.ShRedirectNode;
expectType<number | undefined>(redirect.op);
expectNotAssignable<typeof redirect.op>('x');

// --- ShReplaceNode ---
declare const replace: ShNodes.ShReplaceNode;
expectType<boolean | undefined>(replace.all);
expectNotAssignable<typeof replace.all>('x');

// --- ShSglQuotedNode --- (Value string; Dollar the `$'...'` ANSI-C flag)
declare const sglQuoted: ShNodes.ShSglQuotedNode;
expectType<boolean | undefined>(sglQuoted.dollar);
expectType<string | undefined>(sglQuoted.value);
expectNotAssignable<typeof sglQuoted.dollar>('x');
expectNotAssignable<typeof sglQuoted.value>(42);

// --- ShStmtNode ---
declare const stmt: ShNodes.ShStmtNode;
expectType<boolean | undefined>(stmt.negated);
expectType<boolean | undefined>(stmt.background);
expectType<boolean | undefined>(stmt.coprocess);
expectType<boolean | undefined>(stmt.disown);
expectNotAssignable<typeof stmt.negated>('x');
expectNotAssignable<typeof stmt.background>('x');
expectNotAssignable<typeof stmt.coprocess>('x');
expectNotAssignable<typeof stmt.disown>('x');

// --- ShTimeClauseNode ---
declare const timeClause: ShNodes.ShTimeClauseNode;
expectType<boolean | undefined>(timeClause.posixformat);
expectNotAssignable<typeof timeClause.posixformat>('x');

// --- ShUnaryArithmNode --- (UnAritOperator → number; Post bool)
declare const unaryArithm: ShNodes.ShUnaryArithmNode;
expectType<number | undefined>(unaryArithm.op);
expectType<boolean | undefined>(unaryArithm.post);
expectNotAssignable<typeof unaryArithm.op>('x');
expectNotAssignable<typeof unaryArithm.post>('x');

// --- ShUnaryTestNode --- (UnTestOperator → number)
declare const unaryTest: ShNodes.ShUnaryTestNode;
expectType<number | undefined>(unaryTest.op);
expectNotAssignable<typeof unaryTest.op>('x');

// --- ShWhileClauseNode ---
declare const whileClause: ShNodes.ShWhileClauseNode;
expectType<boolean | undefined>(whileClause.until);
expectNotAssignable<typeof whileClause.until>(1);

// --- Non-regression: array/child fields were never routed through the
// `unknown` catch-all, only scalar leaves were. ---
declare const word: ShNodes.ShWordNode;
expectType<readonly ShNodes.ShWordPartNode[]>(word.parts);
