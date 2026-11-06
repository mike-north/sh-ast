# Fork-source migration work record

## Scope and authority

The accepted 2026-11-05 four-layer direction puts all changes to the underlying
Go syntax library in a maintained Go fork. This binding consumes one immutable
revision for both schema and WASM; it does not apply a semantic patch stack.
This work handles dependency/build routing and inventory for later analysis
extraction. Analysis remains in its existing location until its independent
package destination and public-operation contracts are selected.

## Tests-first evidence

- New source-identity refusal tests were written before the verifier, initially
  failing with missing `verify-go-source.mjs`, then passing 12 cases on Node 22.22.1.
- Cache-integrity expectations then failed twice: no `go mod verify` invocations
  were observed, and altered-cache failure was incorrectly accepted. Adding Go's
  verification for both consumers made all 13 unit cases pass.
- Generator provenance tests failed to compile before `syntaxSourceIdentity`
  existed, then passed. Expected values are explicit module identities, including
  a fork replacement under the same original upstream release requirement.
- The real isolated-cache test initially caught a false acceptance even after
  `go mod verify`: Go verifies original build-list module paths rather than the
  remote replacement source path. The standard `golang.org/x/mod/sumdb/dirhash`
  helper now hashes the actual selected replacement archive and expanded source.
  All 14 source-identity tests pass, including real copied-cache tampering with
  unchanged origin/zip metadata. Shared module caches were not modified.
- Selected-Go Zsh expectations failed against the former patch stack (wildcard
  refusal, hidden substitutions, and recursive work on opaque text), then the
  native bridge tests passed against the published fork. Public TypeScript
  expectations also fail against the previous binary, pending canonical rebuild.

## Selected source

Public fork: `github.com/mike-north/sh`, branch `shast/syntax-v3.14.1`, immutable
revision `bbc7c4ace575d5de375726fdaa2a5c001c46564c`. Go resolved this through its
normal proxy/checksum path as
`github.com/mike-north/sh/v3@v3.14.2-0.20261106043227-bbc7c4ace575`, checksum
`h1:dm2hfQDs8359vB9QziwgnoY/Nsp02ut9jUY0HibSPBc=`; the reported full Origin.Hash
matches the committed pin. Both effective consumer graphs and their current
module caches pass source verification. The original module path remains
`mvdan.cc/sh/v3`; the remote replacement selects the fork source.

The old in-repository source closure, semantic patch files, patch manifests, and
reverse-patch verifier are removed. Fork correctness evidence and delta upkeep
now live in the Go repository. Canonical Linux binary receipt and final head
checks will be recorded after they exist. No locally built Darwin WASM is
accepted as release evidence.

## Analysis extraction inventory

Current public syntax APIs already supply faithful records/constants,
`SYNTAX_SCHEMA`, `SYNTAX_INTERFACES`, and `nodePos`. Those replace analysis imports
of generated internals and `../syntax.js` without adding binding responsibilities.
`nodeArray`, literal/ANSI-C decoders, context traversal, wrapper/interpreter
models, deep-freezing analysis tables, and analysis failures belong with the
independent analysis package. Syntax-root analysis error exports and the existing
`sh-ast/analyze` entry point are removal work for that extraction, not forwarding
aliases to preserve here.

The actual private bridge dependency was
`src/analyze/brace-observation.ts` -> private `encodeWire`/`decodeWire` and
`callSyntax('word-braces', ...)`. That classification operation discarded Go's
rewritten Word and boolean. It is removed in favor of the selected public
synchronous `splitBraces(word: Word): boolean` syntax operation. Existing analysis
uses it on an isolated copy while extraction proceeds; the independent package
can consume it entirely through the root public API.

The selected mutation contract retains the Word root. False retains its Parts
array and all child identities. True follows Go's Parts replacement while a
narrow native input-occurrence observation restores original WordPart objects
that Go actually reused, including within new brace elements. This is not a
general Go pointer/storage emulation. New split Literals retain copied upstream
position values. Native tests compare exact booleans and transformed records,
including malformed/singleton true results with no BraceExp, plus independent
pointer-reuse observations, byte strings, nil parts, and operation failures.
TypeScript tests pin alias/snapshot meaning and synchronous cold first use.

The analysis package owns inspecting resulting BraceExp records, escape
uncertainty, dialect assumptions, and known/unknown/unsupported meaning. The
binding exposes no analysis-specific `hasBraces` service.

The selected Go fork is intended to retain v3.14.1's raw Zsh reverse-subscript
patterns, dropping the former compatibility patch. Text such as `$(printf foo)`
can therefore be inside an opaque literal rather than a CmdSubst/CallExpr node.
A syntax-node inventory cannot infer that no nested command executes. The future
analysis contract must report the resulting uncertainty or explicitly limit its
claim to represented syntax nodes; changing parser output to satisfy inventory
completeness is outside its ownership.
