# Compact position sidecar contract

Baseline: 1e96b49434e05b03c9f9fd8a001151186af1668d (Version Packages47 after merged48).
The design defers bound observation and uses a flat occurrence queue.
Scope is internal snapshot transport only.

## Safe fused collection

Extend the existing syntax writer with a dedicated occurrence-collecting entrypoint,
sharing its actual sorted field plans. Ordinary Encode/Append remain data-only.
During the one reflection traversal, collect `[]syntax.Node` references in the
order described below; do NOT invoke Pos/End while encoding. Only after complete
successful syntax encoding consume this flat queue and append compact observations.
This is one encoding/tree traversal plus a linear reference queue, not a second
reflection or tree walk. It removes path construction and discovery work while
preserving #35's no-bound-calls-before-success guarantee. This refines “produced during File encode pass” precisely.

A queue costs one interface reference per Node occurrence (~16 bytes/occurrence on
64-bit, about93KB for5801Nodes), not an intermediate syntax/position map tree.
It is discarded on any encoding error; no partial File or observation bytes escape.
The existing error-only declaration-order validator remains method-free and uses
its separate active pointer/slice ancestry. No callback reaches arbitrary user
code, no optimistic parser-only acyclicity assumption, no valid-path prepass.
Unexpected panics still reach Process's existing recovery boundary. Parser errors
still encode the partial File normally and omit BOTH sidecar fields. No bounds
are called on parse-error partial files, matching the current behavior.

## Occurrence order

Order is schema/encoder lexicographic field preorder, NOT the old sidecar's Go
field declaration order and NOT syntax.Walk order:

1. Visit each nonnil pointer implementing syntax.Node once on entry, before its
   children. Suppress a second observation for the immediately dereferenced struct.
2. Direct addressable struct values with pointer-receiver Node membership (notably
   Comment values in slices) contribute one occurrence via their actual address.
3. A typed-nil pointer held in an interface/root contributes an occurrence iff its
   concrete type implements Node. It is then a leaf and both bounds are attempted
   independently. Auxiliary typed-nil tags contribute none.
4. Nil interfaces, concrete nil pointers, nil/empty slices, scalar values and Pos
   structs contribute none. Auxiliary records contribute no entry but their
   children are traversed. A valid parsed File contributes the first/root entry.
5. Children follow the actual sorted emitted field sequence; synthetic Type and
   scalar/position fields do not create children. Slice elements follow index
   order. Repeated pointer occurrences are NOT deduplicated. The JSON decoder
   normally materializes separate records for each occurrence; no object identity
   correlation or pointer address is transmitted.
6. The collecting entrypoint is used with *syntax.File / syntax.Node roots; no
   promise to snapshot nonaddressable value roots whose pointer type is Node.
   Generic Encode/Append support and error semantics remain unchanged.

Independent enforcement: a Go test runs actual Encode for every registered record,
reads its top-level JSON key order, and compares it against Object.keys(fields)
from the COMMITTED generated JS module (Node subprocess, no generator helper).
It also compares Node membership against native Go interfaces. The existing
upstream-source inventory test independently ensures registry coverage. A JS
schema-order assertion/test makes the lexical ordering assumption explicit; the
generator's semantic comments describe this internal correlation contract. This
proves actual writer output vs actual shipped schema, not two generator products.
Distinct-coordinate File.Last/Stmt.Comments/Cmd fixtures will hand-anchor ordering
where declaration order differs from lexicographic order.

## Compact wire

Successful parse-with-positions envelope: {File, Positions, PositionErrors}.
Positions is a flat JSON numeric array of exactly8*N entries for N occurrences:
[posOffset,posLine,posCol,posFlags,endOffset,endLine,endCol,endFlags] repeated.
Flags use bit0 IsValid, bit1 IsRecovered, bit2 OffsetOverflow, integer0..7.
Coordinates preserve the existing SyntaxPos domains and invariants, including
recovery/overflow; inline File positions remain unchanged.

PositionErrors is ALWAYS an array (empty for ordinary success), containing sparse
[nodeIndex,posErrorOrNull,endErrorOrNull] triples. Producer emits increasing indexes;
decoder accepts any index order but rejects duplicates. Index is an integer0..N-1.
Each triple must contain at least one error. Errors are ordinary GoString wire
values (string or Bytes record restored to Uint8Array by decodeWire). A failed
bound's four numeric slots MUST be zero; the sparse error disambiguates it from a
successful invalid zero position. The other bound remains independently encoded.
No extra per-entry property names or paths are transmitted.

Plain parse envelope and all parser/option/encoding error envelopes retain their
existing spelling/behavior. Old/new JS+WASM pairs are not supported; they ship as
one package. No public types or API signatures change.

## Strict decoder/public semantics

Only after the existing complete File boundary validation, walk schema child-bearing
fields in the explicit order, without path arrays/JSON.stringify/map keys. Every
Node occurrence consumes exactly one numeric tuple. Validate dense numeric length,
coordinate integers/ranges, flag0..7 and reconstructed isSyntaxPos consistency,
sparse row exact length, integer/in-range unique indexes, null-or-GoString errors,
nonempty error rows, zero placeholders on failed bounds, and total occurrence
coverage. Any mismatch throws ShInternalError; no WASM fallback or partial snapshot
is returned. Validate successful opposite bounds even if get will throw an error.

Store captured immutable positions in a WeakMap. get retains original positions
after edits; copied/foreign identities return undefined. Freeze each SyntaxPos,
NodePositions, snapshot and ParsedFile container as before; do not freeze File.
Capture a copy of byte-bearing errors. get throws a fresh InputError with a fresh
copy, prefers Pos failure when both failed, and never calls WASM. Successful bound
plus failed other bound preserves current get behavior (throws captured error).

## Tests before implementation

- Wire-order test above for ALL registered records; manual nested preorder fixture
  with deliberately distinct coordinates, including comments before/after ordinary
  children. Sorted writer vs old declaration snapshot difference must be exercised.
- Go occurrence/observation tests: pointer/deref exactly once, all Comment-bearing
  fields enumerated from pinned upstream reflection, auxiliary children, typed nil
  versus concrete nil, null/empty slices, shared aliases/root; compare each bound
  independently to direct native Node.Pos/End calls with independent recovery.
- Safety: cyclic pointer/slice/mixed inputs, earlier declaration error than sorted
  error, no bound-method calls on any malformed graph, parse errors/partial File,
  atomic buffer+queue discard and following valid call. Preserve #35 error anchors.
- JS hand-derived tuple/error cases: missing sidecar, wrong length/count, nonnumber,
  fractional/negative/overflow coordinate, invalid/inconsistent flags, short/long
  error row, malformed payload, duplicate/out-of-range/fractional index, empty error
  row, nonzero failed-bound placeholder. All fail ShInternalError.
- Public equivalence against LIVE native operations for every independently
  enumerated Node across all5dialects; emoji/CJK/combining text, CRLF, heredocs,
  recovery, comment-only/empty input, comments in every comment-bearing slot.
  Native synthetic cases cover typednil/unreachable parser shapes. Decoder unit
  tests cover byte-bearing per-bound failures and error priority/copy isolation.
- Preserve existing File equality, positions frozen, copied/foreign undefined,
  mutation isolation and exactly one bridge call tests. Adapt #35 frozen oracle
  tests for new sidecar only: plain parse bytes unchanged; snapshot public/native
  observations equivalent rather than requiring obsolete wire byte identity.

## Delivery/measurement boundaries

Patch changeset; tests-first red/green; independent protocol/source review before
source-only PR. Exact-source Linux artifact adoption and full canonical gates;
never commit locally built WASM. API/docs regenerate for changed semantic comments.
Reuse #35 harness with minimal reviewed adaptations: expected wire bytes differ,
so compare full File/all-node positions rather than equal raw sidecar hash; record
both payload sizes. JS decoder differences must be explicitly inventoried (same-JS
assertion no longer appropriate), frozen consumer/config/deps stay matched.
Compare current post35 baseline to final canonical candidate. Historical0.3.1 parse
comparison only with a real matched artifact on the same machine; do not relabel
ABI-inclusive raw timing as pure internal Go/WASM. No #40/#41/#42/#43 or publication.

## Canonical artifact and validation

The reviewed source commit is `f23599574896c9502df45744dfb73e2e4602f335`
([PR #49](https://github.com/mike-north/sh-ast/pull/49)). Independent source review
found no blocking correctness issue. Its source-only commit retained the previous
canonical binary; local host builds were used only for development tests.

The Linux artifact was produced by
[WASM reproducibility run 41566344176](https://github.com/mike-north/sh-ast/actions/runs/41566344176),
artifact `13199281891`. Native tests, build and upload succeeded; the final
comparison failed as expected because the source-only commit still contained the
previous binary. The adopted ZIP was verified against the Actions artifact digest:

| Item                    |     Bytes | SHA-256                                                            |
| ----------------------- | --------: | ------------------------------------------------------------------ |
| Artifact ZIP            | 1,333,199 | `1735fb08fa0a85b8f9e75a203dbf8587029177fb0cdec04056cd6f012bed0ed7` |
| Extracted `sh-ast.wasm` | 4,533,132 | `5c8b27246cd4c36057eebfae3a1b114f02b1a026e465193ecf0f00165256831f` |

The ZIP contained exactly one member, `sh-ast.wasm`; its WASM header and bounded
size were checked before adoption. Before the evidence record was updated, the
artifact was the only tracked difference from the source commit, establishing
that the source inventory used for local canonical validation was unchanged.

With that exact Linux binary, Node 22.22.1 and the locked dependencies, these gates
passed on 2026-11-02: full build, workspace check, API extraction and documentation
generation, full workspace tests, and the full native Go shim suite. Nx caches
were disabled for the canonical JavaScript/build/check/docs runs. The test run
included 844 Vitest cases, type tests, 31 benchmark harness unit tests and two
benchmark integration tests. Independent native tests cover all five actual
language variants, all 17 comment-bearing slots, typed nils, shared occurrences,
recovery, per-bound failures and the actual writer order for all 46 records.
The live JavaScript suite compares each independently enumerated parsed node to
separate upstream nodePos/nodeEnd calls across Unicode, CRLF and heredoc fixtures.

Canonical CI reproduction, matched performance/payload measurements and final
acceptance remain separate delivery evidence; these passing gates do not imply
that those later steps or merge have happened.
