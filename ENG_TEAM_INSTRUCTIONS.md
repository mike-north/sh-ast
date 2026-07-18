# Engineering team instructions

Working agreement for everyone (human or agent) shipping code in this repo. `sh-ast` is a
**synchronous, fully-typed mvdan/sh shell AST for JavaScript** — parsing plus a syntactic
analysis layer (`sh-ast/analyze`). It was extracted from the eslint-sh monorepo
(`mike-north/eslint-sh` @ `bdd55b3`), whose `design/ARCHITECTURE.md` remains the reference
for the serialization contract, byte→UTF-16 conversion, and normalized node shape.

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
- Copilot review requests can drop silently (binary-heavy PRs especially), and Copilot
  removes itself from requested_reviewers WHILE reviewing — "no request + no review" may
  mean in-progress. Use a grace period; verify a review actually landed.
- Main moves under you — branch late, expect rebases; "no checks reported" on a PR usually
  means a merge conflict suppressed CI: check mergeability first.

## Building

- Toolchain: Node 22 (`.nvmrc`), pnpm 11.12, `engine-strict`. Go (version pinned in
  `packages/sh-ast/shim/go.mod`) for the WASM shim.
- Commands: `pnpm install` → `pnpm build` → `pnpm check` → `pnpm test`, all green before
  every push; prettier before every push. Never `rm` build outputs — `pnpm run clean` /
  `pnpm --filter <pkg> run clean`.
- Public-surface changes: regenerate the API report (`fix:api-report`) and `pnpm build:docs`,
  commit both — no CI gate covers committed docs.
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
- Multibyte fixtures (emoji, CJK, combining marks) are mandatory for anything touching
  ranges, positions, or offsets.
- **Facts, not verdicts.** The analyze layer reports syntactic facts (argv, staticness,
  context, wrapper chains); it never embeds a caller's policy (no safety judgments, no
  hardcoded wrapper/command lists beyond documented, overridable defaults). "Unknowable" is
  a first-class result, not an error.
- Any change to normalized-AST output or analyze results on unchanged input is at least a
  **minor** release; the changelog names the pinned mvdan/sh version.
- Never touch release/Version PRs; releases happen only through the CI pipeline.
