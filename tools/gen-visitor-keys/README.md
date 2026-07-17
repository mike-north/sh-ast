# tools/gen-visitor-keys

A Go program that reads mvdan/sh's `syntax` package types — via `go/packages` + `go/types` (real
compiler type information, not a regex scrape of `syntax/nodes.go`) — and emits the checked-in
artifacts `sh-ast` consumes from `packages/sh-ast/generated/`:

- `visitor-keys.js` / `visitor-keys.d.ts` — per-node-type traversal keys (lowercased field names,
  matching the normalizer's output shape)
- `child-type-schema.js` / `child-type-schema.d.ts` — the `(parentType, fieldName) -> childType`
  table for struct-typed children that mvdan's `typedjson` package leaves undiscriminated
- `node-types.d.ts` — `ShNode` subtypes for every node type, plus per-interface union aliases
  (`ShCommandNode`, `ShWordPartNode`, …) and an `ShAnyNode`/`ShNodeTypeName` union of everything

See `design/ARCHITECTURE.md`, "The schema table is generated, not hand-written", for why this
exists: the tables are two projections of the same information (mvdan/sh's node struct
definitions) and a hand-written subset was already bitten by a missing entry
(`DeclClause.Variant`).

## Running it

From the repo root:

```sh
pnpm run generate:sh-ast-schema
```

This runs the generator against the mvdan/sh version pinned in this directory's own `go.mod`
(kept in lockstep with `packages/sh-ast/shim/go.mod` — both currently pin `v3.13.1`) and then
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

## Known gap: `BraceExp` is unreachable

`BraceExp` is a real mvdan/sh node type (`Word.Parts` can hold one), but mvdan/sh only produces it
when something explicitly calls `syntax.SplitBraces` on a parsed word — the shim
(`packages/sh-ast/shim/main.go`) never does. The generator still emits a schema entry for it (it's
a real struct implementing `syntax.Node`), but the kitchen-sink coverage test carves it
out as a documented, single exception rather than silently under-covering. Making it reachable
would mean calling `syntax.SplitBraces` from the shim — a parser-behavior change, deliberately out
of scope for this generator work (see design/MILESTONES.md M1 / issue #6's non-goals).
