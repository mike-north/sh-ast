---
'sh-ast': minor
---

Generated node types (`node-types.d.ts`) now give every scalar leaf field a concrete TypeScript type instead of leaving it as `unknown` — e.g. `ShLitNode.value: string | undefined`, `ShStmtNode.negated: boolean | undefined`, `ShRedirectNode.op: number | undefined` (see issue #22). `tools/gen-visitor-keys` was only classifying node-reference/interface-union child fields; plain scalars fell through to the `[field: string]: unknown` catch-all every node still carries.

Types are derived from the pinned `mvdan.cc/sh/v3 v3.13.1` struct definitions plus the shim's actual runtime serialization: `bool`/`string` fields map straight through, and mvdan/sh's `uint32`-backed operator-enum fields (`RedirOperator`, `BinAritOperator`, `CaseOperator`, ...) are typed `number` — those types implement only `fmt.Stringer`, not `json.Marshaler`, so the shim's encoder serializes them as plain JSON numbers, not string tokens.

Every generated interface still carries `[field: string]: unknown` as an escape hatch for fields this generator doesn't yet classify — this is unchanged and intentional, not a hedge against the newly-typed fields.
