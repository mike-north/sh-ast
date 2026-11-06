# Independent editable syntax copies

Use the platform `structuredClone(node)` operation, without a transfer list, to
copy a parsed `File` or any `Node` subtree. No `copySyntax` API is needed: faithful
syntax records are plain data, and the platform already copies their represented
values and reference relationships. This is the supported independent-copy
contract for [issue #41](https://github.com/mike-north/sh-ast/issues/41).

The [HTML structured data algorithms](https://html.spec.whatwg.org/multipage/structured-data.html)
provide the copying mechanism. The package guarantees that its syntax data remains
suitable for that mechanism and for the existing operations described below.
This decision does not extend the contract to caller-added functions, shared
memory, custom objects or cyclic syntax graphs. Transfer lists are outside this
independent-copy recipe because transferring a buffer can detach the original.

## Ownership, identity and positions

Cloning copies the entire reachable syntax graph. Records, ordinary arrays,
position objects and byte buffers are separate from the original. A `GoString`
represented as `Uint8Array` keeps its byte representation; a `TypedNil` tag keeps
its concrete `Kind`. Repeated references in the cloned graph still share one
copied target. Objects do not retain links to the original graph: an external
holder of an original child keeps that original, while references to the child
inside the copy refer to its new counterpart.

Position fields are copied values describing the original source. Cloning does
not relocate a node, rebase offsets, or create new source coordinates. Before
edits, a copied node's live `nodePos`/`nodeEnd` outcomes match the original's.
After edits, those operations continue to compute from the current copied data.

A `PositionSnapshot` belongs to original node identities. Every copied node is
foreign to it, so `Positions.get(copiedNode)` returns `undefined`. Retain the
original node to look up an original span while editing its copy for a printed
fix. Clone `parsed.File` or a selected node, not the `ParsedFile` container or its
function-bearing `Positions` lookup.

## Operation boundaries

A structurally valid acyclic copied subtree is accepted by operations under the
same rules as the original. `walk` preserves its existing traversal and mutation
contract. `nodePos` and `nodeEnd` retain independent upstream success or failure.
Analysis of copied syntax belongs to the independent `sh-analysis` layer; its
function-specific input domains and results are outside this syntax contract.

`printSync` supports File, Stmt, Word, Assign, Command and WordPart roots. Copying
other Nodes does not make them printable. File output alone has the upstream
trailing-newline behavior. Preserving a `TypedNil` tag is a data guarantee, not a
promise that a nil receiver succeeds in every operation.

The byte-and-typed-nil printer fixture makes this distinction concrete: a File
contains a consumer-edited non-UTF-8 Lit and a ParamExp with its ordinary Param
plus a `TypedNil<'Lit'>` NestedParam. The upstream printer prioritizes Param and
ignores NestedParam, so the cloned File prints the hand-derived byte output while
its tag remains intact. A separate `TypedNil<'Word'>` root still raises the
existing PrintPanicError; an ordinary copied Comment root still raises PrintError.
This is not a claim that `parseSync(printSync(copy))` reconstructs a TypedNil tag.

Printing remains upstream formatting, without source-byte preservation or
re-indentation to the original column. Neither original-tree freezing nor a new
snapshot for copied identities is part of this decision.

## Outcome tests

`packages/sh-ast/test/structured-clone.test.ts` was added before contract text or
API-comment changes and passes against the unchanged implementation:

| Contract                                                                                                                                                   | Named test                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Independent edits and hand-written output for File, nested Stmt, Word and CallExpr; original values, print and both bounds unchanged                       | `edits a copied $name with hand-derived printed output and leaves original intact` (four cases)      |
| Original position values and fresh identities, including comments; both live bounds equal original snapshot; every copied stored Node absent from snapshot | `copies original position values while every copied stored Node is foreign to the original snapshot` |
| Exact syntax entry order                                                                                                                                   | `walks the copied subtree in the hand-derived original syntax order`                                 |
| Non-UTF-8 byte buffer ownership, represented typed-nil data, successful supported printing and unchanged upstream error boundaries                         | `retains Uint8Array bytes and TypedNil data without changing existing printer semantics`             |
| Internal aliases and independent external holders                                                                                                          | `preserves aliases inside the reachable copy while external holders keep original objects`           |

Printed expected strings/bytes and traversal sequence are hand-derived, rather
than produced by the operation being tested. The fixtures include emoji, CJK and
combining marks. Stored-node identity checks use field traversal, avoiding Walk's
specialized comment callback copies.
