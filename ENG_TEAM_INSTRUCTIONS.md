# Engineering team instructions

Working agreement for everyone (human or agent) shipping code in this repo. `sh-ast` is a
**faithful synchronous TypeScript/WASM binding to Go syntax**. Read
[AGENTS.md](AGENTS.md) for enforceable layer and fork rules and
[the accepted architecture](design/ARCHITECTURE.md#responsibilities) for their meaning.
It was extracted from the eslint-sh monorepo (`mike-north/eslint-sh` @ `bdd55b3`),
but ESLint's normalized nodes and byte→UTF-16 projection belong to that consumer.
The `sh-ast/analyze` subpath was removed in PR #94. Analysis lives independently
in `mike-north/sh-analysis`; the parser binding remains in `sh-ast` and does not
interpret words or commands.

## Work queue

- GitHub issues are the queue. Before starting one: `gh-queue ground-truth <N>`; if safe,
  claim with `gh-label <N> add "in progress"` + `gh issue comment <N> "<intent>"`.
- Queue config: priority labels are `P1,P2,P3` (`PLEF_PRIORITY_LABELS="P1,P2,P3"` when
  running `gh-queue`). `backlog` and `needs-decision` mean **not for pickup**.
- Acceptance criteria are the contract — map each criterion to a named test in the PR.
  Wrong/unachievable criterion? Comment on the issue before building around it.
- Reference issues with `Refs #N`, never `Closes #N`. Implementers **stop at PR-open**;
  the orchestrator runs review and merge. Reply to every review thread; only the
  orchestrator resolves threads.
- The required review-presence check is `codex-review-present`, implemented by
  `.github/workflows/codex-review-gate.yml`. Only fresh PR conversation-thread
  comments count. A comment must have actual API author login
  `chatgpt-codex-connector` or `chatgpt-codex-connector[bot]` and exactly one of:
  an exact `<!-- codex-review-receipt:v1 -->` marker with a **Reviewed commit:**
  backticked hexadecimal prefix of at least seven characters matching the current
  head, or a `codex-review-state:v1` JSON marker whose `code_review.status` is
  `completed` and `code_review.commit_sha` equals the full current head SHA.
  Finding flags do not affect presence. Other authors, stale heads, malformed or
  ambiguous markers, prose, security-only state, and submitted review objects do
  not satisfy it. Body text claiming bot identity is never authority.
  The gate reads every comment page and rechecks the head before completing the
  explicit `codex-review-present` check on the API-reported PR head. Trusted
  `pull_request_target` lifecycle and `issue_comment` created/edited/deleted events
  request fresh evaluations; event payloads cannot supply completion evidence.
  Missing/pending/stale evidence fails only the explicit check, including when a
  well-formed new head is observed during pagination or the final lookup. That
  check remains bound to its original head. The distinct native
  evaluator job reports infrastructure health: API/script failures fail it and
  the head check when that check can be written. The workflow does
  not check out or execute PR code. Request review with a PR conversation comment
  `@codex review`, once on each new head, then verify completed evidence actually
  landed; a request alone is insufficient. Presence is not approval or finding resolution.
  The lead reviewer remains responsible for substantive review and merge readiness.
  Copilot reviews remain optional.
- Main moves under you — branch late, expect rebases; "no checks reported" on a PR usually
  means a merge conflict suppressed CI: check mergeability first.

## Building

- Toolchain: Node 22 (`.nvmrc`), pnpm 11.12, `engine-strict`. Go (version pinned in
  `packages/sh-ast/shim/go.mod`) for the WASM shim.
- Commands: `pnpm install` → `pnpm build` → `pnpm check` → `pnpm test`, all green before
  every push; prettier before every push. Never `rm` build outputs — `pnpm run clean` /
  `pnpm --filter <pkg> run clean`.
- `check:typecheck` checks source, runtime tests, and generated declarations with the
  compiler, and type-contract fixtures with tsd across `.ts`, `.tsx`, `.mts`, and
  `.cts`. Typed ESLint does not report compiler diagnostics. Intentional malformed
  runtime fixtures need a local, explained `@ts-expect-error`; rejected API calls
  in type-contract fixtures retain their `expectError` assertions.
- Public-surface changes: regenerate the API report (`fix:api-report`) and `pnpm build:docs`,
  commit both — CI checks the API report and regenerated documentation. Keep large
  generated-doc changes in their own commit and identify them in the PR so reviewers
  can inspect the source diff separately. Manual substantive review does not
  substitute for the required Codex presence check.
- Nx cache is unreliable for doc-comment-only edits (no API shape change): a cached
  `check:api-report`/docs regen can show "no diff" when the real output changed. After any
  doc-comment edit, regenerate with `--skip-nx-cache` (or `NX_SKIP_NX_CACHE=true`) and
  verify by inspecting the output files, not the cache's word.
- Changesets required for published-package behavior/type changes; the project stays in the 0.x
  series until the owner declares the shape stable. There is no override flag.
- Commit author: `Mike North <michael.l.north@gmail.com>` (`--author` on every commit).
  No AI-attribution trailers.
- **The committed `shim/sh-ast.wasm` is canonical for linux/amd64 CI.** Go wasm output is
  host-specific: a darwin/arm64 build will NOT byte-match, and that's expected. Never commit
  a locally built wasm; shim changes must let the `rebuild-match` ubuntu job regenerate and
  verify (build flags: `-buildvcs=false -trimpath -ldflags="-s -w -buildid="`).
- Known-heavy tests (WASM warm-up, large fixtures) get explicit vitest timeouts.
- One writer per worktree path; spawn your own worktree.

## Standing quality gates

- **Independent ground truth.** A check that draws its expectation from the same source or
  environment as the thing under test proves nothing (a generator-derived coverage test, a
  same-host reproducibility check). Every verification must name its independent ground
  truth — upstream mvdan/sh structs, the linux CI builder, a hand-derived expected value.
- **Review-fix verification.** In a review-fix cycle, "the fix commit exists + CI is green +
  the threads were replied to" does NOT mean the reported defect is fixed. Trace the corrected
  code by hand against the EXACT input the reviewer reported, and confirm a regression test
  exercises that specific input, proven failing pre-fix and passing post-fix. A
  superficially-plausible fix (skipping a token but resuming the same wrong parse) plus a
  too-weak test (covers an easier case) sails through CI while the reported bug stays live.
  Grepping that the fix is _present_ is not tracing that it is _correct_.
- Multibyte fixtures (emoji, CJK, combining marks) are mandatory for anything touching
  ranges, positions, or offsets.
- **Facts, not verdicts.** The independent analysis layer reports syntactic facts (argv, staticness,
  context, wrapper chains); it never embeds a caller's policy (no safety judgments, no
  hardcoded wrapper/command lists beyond documented, overridable defaults). "Unknowable" is
  a first-class result, not an error.
- Observable syntax/binding changes use the applicable 0.x **minor** release;
  the changelog names the exact Go dependency, including a fork revision when used.
  There are no users to preserve compatibility for: make necessary hard breaks and
  update consumers, without aliases or migration layers.
- Never touch release/Version PRs; releases happen only through the CI pipeline.
