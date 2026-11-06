# Project responsibility rules

Read [the accepted architecture](design/ARCHITECTURE.md#responsibilities) and
[the engineering agreement](ENG_TEAM_INSTRUCTIONS.md) before implementing or
reviewing a change. These rules apply to humans, coding agents, and reviewers.

## Keep work in its owning layer

| Layer                                                         | Owns                                                                                                                                                                                                  | Does not own                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Go syntax implementation (`mvdan/sh`, or our maintained fork) | Grammar, dialects, syntax records and positions, valid/invalid input handling, parser behavior, syntax traversal semantics, and printer behavior                                                      | ESLint views, lint rules, or command-policy decisions                                                             |
| `sh-ast` TypeScript/WASM binding                              | Faithful typed access to the selected Go implementation, synchronous first-use parsing, lossless transport, restrained error adaptation, runtime lifetimes, and explicit binding resource constraints | A second shell grammar, command/word interpretation, wrapper or interpreter-option models, or ESLint projections  |
| Independent analysis middle layer                             | Word resolution, command enumeration/context, wrapper resolution, interpreter-invocation observations, and explicit analysis uncertainty over faithful syntax                                         | Changing parser output to improve analysis, executing shell programs, or deciding a caller's lint/security policy |
| ESLint integration in `eslint-sh`                             | ESLint nodes and visitors, byte-to-UTF-16 projection, diagnostics, rule policy, and fixes                                                                                                             | Defining syntax semantics or pushing lint requirements into the binding                                           |

The middle layer's package/repository name is not yet selected. Existing
`sh-ast/analyze` code is extraction work, not permission to expand `sh-ast`'s
responsibility. Follow [the realignment plan](design/LAYER-REALIGNMENT.md).
Dependencies point from consumers toward syntax: analysis depends on `sh-ast`;
ESLint consumes syntax and analysis. `sh-ast` must not depend on either consumer.

## Fix Go behavior in a Go fork

Any changes to the underlying Go library belong in a maintained fork. Commit
fixes there, pin an immutable revision containing them, and build the WASM bundle
and generated schema from that same source. Do not wait for upstream acceptance
before depending on our fixes. Do not maintain the underlying library's semantic
patch stack inside the TypeScript binding repository. Binding-specific shim code
remains here; this rule concerns changes to the underlying library.

Maintaining the fork includes observing upstream changes, incorporating applicable
changes, and checking which fixes upstream has absorbed. Return to an upstream
dependency when it contains the required behavior. No recurring automation or
update cadence is implied by this instruction.

## Review against intent

- There are no users of this TypeScript library. Make hard breaks when the model
  requires them; do not add compatibility aliases, shims, or migration layers to
  preserve earlier APIs or output. Update consumers to the intended contract.
- Require the PR to identify its owning layer. Reject changes that redefine
  syntax for analysis or lint convenience, even if downstream tests pass.
- A demonstrated Go bug can justify a fork fix. An old TypeScript test expectation
  alone cannot. Separate independent correctness evidence from compatibility.
- Write specification/outcome-derived tests before software changes. Verify the
  binding against the exact selected Go revision; verify intentional fork deltas
  with independent syntax or real-shell evidence.
- Document durable semantic intent, responsibilities, boundaries, and invariants
  in code comments. Keep progress and completion notes in work records.
- Preserve genuinely synchronous first use. Do not add mandatory asynchronous
  initialization to satisfy another layer's implementation preference.
