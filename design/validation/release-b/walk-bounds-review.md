# Private Walk bounds review

The private comment-placement calculations at
`6d77fa9a3372e73821cf07e870230da9b1e57111` match the pinned mvdan/sh v3.13.1 position
methods in this bounded review. No implementation defect was found. The review
covers `syntax-walk-bounds.ts` and the points where Walk reevaluates those bounds
after callbacks; it does not establish acceptance of every Walk behavior.

## Independent checks

A native Go oracle constructed trees and evaluated `!node.End().After(hash)` for
statements and `hash.After(node.Pos())` for case and array items. The syntax wire
codec serialized those trees for the TypeScript input; it did not supply the
expected bound decisions. The exact reviewed TypeScript sources were obtained
from the pinned commit and transpiled in the reviewer's checkout. Producer and
author checkouts remained unchanged.

All **1,455 constructed bound observations** matched, including **15 exact panic
messages**. The matrix combines 15 position states, 16 dependency shapes and six
comment positions, then adds 15 nil, typed-nil and partial-node cases.

Position states include ordinary zero, a valid zero offset, an ordinary invalid
position with a nonzero offset, zero line or column, column carry, packed
line-and-column rollover, maximum and near-maximum offsets, recovered positions,
reserved-offset overflow, negative-offset underflow, and constructor coordinate
overflow. Dependency shapes cover one-, two- and four-column additions,
sequential additions, subtraction, maximum selection, optional-child precedence,
parameter fallback and nested words.

Several cases preserve behavior that a simple offset comparison would lose:

- With a semicolon at `NewPos(10, 262143, 16383)` and Coprocess enabled, the first
  one-column addition clears the packed line/column word. The resulting position
  is invalid, so the second addition stops rather than advancing again.
- `FlagsArithm.Pos` subtracts one from its flag token position. Starting at
  `NewPos(0, 1, 1)` wraps the offset into the reserved range and produces an
  invalid position. Comment ordering follows that invalid state.
- A statement can start with invalid `NewPos(11, 0, 0)` and have a redirect ending
  at valid `NewPos(10, 2, 3)`. The maximum operation retains the invalid left
  position because the right position is not after its raw offset.
- An ArrayElem with a typed-nil Index and a valid Value still selects Index for
  Pos and panics. It does not fall back to Value.

Representing serialized reserved offsets by one reserved sentinel preserves the
operations used here. A valid left position cannot be after any reserved offset,
and arithmetic returns invalid input unchanged. The private representation also
retains ordinary invalid nonzero offsets, which remain significant as the right
operand of After.

## Live callback observations

Seven additional native Walk traces matched the reviewed implementation,
including three panic outcomes. Each fixture mutates data during the first
comment callback before the next comment-placement decision:

- Shorten Stmt.Position or replace it with an invalid nonzero-offset position.
- Replace Stmt.Cmd with an empty CallExpr, causing its later End evaluation to
  panic.
- Change the first CaseItem pattern's literal position or clear Patterns.
- Replace ArrayElem.Index with a different word or with a typed-nil Word.

The comparison includes the complete node-entry, null-exit and deferred-comment
sequence and the exact panic text. These observations confirm that later
placement decisions read the edited fields in the tested paths.

## Scope and retained evidence

The review uses complete representable records, including permitted nil fields;
it does not assess arbitrary malformed JavaScript objects or inconsistent
hand-edited SyntaxPos observation fields. The broader grammar oracle suite is
separate evidence. Go slice capacity, array backing storage and retained comment
slot identities remain outside this review, as does callback boolean validation.
No implementation change was made.

The reviewer's `scratch/WALK-BOUNDS-REVIEW-CHECKPOINT.md` identifies the checkout and
commands. Native oracle output and comparison results are retained as
`scratch/walk-bounds-oracle.json`, `scratch/walk-bounds-review-result.json`,
`scratch/walk-live-oracle.json` and `scratch/walk-live-review-result.json`.
