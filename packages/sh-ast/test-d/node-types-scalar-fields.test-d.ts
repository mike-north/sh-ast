/**
 * Independent scalar-field coverage for all 44 node/field pairs identified in
 * issue #22. Expectations come from mvdan/sh v3.13.1 nodes.go and tokens.go:
 * bools are complete booleans, Go strings retain bytes, operators preserve their
 * specific uint32 family, and pointer/slice boundaries retain explicit nulls.
 * Both positive and incompatible-value assertions detect accidental unknowns.
 */
import { expectNotAssignable, expectType } from 'tsd';
import type * as Syntax from 'sh-ast';

// --- ArithmCmd ---
declare const arithmCmd: Syntax.ArithmCmd;
expectType<boolean>(arithmCmd.Unsigned);
expectNotAssignable<typeof arithmCmd.Unsigned>('x');

// --- ArithmExp ---
declare const arithmExp: Syntax.ArithmExp;
expectType<boolean>(arithmExp.Bracket);
expectType<boolean>(arithmExp.Unsigned);
expectNotAssignable<typeof arithmExp.Bracket>('x');
expectNotAssignable<typeof arithmExp.Unsigned>('x');

// --- Assign --- (Assign.Append `+=`, Assign.Naked no-`=` declare form)
declare const assign: Syntax.Assign;
expectType<boolean>(assign.Append);
expectType<boolean>(assign.Naked);
expectNotAssignable<typeof assign.Append>('x');
expectNotAssignable<typeof assign.Naked>('x');
// Non-regression: name/value remain typed node references rather than
// scalar leaves (mvdan/sh's `Assign.Name`/`.Value` are `*Lit`/`*Word`).
expectType<Syntax.Lit | null>(assign.Name);
expectType<Syntax.Word | null>(assign.Value);

// --- BinaryArithm --- (BinAritOperator family)
declare const binaryArithm: Syntax.BinaryArithm;
expectType<Syntax.BinAritOperator>(binaryArithm.Op);
expectNotAssignable<typeof binaryArithm.Op>('x');

// --- BinaryCmd --- (BinCmdOperator family)
declare const binaryCmd: Syntax.BinaryCmd;
expectType<Syntax.BinCmdOperator>(binaryCmd.Op);
expectNotAssignable<typeof binaryCmd.Op>('x');

// --- BinaryTest --- (BinTestOperator family)
declare const binaryTest: Syntax.BinaryTest;
expectType<Syntax.BinTestOperator>(binaryTest.Op);
expectNotAssignable<typeof binaryTest.Op>('x');

// --- BraceExp ---
declare const braceExp: Syntax.BraceExp;
expectType<boolean>(braceExp.Sequence);
expectNotAssignable<typeof braceExp.Sequence>('x');

// --- CaseClause ---
declare const caseClause: Syntax.CaseClause;
expectType<boolean>(caseClause.Braces);
expectNotAssignable<typeof caseClause.Braces>('x');

// --- CaseItem --- (CaseOperator family)
declare const caseItem: Syntax.CaseItem;
expectType<Syntax.CaseOperator>(caseItem.Op);
expectNotAssignable<typeof caseItem.Op>('x');

// --- CmdSubst ---
declare const cmdSubst: Syntax.CmdSubst;
expectType<boolean>(cmdSubst.Backquotes);
expectType<boolean>(cmdSubst.TempFile);
expectType<boolean>(cmdSubst.ReplyVar);
expectNotAssignable<typeof cmdSubst.Backquotes>('x');
expectNotAssignable<typeof cmdSubst.TempFile>('x');
expectNotAssignable<typeof cmdSubst.ReplyVar>('x');

// --- Comment ---
declare const comment: Syntax.Comment;
expectType<Syntax.GoString>(comment.Text);
expectNotAssignable<typeof comment.Text>(42);

// --- DblQuoted ---
declare const dblQuoted: Syntax.DblQuoted;
expectType<boolean>(dblQuoted.Dollar);
expectNotAssignable<typeof dblQuoted.Dollar>('x');

// --- Expansion --- (ParExpOperator family)
declare const expansion: Syntax.Expansion;
expectType<Syntax.ParExpOperator>(expansion.Op);
expectNotAssignable<typeof expansion.Op>('x');

// --- ExtGlob --- (GlobOperator family)
declare const extGlob: Syntax.ExtGlob;
expectType<Syntax.GlobOperator>(extGlob.Op);
expectNotAssignable<typeof extGlob.Op>('x');

// --- File ---
declare const file: Syntax.File;
expectType<Syntax.GoString>(file.Name);
expectNotAssignable<typeof file.Name>(42);

// --- ForClause ---
declare const forClause: Syntax.ForClause;
expectType<boolean>(forClause.Select);
expectType<boolean>(forClause.Braces);
expectNotAssignable<typeof forClause.Select>('x');
expectNotAssignable<typeof forClause.Braces>('x');

// --- FuncDecl ---
declare const funcDecl: Syntax.FuncDecl;
expectType<boolean>(funcDecl.RsrvWord);
expectType<boolean>(funcDecl.Parens);
expectNotAssignable<typeof funcDecl.RsrvWord>('x');
expectNotAssignable<typeof funcDecl.Parens>('x');

// --- Lit --- (the issue's anchor case: mvdan/sh's `Lit.Value` string)
declare const lit: Syntax.Lit;
expectType<Syntax.GoString>(lit.Value);
expectNotAssignable<typeof lit.Value>(42);

// --- ParamExp --- (Names is ParNamesOperator family; rest bool)
declare const paramExp: Syntax.ParamExp;
expectType<boolean>(paramExp.Short);
expectType<boolean>(paramExp.Excl);
expectType<boolean>(paramExp.Length);
expectType<boolean>(paramExp.Width);
expectType<boolean>(paramExp.IsSet);
expectType<Syntax.ParNamesOperator>(paramExp.Names);
expectNotAssignable<typeof paramExp.Short>('x');
expectNotAssignable<typeof paramExp.Excl>('x');
expectNotAssignable<typeof paramExp.Length>('x');
expectNotAssignable<typeof paramExp.Width>('x');
expectNotAssignable<typeof paramExp.IsSet>('x');
expectNotAssignable<typeof paramExp.Names>('x');

// --- ProcSubst --- (ProcOperator family)
declare const procSubst: Syntax.ProcSubst;
expectType<Syntax.ProcOperator>(procSubst.Op);
expectNotAssignable<typeof procSubst.Op>('x');

// --- Redirect --- (RedirOperator family)
declare const redirect: Syntax.Redirect;
expectType<Syntax.RedirOperator>(redirect.Op);
expectNotAssignable<typeof redirect.Op>('x');

// --- Replace ---
declare const replace: Syntax.Replace;
expectType<boolean>(replace.All);
expectNotAssignable<typeof replace.All>('x');

// --- SglQuoted --- (Value string; Dollar the `$'...'` ANSI-C flag)
declare const sglQuoted: Syntax.SglQuoted;
expectType<boolean>(sglQuoted.Dollar);
expectType<Syntax.GoString>(sglQuoted.Value);
expectNotAssignable<typeof sglQuoted.Dollar>('x');
expectNotAssignable<typeof sglQuoted.Value>(42);

// --- Stmt ---
declare const stmt: Syntax.Stmt;
expectType<boolean>(stmt.Negated);
expectType<boolean>(stmt.Background);
expectType<boolean>(stmt.Coprocess);
expectType<boolean>(stmt.Disown);
expectNotAssignable<typeof stmt.Negated>('x');
expectNotAssignable<typeof stmt.Background>('x');
expectNotAssignable<typeof stmt.Coprocess>('x');
expectNotAssignable<typeof stmt.Disown>('x');

// --- TimeClause ---
declare const timeClause: Syntax.TimeClause;
expectType<boolean>(timeClause.PosixFormat);
expectNotAssignable<typeof timeClause.PosixFormat>('x');

// --- UnaryArithm --- (UnAritOperator family; Post bool)
declare const unaryArithm: Syntax.UnaryArithm;
expectType<Syntax.UnAritOperator>(unaryArithm.Op);
expectType<boolean>(unaryArithm.Post);
expectNotAssignable<typeof unaryArithm.Op>('x');
expectNotAssignable<typeof unaryArithm.Post>('x');

// --- UnaryTest --- (UnTestOperator family)
declare const unaryTest: Syntax.UnaryTest;
expectType<Syntax.UnTestOperator>(unaryTest.Op);
expectNotAssignable<typeof unaryTest.Op>('x');

// --- WhileClause ---
declare const whileClause: Syntax.WhileClause;
expectType<boolean>(whileClause.Until);
expectNotAssignable<typeof whileClause.Until>(1);

// --- Non-regression: array/child fields were never routed through the
// `unknown` catch-all, only scalar leaves were. ---
declare const word: Syntax.Word;
expectType<(Syntax.WordPart | null)[] | null>(word.Parts);

// Defaults are data: no scalar can disappear or acquire a null value.
expectNotAssignable<typeof lit.Value>(undefined);
expectNotAssignable<typeof lit.Value>(null);
expectNotAssignable<typeof stmt.Background>(undefined);
expectNotAssignable<typeof stmt.Background>(null);
expectNotAssignable<typeof redirect.Op>(undefined);
expectNotAssignable<typeof redirect.Op>(null);
// Named operator families do not silently widen to arbitrary uint32 numbers.
expectNotAssignable<typeof redirect.Op>(0xffffffff);
expectNotAssignable<typeof binaryCmd.Op>(0xffffffff);
// Nullable children/slices are distinct from absent properties.
expectNotAssignable<typeof assign.Name>(undefined);
expectNotAssignable<typeof word.Parts>(undefined);
