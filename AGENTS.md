# Project responsibility rules

Read [the accepted architecture](design/ARCHITECTURE.md#responsibilities) and
[the engineering agreement](ENG_TEAM_INSTRUCTIONS.md) before implementing or
reviewing a change. These rules apply to humans, coding agents, and reviewers.

<!-- ecosystem-map:begin -->
# Ecosystem map

Map version: 2. This file is kept verbatim, byte for byte, in every repository of the
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

Six repositories each own one concern. Work that belongs to another layer goes there, even when
it would be quicker to do it here. When a needed capability sits in another layer and does not
exist yet, add it there, or record the gap in that repository, rather than approximating it here.

## Layers

### sh-ast

Owns: shell syntax. A faithful TypeScript binding, through WebAssembly, of the maintained Go fork
of mvdan/sh (mike-north/sh): the AST and its types, positions, traversal, printing. The grammar
itself lives in the fork; grammar and lexer changes go to the fork and arrive here through the
binding.

Must not: interpret words, resolve commands, track working directories, or express any policy.
Reimplement any part of the grammar in TypeScript.

Straying signs: a shell lexer, tokenizer, or heredoc scanner written in TypeScript anywhere in
the ecosystem. A guard that derives every position from sh-ast nodes is consumption of the
binding and is allowed; if such a guard exists only because the binding's positions are
imprecise, that imprecision is a sh-ast (or fork) defect to fix upstream.

### sh-analysis

Owns: observations over sh-ast syntax. Word resolution, command sites and argv0, wrapper chains
(sudo, env, command, xargs and the like), interpreter invocations, working-directory and path
facts, each with explicit uncertainty. Command and dependency harvesting (what a script invokes)
lives here. Facts only.

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
(matcher and action), the engine, host adapters, the daemon and shell shim, decision logs. It
consumes sh-ast and sh-analysis to canonicalize the command it sees. It owns the externally
registrable rule format that other layers register into, and never knows why a rule exists.

Must not: build, vet, or approve tools; act as a sandbox or permission system; understand what a
command means (secrets, network reach, file effects); reimplement parsing or analysis.

Straying signs: code that stages, hashes, or approves a tool; code that inspects words by regex
instead of asking sh-analysis; any wish to know what a command means rather than what it looks
like. A semantic signal steering needs is a rule another layer registers; it is never
understanding steering grows.

### toolprep

Owns: assessment and readiness for agent-authored executables (shell scripts, shebang'd
TypeScript modules, hooks, plugin scripts, MCP server launch commands). One semantic reach
policy, the user-facing policy surface: what a program executes, reaches over the network,
reads, writes, and whether it touches credentials, with allow and deny lists, exceptions keyed
by artifact and rule with a required reason, and compilation of the policy into per-language
lint presets. A coverage report saying at configuration time which statements a language's
preset cannot express. Findings for two audiences, the author iterating (fast local feedback)
and the human reviewer (SARIF on GitHub), each finding carrying provenance (deterministic,
model-backed, or human attestation). Merging SARIF from any evaluator, so a security agent is
just another evaluator. A readiness record per artifact: capability summary, coverage achieved,
exceptions that would be needed, what a host would have to grant for unattended use.
Fingerprints (content identity plus capability summary) and diffs against per-consumer
baselines on re-assessment, so a byte change with the same reach is quiet and a same-purpose
change that adds a host or a credential path is loud. The analysis unit is a process: an
entrypoint plus its in-language imports, with findings attributed over the import graph.

Must not: decide anything. No verdicts, thresholds, gates, or approved states; the human is the
judge, and consumers write their own rules over findings. Implement a language's analysis
itself: eslint-sh owns the shell evaluator; ESLint and typescript-eslint own TypeScript, with one
rule that parses spawn and exec strings through sh-ast. Run as a daemon, watcher, or scheduler;
consumers trigger re-assessment. Know about tool lifecycle, registries, or scaffolds. Analyze
across languages: tool-to-tool calls compose over registry capability summaries at process
boundaries.

Straying signs: a verdict, threshold, or "approved" state computed inside toolprep; a lint rule
implemented inside toolprep instead of in the language's lint plugin; a classification corpus or
catalog of commands maintained inside toolprep; a model-backed answer being the only thing that
passes an artifact.

### toolfab

Owns: the lifecycle of agent-proposed tools, and nothing else. The proposal path an agent walks,
staging, the human review and approval handshake, the registry with its pins and capability
summaries, the toolbox scaffold, and curation: deciding whether a need is met by an existing
tool, a native command, an extension, a consolidation, a new tool, or a retirement, and mining
command history for candidates. A toolbox is a scaffolded project (lint, typecheck, tests) with
a default language and an allowed set. A proposal is a branch and a pull request on the toolbox
repository; approval is the merge; the registry pin is a commit; revocation is a revert.
Submit rules over findings (for example, a proposal with error-level deterministic findings
cannot be submitted) are toolfab's. toolfab calls toolprep at proposal time for findings and the
readiness record, attaches the record to the approval, and calls toolprep again on
re-assessment to learn that an approved tool has drifted. toolfab registers rule instances
("when you see this shape, suggest this tool") through command-steering's rule format, as any
power user would; the only difference is that its use results in new command-line tools
appearing.

Must not: assess, fingerprint, or compute readiness itself; grow its own checker; match or
steer commands at invocation time; define its own rule or matcher format.

Straying signs: code that decides what to do with a command an agent is about to run; a lint or
reach check implemented inside toolfab; a capability summary computed anywhere but from
toolprep's readiness record.

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
| toolfab | toolprep | findings, readiness record, re-assessment and drift against toolfab's baseline |
| toolfab | command-steering | rule instances registered in steering's external rule format |
| any consumer | toolprep | findings, readiness record, fingerprints; harness audits, lead acceptance of branches, a repository's own scripts |

Every arrow points downward in the list above. A layer never depends on a layer below it in
this table's consumer column, and never on a consumer of itself.

## Glossary

- artifact: one agent-authored executable toolprep assesses, identified by content.
- process: toolprep's analysis unit, an entrypoint plus its in-language imports.
- fact: an observation sh-analysis makes over syntax, with explicit uncertainty, carrying no judgment.
- finding: one statement about an artifact, with location, rule, severity, and provenance, carried as SARIF.
- provenance: how a finding was produced: deterministic, model-backed, or human attestation.
- evaluator: anything that produces findings for toolprep to merge; eslint-sh and typescript-eslint presets are the first, a security agent is another.
- policy: toolprep's single semantic reach statement: execute, network, read, write, credentials, each with allow and deny lists.
- exception: a policy carve-out keyed by artifact and rule, with a required reason.
- coverage: which policy statements a language's preset can express, reported at configuration time.
- readiness record: toolprep's per-artifact summary: capability summary, coverage achieved, exceptions needed, host grants required for unattended use.
- capability summary: the reach of an artifact in policy terms, part of the readiness record and of the fingerprint.
- fingerprint: content identity plus capability summary; the thing toolprep diffs on re-assessment.
- baseline: a consumer's recorded fingerprint for an artifact, against which drift is reported.
- rule (steering): a matcher and an action in command-steering's format; matches shape only.
- rule instance: one registered rule, for example toolfab's "suggest this tool for this shape".
- toolbox: a toolfab-scaffolded project holding tools, with a default language and an allowed set.
- proposal, approval, pin, revocation: a pull request on the toolbox, its merge, the merge commit recorded in the registry, and a revert.
- judge: the human. No layer decides; layers inform.
<!-- ecosystem-map:end -->

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
