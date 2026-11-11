# Realign implementation with the accepted layers

The ownership, hard-break, and maintained-fork rules were adopted on
2026-11-05. [Architecture D9-D11](ARCHITECTURE.md#accepted-direction) owns those
decisions; [AGENTS.md](../AGENTS.md) supplies implementation/review rules.
The work sequence below is the original plan; the analysis subpath has since been
removed from this package. The selected destination is the independent repository
`mike-north/sh-analysis`, with npm package name `sh-analysis`; its
publication status is tracked in that repository.

## Observed implementation

The syntax inventory below was checked against sh-ast main
`43390d3fc048e6a1c524d34579182c0010df99dc` (0.10.0). Consumer examples were inspected
at fetched eslint-sh main `928aa3ef24bdb2bd5d5a4315b38e705486c913d7`. These are
inspection revisions, not claims that the two projects have already adopted the
same syntax release.

| Existing surface                                                                                                                      | Intended destination                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseSync`, `parseWithPositionsSync`, records/constants, `newPos`, live bounds, `walk`, `printSync`, transport, and binding failures | `sh-ast`, preserving the selected Go contract and explicitly accepted TypeScript adaptations                                                                     |
| `src/analyze/resolve-word.ts` and literal/ANSI-C decoding helpers                                                                     | Independent analysis layer                                                                                                                                       |
| `src/analyze/enumerate-commands.ts`, command contexts and analysis depth refusal                                                      | Independent analysis layer                                                                                                                                       |
| `src/analyze/resolve-argv0.ts`, wrapper/interpreter tables, options, and validation failures                                          | Independent analysis layer                                                                                                                                       |
| Analysis-only errors currently exported by the syntax root                                                                            | Analysis layer; remove their syntax-root exports                                                                                                                 |
| `src/analyze/brace-observation.ts` uncertainty/classification                                                                         | Analysis layer; any needed `syntax.SplitBraces` exposure must remain a faithful Go operation, without analysis-specific results or private cross-package imports |
| Nine applied `third_party/mvdan-sh` patches                                                                                           | Review individually; independently justified changes belong in the Go fork, while compatibility-only holds have no preserving requirement                        |
| ESLint `language/shell-language.ts`, `syntax-view.ts`, and source coordinates                                                         | ESLint integration                                                                                                                                               |
| ESLint `language/word-resolution.ts`, `command-resolution.ts`, command harvesting, and syntax/analyze re-exports                      | ESLint adapters consume the independent analysis package instead of `sh-ast/analyze`                                                                             |

The analysis layer is already substantial enough to extract: word resolution,
command inventory/context, wrapper grammars, and interpreter-invocation analysis
are implemented and consumed by ESLint. A renamed subpath in the same syntax
package would not establish the requested independent responsibility boundary.
The selected independent private repository `mike-north/sh-analysis` establishes
its destination; the extraction must preserve independent package ownership and
the required dependency direction.

## Proposed work sequence

1. Establish the Go fork as the home for all changes to the underlying library.
   Reassess each existing delta against independent intended outcomes, including
   the Zsh parsing and printer-backslash compatibility holds. Preserve demonstrated
   correctness fixes, not old output merely because existing tests expect it.
   Keep the binding resource policy distinct from shell grammar; its native
   accounting mechanism belongs with the modified Go implementation. Record
   each delta's purpose and upstream status, then pin a fork commit and reproduce
   schema/WASM from that exact source with canonical Linux provenance.
2. Extract analysis as an independent package consuming public `sh-ast` APIs.
   Remove `sh-ast/analyze` and syntax-root analysis errors in a hard break; do not
   retain forwarding aliases. Update real consumers and their syntax/analyze
   re-exports directly. Remove analysis-only bridge operations or replace them
   with genuinely faithful syntax APIs where needed. The binding must build and
   load without analysis or ESLint dependencies.
3. Specify analysis meaning before expanding its option grammar. In particular,
   decide how to distinguish a known executable from uncertainty about an embedded
   program. Preserving the existing overloaded `effective` shape is not a goal.
   A separate embedded-program observation is a proposal, not an accepted API.
4. Validate the composed local candidates in real ESLint calls, including cold
   synchronous first use, command observations, locations, and edited-tree printing.
   Record the exact resolved packages/builds. Update docs, API reports, release
   notes, and consumer instructions to the final ownership and public surfaces.

Every software step begins with tests derived from its intended outcomes. Syntax
binding tests compare with the exact selected Go revision; fork corrections need
independent evidence for their deliberate upstream differences. Analysis tests
assert meaning and uncertainty; ESLint tests assert projections, diagnostics,
rule decisions, and fixes. Old test expectations are evidence to examine, not
compatibility obligations.

## Fork upkeep

Before updating the Go dependency, compare upstream since the recorded baseline,
review applicable changes, incorporate them into the fork, and retest each retained
delta. A patch absorbed upstream should cease to be a separately maintained delta.
When upstream contains all required behavior, the binding can depend on it again.
The maintenance obligation is accepted; an automated schedule, fork URL, branch
names, and update cadence are not selected by this plan. Do not infer permission
to auto-merge upstream changes without review and verification.
