# Engineering team instructions

Working agreement for everyone (human or agent) shipping code in this repo. `sh-ast` is a
**faithful synchronous TypeScript/WASM binding to Go syntax**. Read
[AGENTS.md](AGENTS.md) for enforceable layer and fork rules and
[the accepted architecture](design/ARCHITECTURE.md#responsibilities) for their meaning.
It was extracted from the eslint-sh monorepo (`mike-north/eslint-sh` @ `bdd55b3`),
but ESLint's normalized nodes and byte→UTF-16 projection belong to that consumer.
Existing `sh-ast/analyze` is to be extracted into an independent analysis layer;
its presence does not authorize adding interpretation to this binding.

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
  `.github/workflows/codex-review-gate.yml`. It accepts a normal Codex review in
  COMMENTED, APPROVED, or CHANGES_REQUESTED state from `chatgpt-codex-connector`.
  Pending, dismissed, missing, and other authors' reviews do not satisfy it.
  Verify completed evidence actually landed; a review request alone is insufficient.
  Presence is not approval, resolution of findings, or an assertion that the current
  head was reviewed. The lead reviewer remains responsible for substantive review
  and merge readiness. Copilot reviews remain optional.
- Main moves under you — branch late, expect rebases; "no checks reported" on a PR usually
  means a merge conflict suppressed CI: check mergeability first.

## Building

- Toolchain: Node 22 (`.nvmrc`), pnpm 11.12, `engine-strict`. Go (version pinned in
  `packages/sh-ast/shim/go.mod`) for the WASM shim.
- Commands: `pnpm install` → `pnpm build` → `pnpm check` → `pnpm test`, all green before
  every push; prettier before every push. Never `rm` build outputs — `pnpm run clean` /
  `pnpm --filter <pkg> run clean`.
- Public-surface changes: regenerate the API report (`fix:api-report`) and `pnpm build:docs`,
  commit both — no CI gate covers committed docs. Keep large generated-doc changes in
  their own commit and identify them in the PR so reviewers can inspect the source
  diff separately. Manual substantive review does not substitute for the required
  Codex presence check.
- Nx cache is unreliable for doc-comment-only edits (no API shape change): a cached
  `check:api-report`/docs regen can show "no diff" when the real output changed. After any
  doc-comment edit, regenerate with `--skip-nx-cache` (or `NX_SKIP_NX_CACHE=true`) and
  verify by inspecting the output files, not the cache's word.
- Changesets required for published-package behavior/type changes; never `major` without an
  issue authorizing it.
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
