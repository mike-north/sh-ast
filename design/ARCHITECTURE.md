# Faithful syntax interface

This collection plans a refocus of `sh-ast`: a faithful TypeScript interface to
the pinned `mvdan.cc/sh/v3/syntax` package through WebAssembly. Its purpose is to
make upstream syntax available to JavaScript tools without losing distinctions
that parsing, traversal, editing, or printing require.

This is a planning collection, not a description of a delivered replacement API.
The accepted direction below comes from the user's voice decisions, carried into
the planning assignment on 2026-11-01. API proposals remain proposals. Current
implementation facts and revisions are recorded separately.

## Reading map

- [Fidelity assessment](FIDELITY-ASSESSMENT.md): declared implementation baseline,
  source evidence, existing behavior, and gaps.
- [Release plan](RELEASE-PLAN.md): the two release boundaries, dependencies, and
  implementation handoff.
- [Acceptance scenarios](ACCEPTANCE.md): tests to write first, ownership of checks,
  and the built-candidate consumer workflow.

The repository previously referenced `design/ARCHITECTURE.md` without containing
it. `ENG_TEAM_INSTRUCTIONS.md` identifies the sibling eslint-sh architecture as
the historical reference. That design describes a normalized ESLint-facing tree;
this collection records the new direction without claiming that old code violated
requirements accepted only now. The existing API reports and generated `docs/`
remain descriptions of the implemented API.

## Accepted direction

| ID  | Decision and consequence                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Preserve upstream values, semantic distinctions, constraints, and control flow in both returned data and caller inputs. A convenient approximation is insufficient.                                                                                                                                                                  |
| D2  | Restrained TypeScript adaptations are appropriate: typed exceptions that retain error/result information, precise numeric/operator domains, and unions matching upstream alternatives. Do not invent asynchronous behavior for ergonomics. Repeated callbacks and control callbacks must retain their completion and stop semantics. |
| D3  | A synchronous path is essential for ESLint language support, including first-use WASM initialization. A synchronous warm call after mandatory asynchronous setup does not satisfy this requirement.                                                                                                                                  |
| D4  | Two successive minor releases in the 0.x series: first excellent synchronous parsing and a complete, faithfully typed syntax tree; next faithful walking/traversal and printing, supporting transformations and lint autofixes. Release A must retain the information Release B needs. No 1.0 release is planned.                    |
| D5  | Neither sh-ast nor eslint-sh has users yet. Breaking API changes are permitted during 0.x. Compatibility is a migration task, not a reason to preserve an incompatible abstraction.                                                                                                                                                  |
| D6  | sh-ast tests the syntax and position invariants needed by ESLint, without implementing an ESLint integration here. Real ESLint integration lives in eslint-sh. Before release, locally link the built candidate and run consumer tests with evidence identifying the actual build.                                                   |
| D7  | The eventual upstream boundary is the syntax package. The shell interpreter, runner, and a newly invented shell model are outside that boundary.                                                                                                                                                                                     |
| D8  | Software changes start with specification-derived tests. Modules, types, constants, and functions document durable meaning, responsibilities, boundaries, and invariants. Progress notes belong in work records.                                                                                                                     |

The proposed edit/print/reparse acceptance scenario elaborates D4 and D6; its exact
fixture is not itself an accepted product decision. No byte-identical source
printing guarantee follows from the accepted autofix purpose.

## Responsibilities

**Upstream syntax** owns grammar, dialect behavior, AST structure and field
meaning, position semantics, traversal order/control, and printer behavior. Pin
the version and name it in release notes. Do not silently fix perceived shell
semantics in the binding.

**The WASM bridge** transports source, options, trees, and errors without losing
upstream-observable information. It owns memory lifetimes, runtime initialization,
and failures at this boundary. A bridge error is distinct from a syntax error.
Its internal encoding may differ from upstream typedjson: byte equality with a
lossy encoding is not proof of syntax fidelity.

**The TypeScript interface** supplies precise names and representations for that
same model. Discriminants may identify upstream interface alternatives. They must
not turn auxiliary structs into syntax nodes or invent source spans. Any numeric
adaptation must account for the pinned Go/WASM widths and upstream domain rules.

**The consumer adapter** translates syntax into ESLint's locations, visitation,
comments, diagnostics, and fixes. It owns ESLint-specific objects and policies.
Raw byte positions remain available even if a reusable UTF-16 conversion helper
is later provided by sh-ast. Such a helper would be derived data, not the syntax
position contract.

## Proposed representation contract

These recommendations are sufficient to guide tests and design review, but the
specific public API must be accepted before implementation freezes it.

1. **One complete schema.** Describe every exported field on every syntax node
   and reachable auxiliary struct: scalar, operator, position, pointer/interface,
   and slice. Derive interface unions and named constants from the pinned Go
   types. Emit semantic comments from upstream documentation plus binding-specific
   boundaries. A string index signature must not conceal missing fields or typos.
   `parse` returns the precise File type directly; stronger types are not an opt-in
   namespace disconnected from its return value.
2. **Explicit values.** Retain `false`, `0`, and `""`. Preserve nil pointers and
   interfaces distinctly from present values. Recommended: `null` for upstream
   nil and arrays for non-nil slices, retaining nil versus empty slices where the
   wire and caller-input contracts permit both. Do not claim Go pointer identity
   preservation from a JSON tree. Shared-object identity, if exposed, needs its own
   contract; parser-produced tree semantics do not require inventing it.
3. **Positions keep their meaning.** Retain byte offset, byte column, line,
   validity, and recovered state for both node boundaries and every named token
   position. Preserve zero values caused by upstream overflow. An invalid position
   can still have observable numeric values; do not reduce every invalid value to
   a single `{ kind: "invalid" }` record that loses them. UTF-16 spans are a
   separate view tied to the exact source bytes. Do not manufacture valid positions
   for empty files, recovered syntax, or newly constructed nodes.
4. **Precise numeric domains.** JavaScript numbers exactly represent uint32, but
   `number` alone admits fractions, negatives, NaN, infinity, and unrelated
   operators. Generate constant values and distinct operator-family types; enforce
   ranges on caller inputs before conversion. Position constructors must preserve
   upstream clamping/overflow behavior rather than replacing it with an arbitrary
   rejection policy. `LangVariant` is a Go `int`, not a uint32 token alias; retain
   its values and the operation-specific constraints on `Variant`.
5. **Errors preserve results.** A proposed typed exception retains the partial
   File returned by Parse, the original error kind and fields, and the formatted
   error message. `ParseError` includes Text, Pos, Filename, Incomplete;
   `LangError` includes Feature, Langs, LangUsed, Pos, Filename. Do not parse the
   message to reconstruct lost fields. Validation/panic adaptation and transport
   failures need separate, documented error categories.
6. **Auxiliary structs stay auxiliary.** `Slice`, `Replace`, and `Expansion` have
   no upstream Node Pos/End methods. Their contained children remain reachable,
   but they do not receive synthetic node identities or source ranges in the
   faithful model. Consumer visitors may adapt them deliberately.
7. **Editing is possible.** Prefer mutable, faithfully typed data records, matching
   upstream editable structs. Choose this before Release A rather than shipping
   readonly declarations and inventing an editing framework in Release B. An
   ESLint rule may edit a separate tree to avoid invalidating cached lint traversal.
8. **Printing sees the edited tree.** It must reconstruct the represented upstream
   data, including positions/comments and zero values. It cannot recover dropped
   fields by reparsing the original source, since that would ignore edits. Prove
   reversibility privately in Release A without exposing a public printer early.
9. **Node bounds are derived.** Upstream Node.Pos()/End() methods compute bounds
   from current fields and children; they are not additional stored token fields.
   Preserve those computations in the chosen interface (methods, getters, or
   explicit helpers), rather than exposing independently writable bounds that can
   contradict an edited tree. A serialized snapshot of bounds is not their source
   of truth. Token positions retain their own upstream meaning after edits.

## Proposed parsing surface and defaults

Release A should expose synchronous whole-file Parse, with faithful controls for
KeepComments, Variant, StopAt, and RecoverErrors. Recommend upstream defaults;
eslint-sh explicitly opts into comment retention. The current forced
`KeepComments(true)` is an adapter choice, not the upstream default.

Prefer a byte-capable input boundary plus a documented string convenience. A Go
reader consumes bytes; a JS string cannot represent every invalid UTF-8 sequence.
TextEncoder replaces lone surrogates. The pinned upstream lexer rejects invalid
UTF-8 with ParseError (`syntax/lexer.go:136-137`); byte-capable parsing must preserve
that error and partial-result behavior, not promise successful invalid-UTF-8
parsing. Constructed AST strings and filenames can independently contain arbitrary
Go bytes, which JSON string encoding can replace. A byte input alone therefore
does not establish a lossless tree transport. The codec must preserve the relevant
byte-bearing values, or the release must explicitly accept a narrower contract.
This is a release decision, not a claim of complete Reader equivalence.

Do not promise the entire syntax package in these two releases. Stateful/incremental
Parser operations require a separate scope decision: Stmts/Words and their sequence
forms, Interactive/InteractiveSeq, Document, Arithmetic, and Incomplete. Their
eventual implementations must preserve callback repetition, boolean stop control,
buffering/read-error behavior, parser reuse constraints, and error timing. A Promise
is not a replacement for these protocols.

## Implemented candidate decisions

The implementation assignment delegated routine API choices to preserve the
accepted direction. These are concrete candidate contracts, not claims of final
release acceptance; evidence and remaining gates are in [IMPLEMENTATION.md](IMPLEMENTATION.md).

- Records use upstream field names, a `Type` discriminator, explicit null/default
  values, and mutable fields. Derived bounds are independent `nodePos`/`nodeEnd`
  operations on current data.
- `parseWithPositionsSync` additionally returns a separate original-source
  position snapshot. Its identity lookup does not reconstruct subtrees or call
  WASM. Bounds are observed on the original Go nodes during the same parse;
  mutating the returned File does not update them. This view supports efficient
  source consumers without changing live bound operations or adding stored bounds
  to upstream syntax records. Its internal observation pass has no public Walk
  ordering or visitor-control contract.
- GoString preserves Unicode text or exact byte arrays. Bytes reach upstream
  unchanged, including invalid-UTF-8 parse failures. Lone JS surrogates are
  rejected before encoding.
- Whole-file synchronous parsing exposes the four upstream controls. Other parser
  protocols remain deferred. Go int/uint arguments accept bigint where needed;
  position components/operators remain exact uint32 number domains.
- Positions retain public overflow/recovery observations as six fields, including
  `OffsetOverflow`. Reconstruction uses public upstream operations.
- Interface values distinguish ordinary null from a concrete typed nil pointer,
  using `TypedNil` tags restricted to actual implementer types. This matters even
  for successful position operations: a long ParamExp with a typed nil Index can
  return both bounds. A transport limitation must not turn that into rejection.
- Analysis remains a separate subpath, migrated to the faithful model. Consumers
  own their UTF-16 locations and traversal views; sh-ast exports no public Walk or
  Print in this candidate.
- The conservative nesting guard remains a documented, tested binding constraint.

## Responsibility boundaries

The faithful parser model is the source of truth for upstream syntax values.
`sh-ast/analyze` retains useful syntactic interpretation as a separate subpath;
its limitations cannot change parser output. The consumer owns source-coordinate
projection and presentation-oriented traversal. The original planning questions
are resolved by the candidate choices above, subject to their independent
acceptance evidence and remaining release gates.
