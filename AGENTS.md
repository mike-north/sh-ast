# Contributor and coding-agent instructions

These rules apply to everyone who changes or reviews this repository: maintainers,
outside contributors, and coding agents. For setup and the contribution workflow see
[CONTRIBUTING.md](CONTRIBUTING.md); for vulnerability reports see [SECURITY.md](SECURITY.md).

`sh-ast` is a faithful, synchronous TypeScript binding, through WebAssembly, of the
shell syntax package in a maintained Go fork of [mvdan/sh](https://github.com/mvdan/sh).
Its responsibilities and boundaries are defined in the ecosystem map below and in
[the accepted architecture](design/ARCHITECTURE.md#responsibilities). Read both before
implementing or reviewing a change.

<!-- ecosystem-map:begin -->
# Ecosystem map

Map version: 3. This file is kept verbatim, byte for byte, in every repository of the
ecosystem. It changes only by a decision of the owner (Mike North), with the version number
raised, and the new text is then copied to every repository in one pass. A copy that differs
from the others is a defect in that repository, not a local variant. Nothing in this file names
a branch, a commit, a terminal, a date, or a person other than the owner, so that it never has to
change for operational reasons.

## Purpose of the ecosystem

Agents propose tools (small programs) for their own autonomous use. While proposing, the agent
gets fast feedback on what the tool reaches and whether that fits policy. A human reviews and
approves quickly, on GitHub. Approved tools become eligible for unattended use, and the human is
told when an approved tool changes in a way that warrants another look.

Six layers each own one concern, and one delivery component (sarif-to-comment) carries
results into code review. Work that belongs to another layer goes there, even when
it would be quicker to do it here. When a needed capability sits in another layer and does not
exist yet, add it there, or record the gap in that repository, rather than approximating it here.

## Layers

### sh-ast

Owns: shell syntax. A faithful TypeScript binding, through WebAssembly, of our own maintained
Go fork of mvdan/sh (mike-north/sh): the AST and its types, positions, traversal, printing. The
grammar itself lives in the fork. Any fix the ecosystem needs in the grammar or lexer lands in
the fork and arrives here through the binding; we never wait on an upstream mvdan/sh pull
request being accepted.

Must not: interpret words, resolve commands, track working directories, or express any policy.
Decide shell structure from source text in TypeScript: where a token, word, quoted string, or
heredoc body begins and ends is the parser's answer, read from AST nodes and positions, never
recomputed by scanning the text.

Straying signs: TypeScript that scans shell text to find structure (a lexer, tokenizer, or
heredoc scanner) anywhere in the ecosystem. A guard that derives every position from sh-ast
nodes is consumption of the binding and is allowed; if such a guard exists only because the
binding's positions are imprecise, that imprecision is a sh-ast (or fork) defect to fix in the
fork.

### sh-analysis

Owns: higher-level syntactic constructs over sh-ast, so that common analysis needs are easy to
express: word resolution, command sites and argv0, wrapper chains (sudo, env, command, xargs and
the like), interpreter invocations, working-directory and path facts, each with explicit
uncertainty. Command and dependency harvesting (what a script invokes) lives here. These are
facts about the text, not about what a command means: sh-analysis can say "argv0 resolves to
curl with these arguments"; it never says "this reaches the network".

Must not: parse shell itself, decide what is allowed, format diagnostics, or know about ESLint,
hosts, or agents.

Straying signs: code that returns a verdict, a severity, or advice instead of a fact.

### eslint-sh

Owns: lint policy for shell files on disk. The ESLint language for shell, rules, presets, fixes,
and the projection of sh-analysis facts into diagnostics. Exposes the shell evaluator that
toolprep compiles its policy into.

Must not: intercept commands at run time, reimplement word or command resolution, or approve
tools.

Straying signs: code that reads hook payloads, sockets, or live commands; a rule that resolves
words or enumerates commands itself instead of asking sh-analysis.

### command-steering

Owns: invocation-time steering of an agent's shell commands, on syntax alone. The rule schema
(predicate and action), the engine, host adapters, the daemon and shell shim, decision logs. It
consumes sh-ast and sh-analysis to canonicalize the command it sees. Rule predicates are
authored type-safely with celscript (mike-north/celscript) and evaluated as CEL at runtime;
a predicate may match resolved words and arguments however it likes, regular expressions
included. It owns the externally registrable rule format that other layers register into, and
never knows why a rule exists. An "ask" action may be delivered through allw (mike-north/allw),
the human-in-the-loop primitive, so the human can answer with more than yes or no (for example
"approve and amend the policy"); steering works without allw, and works best with it.

Must not: build, vet, or approve tools; act as a sandbox or permission system; understand what a
command means (secrets, network reach, file effects); reimplement parsing or analysis.

Straying signs: code that stages, hashes, or approves a tool; code that runs regular expressions
over the raw command text to find words or commands instead of asking sh-analysis; a rule
language of its own instead of CEL; any wish to know what a command means rather than what it
looks like. A semantic signal steering needs is a rule another layer registers; it is never
understanding steering grows.

### toolprep

Owns: assessment and readiness of executables a host will run, whoever wrote them (shell
scripts, shebang'd TypeScript modules, hooks, plugin scripts, MCP server launch commands);
agent-authored tools are one subject among many. One semantic reach policy, the user-facing
policy surface: what a program executes, reaches over the network,
reads, writes, and whether it touches credentials, with allow and deny lists, exceptions keyed
by subject and rule with a required reason, and compilation of the policy into per-language
lint presets. A coverage report saying at configuration time which statements a language's
preset cannot express. Findings for two audiences, the author iterating (fast local feedback)
and the human reviewer (SARIF on GitHub), each result carrying provenance (deterministic,
model-backed, or human attestation). Merging SARIF from any evaluator, so a security agent is
just another evaluator; sarif-to-comment carries the merged SARIF into the pull request review.
A readiness record per subject with two parts: the capability summary (what the subject
reaches, in policy terms) and coverage (which policy statements the evaluators could actually
check for this subject's language, so the reviewer knows what was not looked at). Exceptions
are the explicit, reviewer-visible bypasses: a rule the author asked to be waived for this
subject, with the reason, listed in the record rather than hidden. Fingerprints (content
identity plus capability summary) and diffs against per-consumer baselines on re-assessment,
so a byte change with the same reach is quiet and a same-purpose change that adds a host or a
credential path is loud. The analysis unit is a process: an entrypoint plus its in-language
imports, with results attributed over the import graph.

Must not: decide anything. No verdicts, thresholds, gates, or approved states; the human is the
judge, and consumers write their own rules over results. Implement a language's analysis
itself: eslint-sh owns the shell evaluator; ESLint and typescript-eslint own TypeScript, with one
rule that parses spawn and exec strings through sh-ast. Run as a daemon, watcher, or scheduler;
consumers trigger re-assessment. Know about tool lifecycle, registries, or scaffolds. Analyze
across languages: tool-to-tool calls compose over registry capability summaries at process
boundaries.

Straying signs: a verdict, threshold, or "approved" state computed inside toolprep; a lint rule
implemented inside toolprep instead of in the language's lint plugin; a classification corpus or
catalog of commands maintained inside toolprep; a model-backed answer being the only thing that
passes a subject; a check that applies only when the author is an agent.

### toolfab

Owns: the lifecycle of agent-proposed tools, and the agent guidance around it: the skills and
instructions by which an agent identifies a need, authors a tool, and curates its toolbox. The
proposal path an agent walks, staging, the human review and approval handshake, the registry with its pins and capability
summaries, the toolbox scaffold, and curation: deciding whether a need is met by an existing
tool, a native command, an extension, a consolidation, a new tool, or a retirement, and mining
command history for candidates. A toolbox is a scaffolded project (lint, typecheck, tests) with
a default language and an allowed set. A proposal is a branch and a pull request on the toolbox
repository; approval is the merge; the registry pin is a commit; revocation is a revert.
Submit rules over results (for example, a proposal with error-level deterministic results
cannot be submitted) are toolfab's. toolfab calls toolprep at proposal time for results and the
readiness record, attaches the record to the approval, and calls toolprep again on
re-assessment to learn that an approved tool has drifted. toolfab registers rule instances
("when you see this shape, suggest this tool") through command-steering's rule format, as any
power user would; the only difference is that its use results in new command-line tools
appearing. Where allw is present, a steering "ask" may offer "approve for now, and build a tool
for this" as a single answer, which toolfab turns into a proposal.

Must not: assess, fingerprint, or compute readiness itself; grow its own checker; match or
steer commands at invocation time; define its own rule or matcher format.

Straying signs: code that decides what to do with a command an agent is about to run; a lint or
reach check implemented inside toolfab; a capability summary computed anywhere but from
toolprep's readiness record.

### sarif-to-comment (delivery component)

Owns: turning SARIF into a code review: results become review comments on the pull request, at
the lines they concern. It is how toolprep's merged SARIF, and any other SARIF in the
ecosystem, reaches the human reviewer on GitHub.

Must not: evaluate, filter by policy, or decide; it renders what it is given.

## Interfaces

| Consumer | Provider | What crosses the boundary |
|---|---|---|
| sh-analysis | sh-ast | AST nodes, positions, traversal |
| eslint-sh | sh-ast | parsing of shell files for the ESLint language |
| eslint-sh | sh-analysis | facts (word resolution, command sites, wrappers) projected into diagnostics |
| command-steering | sh-ast, sh-analysis | canonical syntactic shape of the invoked command |
| toolprep | eslint-sh | the shell evaluator preset that toolprep's policy compiles into |
| toolprep | ESLint, typescript-eslint, sh-ast | the TypeScript evaluator; sh-ast parses spawn and exec strings |
| toolprep | any evaluator | SARIF to merge, with provenance |
| sarif-to-comment | toolprep, any evaluator | merged SARIF rendered as pull request review comments |
| toolfab | toolprep | results, readiness record, re-assessment and drift against toolfab's baseline |
| toolfab | command-steering | rule instances registered in steering's external rule format |
| command-steering, toolfab | celscript | type-safe authoring of predicates, CEL evaluation at runtime |
| command-steering, toolfab | allw | human-in-the-loop answers for "ask" and approval, optional |
| any consumer | toolprep | results, readiness record, fingerprints; harness audits, lead acceptance of branches, a repository's own scripts |

Every arrow points downward in the list above. A layer never depends on a layer below it in
this table's consumer column, and never on a consumer of itself.

## Glossary

Terms that SARIF already defines keep SARIF's name and meaning (result, rule, level, run,
location); the ecosystem adds names only where SARIF has none or where its word would collide
with a tool in toolfab's sense.

- subject: one executable toolprep assesses, identified by content. (SARIF's own word for a file
  a result points at is too general, so it is not used for this.)
- process: toolprep's analysis unit, an entrypoint plus its in-language imports.
- fact: an observation sh-analysis makes over syntax, with explicit uncertainty, carrying no judgment.
- result: SARIF's word for one statement about a subject, with location, rule, level, and provenance.
- rule (assessment): SARIF's word for the policy statement a result violates; a toolprep policy compiles into rules.
- level: SARIF's word for a result's severity: error, warning, note.
- provenance: how a result was produced: deterministic, model-backed, or human attestation.
- evaluator: what SARIF calls the tool that produced a run; the ecosystem says evaluator because
  "tool" means a toolfab tool. eslint-sh and typescript-eslint presets are the first evaluators, a
  security agent is another.
- policy: toolprep's single semantic reach statement: execute, network, read, write, credentials, each with allow and deny lists.
- exception: an explicit, reviewer-visible bypass of one rule for one subject, with a required reason.
- coverage: which policy statements a language's preset can express, reported at configuration time.
- readiness record: toolprep's per-subject summary: capability summary, coverage, and the exceptions in force.
- capability summary: the reach of a subject in policy terms, part of the readiness record and of the fingerprint.
- fingerprint: content identity plus capability summary; the thing toolprep diffs on re-assessment.
- baseline: a consumer's recorded fingerprint for a subject, against which drift is reported.
- rule (steering): a predicate and an action in command-steering's format; the predicate is CEL, authored with celscript, and matches shape only.
- rule instance: one registered rule, for example toolfab's "suggest this tool for this shape".
- toolbox: a toolfab-scaffolded project holding tools, with a default language and an allowed set.
- proposal, approval, pin, revocation: a pull request on the toolbox, its merge, the merge commit recorded in the registry, and a revert.
- judge: the human. No layer decides; layers inform. allw is the optional primitive that puts the question in front of the judge with richer answers than yes or no.
<!-- ecosystem-map:end -->

## Responsibilities in practice

- This package owns shell syntax: the AST and its types, positions, traversal, and
  printing. It does not interpret words, resolve commands, track working directories, or
  express any policy. Those belong to other layers (see the map above).
- Where a token, word, quoted string, or heredoc body begins and ends is the parser's
  answer. Read it from AST nodes and positions; never recompute it by scanning source
  text in TypeScript. A position that is imprecise is a defect to fix in the Go fork.
- A pull request names the layer that owns the change. Changes that redefine syntax for
  the convenience of an analysis or lint consumer are rejected, even if downstream tests
  pass.
- First use stays synchronous. Do not add mandatory asynchronous initialization to
  satisfy another layer's preference.
- The package is pre-1.0 and has few consumers. Make hard breaks when the model requires
  them instead of adding compatibility aliases, shims, or migration layers.

## Fixing Go behavior belongs in the Go fork

Changes to the underlying Go library are made in the maintained fork, not as a patch
stack in this repository. Commit the fix to the fork, pin an immutable revision that
contains it, and build the WASM bundle and generated schema from that same source
(`tools/go-source.json`, verified by `tools/verify-go-source.mjs`). Do not wait for an
upstream pull request to be accepted before depending on a fix; return to upstream when
it contains the required behavior. Binding-specific shim code stays here.

A demonstrated Go bug can justify a fork fix. An old TypeScript test expectation alone
cannot: separate independent correctness evidence from compatibility.

## Building and testing

- Toolchain: Node 22 (see `.nvmrc`), pnpm 11 (`packageManager` in `package.json`,
  `engine-strict`), and the Go version pinned in `packages/sh-ast/shim/go.mod` for the
  WASM shim.
- Run `pnpm install`, `pnpm build`, `pnpm check`, and `pnpm test`; all must pass, and
  `pnpm run check:format` must be clean (`pnpm run fix:format` repairs it). Remove build
  outputs with `pnpm run clean`.
- `check:typecheck` type-checks source, runtime tests, and generated declarations with
  the compiler, and type-contract fixtures with `tsd` across `.ts`, `.tsx`, `.mts`, and
  `.cts`. Typed ESLint does not report compiler diagnostics. An intentionally malformed
  runtime fixture needs a local, explained `@ts-expect-error`; rejected calls in
  type-contract fixtures keep their `expectError` assertions.
- Tests that are known to be heavy (WASM warm-up, large fixtures) set explicit timeouts.
- Multibyte fixtures (emoji, CJK, combining marks) are required for anything that touches
  ranges, positions, or offsets.

### The committed WASM is canonical

`packages/sh-ast/shim/sh-ast.wasm` is the linux/amd64 build produced by CI. Go's WASM
output is host-specific, so a build on macOS or arm64 will not match byte for byte, and
that is expected. Never commit a locally built WASM. When the shim or its Go source
changes, the `wasm-reproducibility` workflow rebuilds on Linux and verifies the committed
binary, and uploads the Linux output as an artifact that a maintainer can commit. The
exact rebuild command, including the pinned `wasm-opt` step, is in "The WASM shim" in
[packages/sh-ast/README.md](packages/sh-ast/README.md).

### Public API report and generated documentation

A change to the public surface (exports, signatures, documented types) must regenerate
the API report with `pnpm --filter sh-ast run fix:api-report` and the documentation with
`pnpm build:docs`, and commit both. CI checks that they are current. After editing only a
doc comment, regenerate with `--skip-nx-cache` (or `NX_SKIP_NX_CACHE=true`): the Nx cache
can report "no diff" when the real output changed, so check the output files themselves.
Put large generated-doc changes in their own commit and call them out in the pull
request so reviewers can read the source diff separately.

## Tests and evidence

- Write the specification- or outcome-derived test before the code change. Expected
  values come from an independent source: the exact pinned Go revision, real-shell
  behavior, the cited specification, or a hand-derived value. Never derive an expectation
  from the code under test, and do not use snapshot or captured-output tests as a
  correctness mechanism.
- Verify the binding against the exact selected Go revision; verify intentional fork
  deltas with independent syntax or real-shell evidence.
- A bug fix includes a regression test that fails before the fix and passes after it. When
  reviewing a fix, trace the corrected code by hand against the exact input that was
  reported: a green build and a plausible-looking diff do not show that the reported
  defect is gone.
- Document durable semantic intent in code comments: responsibilities, boundaries, and
  invariants. Keep progress notes and task status out of comments.

## Releases and changesets

- A change to published-package behavior or types needs a changeset (`pnpm changeset`).
- The project stays in the 0.x series until the maintainer declares the shape stable.
  Observable syntax or binding changes use a 0.x minor release, and the changelog names
  the exact Go dependency, including the fork revision when one is used.
- Releases come only from the release workflow. Do not edit the generated "Version
  Packages" pull request or publish by hand.

## Pull requests

- Open an issue first for anything non-trivial. Link it with `Refs #N`.
- State the acceptance criteria and map each one to a named test in the pull request.
  If a criterion is wrong or unachievable, say so on the issue before building around it.
- Keep commits focused; do not add generated attribution trailers to commits.
- Every pull request needs an approving code review before it is merged. Reply to every
  review thread; the reviewer resolves it.
- The base branch moves. Rebase late, and when CI reports "no checks" on a pull request,
  check for a merge conflict first.
