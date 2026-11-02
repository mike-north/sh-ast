# Two minor releases

This plan implements the [accepted direction](ARCHITECTURE.md#accepted-direction).
All work below is proposed and unimplemented. The labels **Release A** and
**Release B** intentionally have no numeric versions: the original checkout,
remote history, and installed consumer are at different versions, documented in
the [baseline assessment](FIDELITY-ASSESSMENT.md#declared-baseline-and-provenance).
Assign two successive 0.x minors only after reconciling the release line. Neither
release is 1.0.

## Release boundaries

|                            | Release A: synchronous parsing and complete tree                                                                                            | Release B: traversal and printing                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| User outcome               | Parse shell source synchronously on first use, inspect a complete and precisely typed upstream tree, and supply faithful parsing options.   | Traverse with upstream order/control; edit represented syntax and print it through upstream, enabling consumer fixes.           |
| Required data              | All node/auxiliary fields, operator domains, comments, named positions, invalid/recovered state, partial results and structured errors.     | The same representation, accepted back as printer input; newly constructed/edited fields and positions have explicit contracts. |
| Public operations proposed | Whole-file Parse and its KeepComments/Variant/StopAt/RecoverErrors controls; source/position/error types and required supporting constants. | Upstream-compatible Walk and Print, with all eight pinned Printer options and root restrictions.                                |
| Exit evidence              | Acceptance A1-A9; independent codec round-trip proof including printing-relevant data; built-candidate real ESLint gate C1-C4.              | A gates remain green; B1-B5; real consumer AST edit/printed-fix/reparse C5.                                                     |
| Deliberately outside scope | Public printer, new semantic analysis, interpreter/runner, browser platform expansion, blanket full-syntax-package parity claim.            | Interpreter/runner, shell execution, semantic optimizer, token-stream invention, source-byte-identical printing promise.        |

Existing `walk` does not make Release B complete. Before A, decide whether to
remove the old helper from the new API or retain it under an explicitly different
legacy name. Do not publish it as faithful Walk. The consumer already has its own
visitor-key traversal; its migration need not wait for B. Likewise, full AST typing
includes BraceExp even though ordinary Parse does not produce it until upstream
SplitBraces is invoked; do not silently add that transformation to parsing.

The following syntax APIs remain inventoried but outside these two proposed
release commitments unless explicitly added: Stmts/Words/Interactive and sequence
forms; Document/Arithmetic; parser Incomplete state; Simplify, SplitBraces, Quote,
DebugPrint, IsKeyword, ValidName, and helper methods beyond those required for the
represented position/node contract. This is a phased syntax interface, not a claim
that the full package has already been ported.

## Implementation sequence

Each item begins with tests derived from its named acceptance scenarios. First
record the expected upstream outcome; demonstrate relevant failures before changing
implementation. Keep semantic comments and public API reports current with the
actual contract. Completion requires the test outcome, not a checklist assertion.

| Work item                                    | Dependencies                              | Deliverable and completion evidence                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0 Reconcile implementation/release baseline | None                                      | Select integration HEAD without altering the user's original checkout; inventory newer fixes, changesets, remote refs and registry versions. Reuse scalar typing, error rename, and dialect regressions as appropriate. Preserve the original go.sum delta separately. Record exact sh-ast/eslint-sh commits. |
| A1 Settle representation and oracle          | A0; consequential choices in Architecture | Review complete field/domain inventory and chosen names, nullability, mutability, byte policy, position and error contracts. Add independent Go-oracle fixtures and TS type tests. Required tests fail for omissions, not merely for missing API names.                                                       |
| A2 Make the codec reversible                 | A1                                        | Preserve defaults, nil/empty distinctions, auxiliary structs, source bytes, token positions and recovery. Add decoder proof sufficient for future Print. Resolve recovered-position reconstruction and invalid UTF-8 before promising reversibility. Pass A2-A5 and A9.                                       |
| A3 Expose faithful parse inputs/results      | A2                                        | Implement all proposed whole-file options, structured error/result adaptation, and typed return model. Validate numeric input domains and upstream operation constraints. Pass A6-A7 and relevant A3/A5 fixtures.                                                                                             |
| A4 Prove synchronous package behavior        | A2-A3                                     | First-use installed package test, repeated success/failure isolation, initializer observation, resource-limit policy, asset and memory-lifetime tests. Pass A1/A8. Record cold and warm timing separately.                                                                                                    |
| A5 Migrate the consumer boundary             | A1-A4; analyze disposition                | In a separate eslint-sh change, adapt locations/errors/types/traversal and explicit comment retention. Add candidate injection/resolution assertions to both linked and packaged test paths. Pass C1-C4. No ESLint integration code added to sh-ast.                                                          |
| A6 Assemble Release A                        | A1-A5                                     | Full package checks, generated-schema drift, canonical WASM check, complete docs/comments and migration notes, candidate receipt. Minor changeset only after numbering is reconciled; follow existing CI release process.                                                                                     |
| B1 Specify and implement Walk                | A complete                                | Compare independent upstream traces, including pruning, nil exits, specialized comment order and auxiliary children. Pass B1-B2; migrate any callers of the former structural helper.                                                                                                                         |
| B2 Implement Print bridge                    | A reversible data model                   | Validate inputs and reconstruct the actual edited Go tree. Implement all pinned Printer options and supported-root/error behavior. Pass B3-B4, including private recovery/position round trips established in A.                                                                                              |
| B3 Prove editing and consumer fixes          | B1-B2                                     | Type-safe edit, Go-oracle print comparison, reparse structural meaning, real ESLint fix and stable second pass. Pass B5/C5.                                                                                                                                                                                   |
| B4 Assemble Release B                        | B1-B3                                     | Repeat A regression and candidate gates against this exact build; update API/migration docs and the next minor changeset. No source-fidelity claim beyond tested upstream printer behavior.                                                                                                                   |

A2 is intentionally earlier than public printing. Discovering in B that A discarded
required syntax would defeat the accepted release order.

### Recommended first implementation slice

After A0 and representation decisions, add a small independent Go observation
suite plus failing public/type tests for empty input, comment-only input, false and
empty values, and valid/invalid/recovered positions. Include `echo hi`, `echo hi;`,
`${a:-}`, and `(foo |` with recovery. Prove that the new codec can reconstruct
those observations, including recovered state, before expanding it across the
complete schema. Add the cold built-package probe alongside this foundation.

This is a vertical correctness slice, not a release by itself: completeness still
requires the full field/domain inventory and all A gates. Do not start by adding
printer APIs to the current lossy normalizer or by building ESLint inside sh-ast.

## Technical risks to resolve with evidence

- **Reconstructing positions:** `syntax.Pos` stores unexported uint32 words;
  `NewPos` cannot create the recovered sentinel. Upstream typedjson Decode uses
  NewPos and does not preserve recovered state. A2 must demonstrate a supported
  bridge strategy before promising arbitrary tree round trips. Unsafe layout
  coupling or an upstream fork is not implicitly approved by this plan.
- **Bytes and strings:** Go source/string values can contain bytes JS strings and
  JSON cannot preserve directly. Decide the input contract and implement the
  corresponding codec, with negative as well as positive fixtures.
- **Host limits:** a WASM call stack can be narrower than a native Go stack.
  Newer-main depth protection must be reviewed as an adapter limitation; neither
  removing it nor claiming perfect equivalence is justified by this assessment.
- **Testing from the same generator:** generated schema self-consistency is useful
  but cannot establish upstream completeness. Keep the oracle independent of the
  production generator and typedjson omission rules.
- **Consumer resolution:** an installed-pack test can silently use registry sh-ast
  even after linking locally. Candidate identity is an assertion in every relevant
  process, including the installed plugin fixture.
- **Historical documentation conflict:** README build reproducibility claims and
  engineering instructions differ about host-specific WASM bytes. Use the pinned
  canonical Linux CI builder as the release gate; do not replace its artifact with
  an unverified local build. Reconcile the prose when touching build documentation.

## Release acceptance record

For each release candidate, commit or attach a reviewable record containing:
candidate source commit and patch identity, built-file and tarball hashes, upstream
pin, toolchain, consumer commit/patch, dependency resolution in every test context,
commands/exits, test names/results, cold/warm measurements, unexamined coverage,
and known accepted adapter limits. A link command, passing registry test, or
successful generation alone is not consumer acceptance.

This planning change implements none of A0-B4 and authorizes no publication. The
next handoff is A0/A1, with the outstanding decisions in Architecture presented to
the strategic supervisor for resolution.
