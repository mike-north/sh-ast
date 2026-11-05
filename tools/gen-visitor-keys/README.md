# tools/gen-visitor-keys

A Go program that reads mvdan/sh's `syntax` package types — via `go/packages` + `go/types` (real
compiler type information, not a regex scrape of `syntax/nodes.go`) — and emits the checked-in
artifacts `sh-ast` consumes from `packages/sh-ast/generated/`:

- `syntax-types.d.ts` — complete mutable records with upstream field names, precise
  interface unions, explicit null/default values, and all token positions. `Node`
  excludes auxiliary structs; bounds remain operations on the current tree.
- `syntax-constants.js` / `syntax-constants.d.ts` — exact upstream operator and
  language constants. Operator families retain zero and branded raw uint32 values
  without widening ordinary named-token usage to unrestricted numbers.
- `syntax-schema.js` / `syntax-schema.d.ts` — complete field descriptors and true
  node membership for validating and adapting the faithful data model. Their
  deterministic field order is not an upstream traversal order.

The five generated files form one complete data model. Node interface membership,
auxiliary records, scalar defaults, token positions, and operator identities all
come from the same pinned upstream package. There is no normalized projection.

## Running it

From the repo root:

```sh
pnpm run generate:sh-ast-schema
```

This runs the generator against the mvdan/sh version pinned in this directory's own `go.mod`
(kept in lockstep with `packages/sh-ast/shim/go.mod` — both currently pin `v3.14.1`) and then
formats the output with Prettier, so the checked-in files are always diff-reviewable in the
project's normal code style.

CI (`.github/workflows/gen-visitor-keys.yml`) reruns this same script on every push/PR and fails
if `packages/sh-ast/generated` doesn't come back byte-identical — the drift gate for a future
mvdan/sh version bump.

## Determinism

- Every map is walked in sorted key order (node types, fields, interface implementers).
- The only mvdan/sh-version-derived text in the output is the resolved module version reported by
  `go/packages`' `Package.Module.Version` — a fact about the pinned dependency (`go.sum`), not a
  timestamp or VCS stamp.
- No wall-clock time, hostname, or build-machine detail appears anywhere in the output.

## Faithful schema validation

Run `go -C tools/gen-visitor-keys test ./...` from the repository root. The faithful
schema tests use a separately enumerated inventory of the actual pinned Go structs
and reflection over their fields and interface implementations. Representative
operator constants come from compiled upstream values. This checks completeness
independently of the production generator's `go/types` classifier, rather than
comparing generated tables only with one another. A separate command-level test
checks that generation emits exactly the five supported artifacts. Type-level tests in
`packages/sh-ast/test-d/syntax.test-d.ts` additionally exercise mutable records,
explicit nil values, absent-field errors, and operator-family distinctions.

The faithful projection fails generation on an unsupported exported field type or
a discriminator collision. It does not quietly omit new upstream data behind an
index signature. Upstream semantic comments and their license accompany the
generated declarations; runtime validation still owns numeric ranges and coherent
position values.

## Known gap: `BraceExp` is unreachable

`BraceExp` is a real mvdan/sh node type (`Word.Parts` can hold one), but mvdan/sh only produces it
when something explicitly calls `syntax.SplitBraces` on a parsed word — the shim
(`packages/sh-ast/shim/main.go`) never does. The generator still emits a schema entry for it (it's
a real struct implementing `syntax.Node`), but the kitchen-sink coverage test carves it
out as a documented, single exception rather than silently under-covering. Making it reachable
would mean calling `syntax.SplitBraces` from the shim — a parser-behavior change, deliberately out
of scope for this generator work (see design/MILESTONES.md M1 / issue #6's non-goals).
