# Brace classification evidence

The outcome contract and deliberate conservative boundary are recorded in
[the decision](../../BRACE-CLASSIFICATION-DECISION.md).

## Upstream versus shell probe

`upstream-probe.go` compares the same parsed Word through pinned mvdan/sh
v3.13.1 `SplitBraces`/`expand.Fields` (the latter calls FieldsSeq) and `/bin/bash`
using a fixed set of harmless argument fixtures. No external commands from the
fixture are executed: Bash prints its expanded arguments using builtin printf.
Run from `packages/sh-ast/shim`:

```sh
go run ../../../design/validation/brace-classification/upstream-probe.go
```

`upstream-bash-observations.jsonl` retains observed output on macOS arm64 with
GNU Bash 3.2.57. These observations demonstrate the escape discrepancy; the
library does not execute a shell or expand fields. Test expectations use
hand-derived quoting/brace semantics, plus the explicit conservative policy.

## Analyzer workload

After building the package, from the repository root:

```sh
node design/validation/brace-classification/benchmark.mjs .
```

Each workload resolves 100 command sites and effective commands on a pre-parsed
File, with 10 warmups and 30 measured samples. Ordinary and brace-heavy inputs
separate the fast filter's cost from the cost of required upstream observations.
Parsing and cold initialization are deliberately outside the timed region.
The script checks command counts and effective names; dynamic argument counts
record the changed correctness outcome. There are no flaky latency assertions.

`before.json` is an exploratory local baseline with canonical pre-change WASM,
Node 22.22.1, and potentially concurrent machine work. It is not a performance
acceptance result; comparisons must record exact candidate asset identity and
quiet-window conditions.

`quiet-comparison.json` contains six alternating before/after fresh-process
rounds on Node 22.22.1. Team agents paused builds/tests during collection, though
unrelated host activity was not controlled. The baseline uses source at
`3fecd43`, compiled with TypeScript ES2022, and its committed canonical WASM;
the candidate uses local darwin/arm64 Go 1.26.5 plus wasm-opt 131 output. The
candidate is the pre-review implementation at `e08e12b`; it is preliminary
host-built evidence, not a measurement of the corrected adjacent-Lit classifier
or canonical CI verification.

| Workload (100 commands) | Before round medians | After round medians | Median paired change |
| ----------------------- | -------------------- | ------------------- | -------------------- |
| Ordinary                | 6.00–7.89 ms         | 5.84–8.30 ms        | +0.302 ms            |
| Brace-heavy             | 5.91–9.36 ms         | 7.97–9.66 ms        | +1.151 ms            |

The brace workload changes from zero to 100 correctly non-static arguments.
Ordinary intervals overlap substantially. Brace paired differences range from
−1.150 to +3.748 ms, so these samples describe cost and variability, not a
stable latency promise or formal significance result.

## Validation and acceptance coverage

The initial revised JS outcome table produced 23 failures and 12 passes before
implementation. Afterward, all 37 focused tests passed (two additional tests
cover no-WASM ordinary inputs and adjacent literal parts). The Go bridge tests
failed on the absent operation before implementation and pass afterward.

- AC1/AC6: `reports potential brace expansion`, `keeps quoted, escaped,
malformed or non-expanding`, and `declines escape-uncertain brace candidate`
  cover lists, sequences, malformed braces, Unicode, quoting, and parity.
- AC2: `command analyses inherit brace facts` covers direct and sudo-wrapped
  invocation; argv and effective-command results both carry the reason.
- AC3: `conservatively reports potential braces without inferring the parser
dialect` establishes the documented dialect-independent posture.
- AC4: `TestBraceObservationMatchesActualUpstreamParts` and
  `TestSplitBracesBooleanDoesNotIdentifyExpansion` use pinned upstream as the
  independent grammar oracle and demonstrate the corrected acceptance rule.
- AC5: README, generated API documentation, and the decision document describe
  current behavior; parser output is explicitly unchanged.
- Mutation boundaries: `preserves caller records, aliases, source positions and
printed output` and `observes current edits` guard isolation and freshness.

Local validation passed: `pnpm build`, `pnpm check`, `pnpm test` (703 runtime
cases, type tests, and benchmark harness tests), and shim `go test ./...`.
API documentation was regenerated without Nx cache. These runtime tests used
the local candidate WASM; the source PR must adopt the exact Linux CI artifact
and pass validation again before acceptance. No local WASM is committed.

## Review regression

Independent review found that the first classifier reset backslash parity at
each Lit. The exact constructed Word with Parts values `"\\"` and
`"\\{a,b}"` printed two backslashes before the brace expansion but returned a
false static value. The named `declines escape uncertainty when backslash parity
crosses adjacent Lit parts` test failed on that implementation and passes after
carrying lexical state across adjacent literals. Broader boundary tests also
failed for one- and three-backslash splits before the conservative
escape-crosses-part guard. All 47 focused cases now pass, including delimiter
splits, nested expansions and quoted-part boundaries.
