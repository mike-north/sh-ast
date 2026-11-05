# mvdan/sh v3.13.1 with maintained corrections

This directory contains the source closure used by the WASM shim, its tests, and
the schema generator. It is **v3.13.1 plus two documented corrections**, not an
unmodified upstream release. No other grammar, AST, printer, or public API change
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

## Provenance and verification

`manifest.json` records the upstream module checksum, exact pristine SHA-256 for
every included file, the upstream fix commit, and all patch digests, with the
application order explicit. The baseline
is the Go module `mvdan.cc/sh/v3@v3.13.1`. Files other than the two patched source
files are byte-for-byte copies of that baseline.

Run from the repository root:

```sh
node tools/verify-mvdan-backport.mjs
node --test tools/verify-mvdan-backport.test.mjs
```

The offline verifier checks inventory and patch digests, confirms both module
replacements, reverses the owned iteration patch and then the official backport
in an isolated temporary directory, and hashes
the reconstructed pristine files. It rejects added files as well as modified or
missing files. Tests deliberately alter source, add an extra Go file, remove the
license, change either applied patch, remove a patch from the declared order,
and disconnect the generator replacement. CI runs this
verification before using the source. Builds never download or apply a patch,
and never mutate the shared Go module cache.

For a future dependency update, audit the upstream schema and grammar changes,
regenerate artifacts, and run the full suites before changing the pin. Once an
approved upstream version includes both corrections, remove both replacements,
this directory, and its verifier together. If only one correction is upstreamed,
rebase and document the remaining owned patch explicitly. Do not fold unrelated
fixes into either patch or silently change the baseline.
