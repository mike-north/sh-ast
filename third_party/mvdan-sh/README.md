# mvdan/sh v3.13.1 with maintained corrections

This directory contains the source closure used by the WASM shim, its tests, and
the schema generator. It is **v3.13.1 plus seven documented corrections**, not an
unmodified upstream release. No other grammar, AST, or printer change
from newer releases is included.

The original [BSD license](upstream/LICENSE) and source copyright notices are
retained. `upstream/` contains 16 inventoried files: the `syntax` package,
`fileutil`, the `syntax/typedjson` source used by existing encoder parity tests,
and the original module declaration and license. Runtime imports require only
these packages and the Go standard library. The original module declaration
retains upstream's dependency declarations; this subset adds no dependencies.

## Official Unicode sentinel backport

The v3.13.1 lexer used U+0080 for EOF and U+0081 for escaped newlines. Both are valid
source characters. The collision could silently drop later commands, corrupt a
word, or reject an otherwise valid quoted heredoc when its contents crossed a
reader buffer boundary.

The official correction is
[mvdan/sh dccf23ff9b34b866c92fa3c6c66e0cd00f4ad159](https://github.com/mvdan/sh/commit/dccf23ff9b34b866c92fa3c6c66e0cd00f4ad159).
It moves both markers above `utf8.MaxRune`, changes rune-level EOF comparisons,
and makes `newLit` distinguish markers explicitly. Byte-level `utf8.RuneSelf`
ASCII thresholds and `peek` sentinels remain unchanged. Intentional `StopAt`
termination remains supported.

`upstream-sentinel.patch` is the exact `syntax/lexer.go` and `syntax/parser.go`
production diff from that commit. `sentinel-backport.patch` omits only its last
hunk (`parser.go`, original line 1830): that hunk updates the loop for a newer Zsh
subscript flag pattern argument, introduced after v3.13.1. The entire loop is
absent in v3.13.1. Every remaining production hunk applies unchanged, with line
offsets where intervening upstream additions changed locations. Upstream's test
hunks reference its newer test corpus; repository tests instead assert explicit
word values, later statements, byte positions, errors, and accepted heredocs.

A pin to that upstream commit would also import 75 preceding commits, including
new AST fields and unrelated grammar behavior. The local replacement keeps the
existing supported model stable. Both Go modules route to this same source;
regenerated syntax records, constants, and metadata must remain byte-identical.

## Owned comment-iteration correction

`comment-iteration.patch` is maintained by sh-ast; it is **not an official
upstream patch**. It applies after the Unicode backport and replaces the tail
recursion used by `Parser.next` to skip comments with an iterative wrapper.
`nextToken` retains the original token advancement body. It returns true only
where the original function recursively called `next` after a comment. All
ordinary returns and the common error normalization retain their meaning.

The wrapper tracks whether it consumed comments, then performs the original
post-recursion `p.err`/EOF normalization once. This preserves terminal early
returns as well as the normal path; repeated EOF assignments during recursive
unwinding were idempotent. No state is added to `Parser`, and reentrant calls
during heredoc parsing retain independent local state.

This removes stack growth proportional to a flat comment run without adding a
comment-count limit or changing the grammar. Native regression tests compare
full trees, node bounds, stored positions, and exact errors against 980 recorded
pristine v3.13.1 observations, including reader failures and refill boundaries.
Public tests retain all 50,000 comments and their positions. The correction does
not remove recursive parsing of nested grammar or recursive AST serialization.

## Official nesting backport and owned binding budget

[Official commit 0e0eb36bb6dd6a143842ffda25738e9a82dc915e](https://github.com/mvdan/sh/commit/0e0eb36bb6dd6a143842ffda25738e9a82dc915e)
counts open statement, word, and expression work, including iterative construction
of deep operator trees. `upstream-nesting.patch` records the full official patch;
`nesting-backport.patch` contains its unchanged production hunks for `parser.go`
and `parser_arithm.go`. Upstream test hunks depend on its test corpus; local tests
instead assert explicit boundaries, grammar controls, and repeated parser reuse.

`binding-budget.patch` is owned by sh-ast, **not an official upstream patch**.
It adds `ParseNestingLimit`: zero preserves the official 10,000-unit default;
a positive value selects a binding budget that survives parser reset. A separate
shared shim factory fixes both faithful and retained legacy parse routes at 128.
No TypeScript option exposes this policy. Native units are neither stack frames
nor total tokens, and valid syntax can exceed the binding budget.

The typed `ParseDepthError` follows ordinary terminal error/EOF propagation, so
recovery options cannot resume parsing after resource refusal. `Parse` returns no
partial File for this error. The faithful bridge emits only its resource envelope
before composition, node encoding, or snapshots; the legacy bridge keeps its
existing error-only response. Both routes remain usable after refusal. This is
an empirical ordinary-caller bound, not arbitrary caller-stack or constructed-AST
safety. The comment-iteration correction remains independently maintained.

## Owned subshell here-document correction

`subshell-heredoc.patch` is maintained by sh-ast, **not an official upstream
patch**. A subshell changes the lexer quote state but shares the surrounding
pending here-documents. It must consume those documents at its next newline,
including when that newline immediately follows `(` or `( :`. The correction
keeps the inherited document scope instead of burying it via `preNested`.

Command substitutions still use `preNested` and retain their separate document
scope. Public parser regressions assert hand-written document attachment and
remaining statements for both subshell layouts, with `{`, `then`, and a command
substitution whose outer document follows `)` as controls. The unclosed outer
document error when its apparent body lies inside `$(` remains unchanged. No lexer, AST,
printer, or command-substitution code changes are included in this correction.

## Owned printer literal-byte correction

`printer-control-bytes.patch` is maintained by sh-ast, **not an official upstream
patch**. Go's `text/tabwriter` treats VT and FF as layout separators. Shells retain
them as data in quoted strings, unquoted words, and here-document bodies; embedded
comment bytes must also survive without turning the suffix into executable text.
`writeLit` therefore protects VT and FF with the same tabwriter escape markers
already used for literal horizontal tabs. The deprecated `KeepPadding` option
retains upstream's escape-marker column counting and shrinking-padding limit,
tracked in [mvdan/sh#658](https://github.com/mvdan/sh/issues/658). `colCounter`
is unmodified; ordinary and HT-only output must match the base byte-for-byte.
When no horizontal tab is present, only VT/FF bytes are escaped, so physical
newlines remain visible for comment alignment. Literals containing horizontal
tabs retain upstream's whole-literal escaping and its known multiline alignment
limit. The nested `<<-` printer defers escaping
until `extraIndenter` has stripped leading tabs; that writer protects VT and FF in
the remaining body. Existing output without these bytes is unchanged.
For here-document delimiters, `unquotedWord` must protect these same bytes while
removing backslashes from an unquoted closing word. Otherwise its terminator
would differ from the preserved opener and absorb later commands as body text.
That protection matches the literal-writer boundary in upstream
[0d47c1c](https://github.com/mvdan/sh/commit/0d47c1c), associated with
[mvdan/sh#1446](https://github.com/mvdan/sh/issues/1446). This owned v3.13.1
adaptation protects only VT/FF; it does not backport upstream's shared
quote-removal helper or the issue's other parser/delimiter changes.

Nested `<<-` documents inside a surrounding `<<-` command substitution retain a
writer-ordering limit: VT/FF body data can still change, and nested delimiters
can become data under Bash 3.2 or cause Bash 5.3 to reject the printed program.
Ordinary and HT-only nested output is unchanged from the pinned base, including
its pre-existing HT body defect. Tests document these limits against real Bash.
Minify's retained-shebang path also keeps its upstream VT/FF transformation;
an embedded FF can expose following shebang comment text as executable code.

Native and public printer regressions use explicit source expectations for single
quotes, double quotes, literal and written-escape ANSI-C quotes, unquoted words,
ordinary and tab-stripping here-documents, and comments. Public tests additionally
cover unquoted and backslash-escaped here-document delimiters with a following
command that must remain executable. They
execute the original and printed fixtures in Bash against hand-written output
values. The correction changes no parser, AST, or public API shape.

## Owned tab-stripping here-document continuation correction

`heredoc-continuation.patch` is maintained by sh-ast, **not an official upstream
patch**. Bash removes leading tabs from the start of a logical line in an
unquoted `<<-` body. After an odd trailing run of backslashes joins the next
physical line, that next line's leading tabs are data. Adding indentation there
changes the document's value.

The correction is confined to `extraIndenter` and its construction. It tracks
continuations only for unquoted delimiters and writes the following physical
line verbatim, protected from `text/tabwriter`. Even backslash runs, quoted or
backslash-escaped delimiters, ordinary `<<` documents, and `<<-` bodies without
continuations retain their previous layout. The indentation baseline still
comes from the first independently indented line. Shared layout machinery,
including `colCounter`, is unchanged. Space indentation and Minify already avoid
this indenter and are unchanged.

Public API tests assert hand-written printed programs and Bash stdout for
continuation chains, zero/one/multiple following tabs, tabs-only lines, odd/even
backslash runs, expansions, and the unaffected delimiter/document forms. The
same fixtures run on Apple Bash 3.2 and Homebrew Bash 5.3. The existing nested
`<<-` control-byte and delimiter limits described above remain; this correction
does not expand the nested writer's responsibilities or repair KeepPadding's
upstream layout limits.

## Provenance and verification

`manifest.json` records the upstream module checksum, exact pristine SHA-256 for
every included file, the upstream fix commits, and all patch digests, with the
application order explicit. The baseline
is the Go module `mvdan.cc/sh/v3@v3.13.1`. Files other than the four patched source
files are byte-for-byte copies of that baseline.

Run from the repository root:

```sh
node tools/verify-mvdan-backport.mjs
node --test tools/verify-mvdan-backport.test.mjs
```

The offline verifier checks inventory and patch digests, confirms both module
replacements, and reverses all seven patches in declared reverse application order:
owned heredoc continuation, owned printer literal-byte, owned subshell
here-document, binding budget, official nesting, owned comment iteration, official
sentinel.
It then hashes every reconstructed pristine file in an isolated directory. Tests
reject missing, reordered, altered patches, undeclared source changes, added files,
missing licenses, and disconnected module replacements. CI verifies provenance
before using the source. Builds never download or apply patches and never mutate
the shared Go module cache.

For a future dependency update, audit the upstream schema and grammar changes,
regenerate artifacts, and run the full suites before changing the pin. Once an
approved upstream version includes all required corrections, remove both replacements,
this directory, and its verifier together. If only some corrections are upstreamed,
rebase and document the remaining patches explicitly. Do not fold unrelated
fixes into any patch or silently change the baseline.
