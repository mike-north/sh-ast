# Native parser budget: canonical caller evidence

The recorded campaign exercised the public synchronous `parseSync` and
`parseWithPositionsSync` exports through real ESLint 10.7.0 `Linter.verify` →
`ParserService.parseSync` → `ShellLanguage.parse` dispatch. Source commit
`fde98d054ef66a1ed9d62d933e28ff64da252c27` is unchanged in canonical artifact commit
`a40450d31c9cd94caf2f624525a8a11449c2df71`. The exact Linux binary and archive/build
provenance are in [canonical-artifact.json](canonical-artifact.json).

[canonical-caller-results.json](canonical-caller-results.json) contains the
previously recorded observations, not a newly run portable harness. The campaign
used Node 22.22.1 on Darwin arm64, macOS kernel 27.2.0 / Apple M5 Max, with the
Linux-built Go 1.26.10 / binaryen 131 WASM. Its 44 fresh child configurations made
736 primary synchronous calls. Six grammar families cover accepted/refused native
boundaries with 20 repetitions per child. Flat 50,000-comment and three-block
150,000-comment inputs cover both KeepComments values with two repetitions. Both
parse operations run every input; RecoverErrors alternates 0/100000 by input index.
Every typed refusal is followed by a successful small parse in the same WASM
instance. All observed outcomes are stable; children exit normally without raw
errors or timeouts. `caller-inputs.json` and `caller-inputs.mjs` pin exact source
bytes by SHA-256 without storing megabytes of repetitive comment text.

The worker replaces the prepared `ShellLanguage` instance's `parse` method with
an instrumented callback that calls the current public parser. It then returns a
controlled ESLint diagnostic so downstream AST adaptation/traversal is excluded.
The real synchronous ESLint caller frames remain. This demonstrates the recorded
ordinary caller shape, not end-to-end linting, arbitrary pre-existing JavaScript
recursion, universal host-stack safety, other AST operations, or performance.
The separate earlier 8,424-call prototype campaign is not this final-artifact run.
Root's separately reported independent 66-test check is not included in these
implementer-recorded observations.

## Offline verification

From this repository root, using Node 22.22.1:

```sh
node design/validation/parse-depth-coverage/evidence-check.mjs
```

This checks the recorded counts, every expected outcome/status/signal/iteration
and refusal reuse, input hashes, source/artifact identities, and current binary.
It does not execute WASM or claim to rerun the campaign.

## Reproduction

Build this repository's public JavaScript with `pnpm build`; keep the committed
canonical WASM. The consumer used for the recording was `mike-north/eslint-sh`
commit `6747c0cb6aaea416c35296ded2694cfb4fad913e`, plugin version 0.5.0, compiled with
TypeScript 6.0.3 against its frozen dependency lock. `caller-manifest.json` records
that lock/archive identity and hashes the actual ESLint entry, linter, parser
service, and emitted ShellLanguage. A prepared consumer directory must contain
`dist/language/shell-language.js` and a `node_modules` installation resolving
ESLint 10.7.0 and the plugin's dependencies. One way to prepare that directory is:

```sh
git clone https://github.com/mike-north/eslint-sh.git /tmp/eslint-sh-native-budget
git -C /tmp/eslint-sh-native-budget checkout 6747c0cb6aaea416c35296ded2694cfb4fad913e
(cd /tmp/eslint-sh-native-budget && pnpm install --frozen-lockfile && pnpm build)
```

Use `/tmp/eslint-sh-native-budget/packages/eslint-plugin` as the consumer directory.
The recording used the repository's existing `stream-encoding-prepare.mjs`
preparation machinery to freeze this same source/installed dependency closure;
no local absolute path is required by the portable harness. The listed rebuild
commands are reproduction instructions, not a claim that this alternate fresh
checkout was executed during evidence publication. The harness rejects mismatched
Node, WASM, and captured caller-file hashes before starting a campaign. Review a
mismatch rather than silently replacing the recorded identities.

```sh
node design/validation/parse-depth-coverage/caller-probe.mjs \
  /tmp/eslint-sh-native-budget/packages/eslint-plugin \
  /tmp/native-budget-new-observations.json
```

Each child has a 15-second deadline and 1 MiB output cap. A new run writes a new
output file exclusively; it cannot overwrite the committed historical results.
The portable driver/worker retain the recorded loop and callback behavior, with
paths parameterized and explicit preflight identity checks added. Their syntax,
input reconstruction, and offline evidence checks were validated during
publication; the 736-call campaign was not selectively rerun to produce a new
favorable report. The original scratch driver/worker hashes remain in the manifest
for provenance.
