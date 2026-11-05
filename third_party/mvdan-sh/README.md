# mvdan/sh v3.14.1 with maintained corrections

This is the source closure consumed by the WASM shim and schema generator:
**v3.14.1 plus nine explicitly maintained patches**. The tagged release is
commit `a3f0c75d21d918756fa38de8b5d3429efde7948b`; the manifest records its Go
module checksum and the pristine SHA-256 of every included file. The original
BSD license and source copyright notices are retained. The 16-file inventory
contains `syntax`, `fileutil`, `syntax/typedjson` for encoder parity tests, the
original module declaration, and the license. Runtime imports use only these
packages and the standard library. Builds consume checked-in source without
modifying the shared Go module cache or applying patches during the build.

## Patch audit for the release update

The application order in `manifest.json` is authoritative. Every maintained
patch reverses independently, in reverse order, to reconstruct the exact release.

| Correction                                                                      | Outcome on v3.14.1                                                                                                                                                                                                 | Evidence on this pin                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official Unicode sentinel backport (`dccf23ff9b34b866c92fa3c6c66e0cd00f4ad159`) | Redundant: the release contains the sentinel correction, so `sentinel-backport.patch` is removed. `upstream-sentinel.patch` remains an archived official diff, not an applied patch.                               | Lexer markers are above `utf8.MaxRune`; native and public Unicode regressions retain U+0080/U+0081, later statements, byte positions, refill boundaries, and intentional `StopAt`.                                                      |
| Owned `comment-iteration.patch`                                                 | Still required. Rebased around upstream's expanded hash-literal and array-element token conditions; those conditions remain upstream's.                                                                            | Native reader-stack depth does not grow with flat comment runs; 980 tree/position/error observations match pristine v3.14.1 at seven reader chunk sizes. Public long-comment regressions remain.                                        |
| Official `nesting-backport.patch` (`0e0eb36bb6dd6a143842ffda25738e9a82dc915e`)  | Still required: this official commit postdates the tagged release. Production accounting is unchanged; context is rebased. The complete official diff remains `upstream-nesting.patch`.                            | Native tests retain the default limit, grammar controls, arithmetic/operator-tree accounting, and parser reuse.                                                                                                                         |
| Owned `binding-budget.patch`                                                    | Still required; rebased around the release's parser state layout.                                                                                                                                                  | `ParseNestingLimit` retains its configured native work budget across reset. Both bridge routes use 128 units, return terminal typed resource refusal without a partial tree, and remain reusable; recovery cannot resume after refusal. |
| Owned `subshell-heredoc.patch`                                                  | Still required; same correction with rebased line context.                                                                                                                                                         | Pristine v3.14.1 refuses the valid `cat <<X; (` reproduction. `heredoc-open-paren.test.ts` retains document attachment and later statements for `(` and `( :`, plus block, conditional, and command-substitution scope controls.        |
| Owned `printer-control-bytes.patch`                                             | Still required and adapted to the release's writer composition. Literal output now detects `extraIndenter` directly; its upstream `writeEscapingTabs` also protects VT/FF. Delimiter protection remains necessary. | Native/public literal, comment, delimiter, ordinary and tab-stripping document tests retain real Bash byte expectations. Nested document tests now assert preserved bytes rather than the old known failures.                           |
| Owned `heredoc-continuation.patch`                                              | Still required; adapted to upstream's corrected `mustNewline` reset and nested writer.                                                                                                                             | Public tests retain exact output and Bash stdout for continuation chains, tab counts, odd/even backslashes, expansions, and quoted/plain-document controls.                                                                             |
| Owned `printer-backslash-compat.patch`                                          | New compatibility hold: removes upstream's per-Lit trailing-backslash doubling, which changes existing caller-constructed adjacent literal escape runs.                                                            | Existing `analyze-braces.test.ts` expectations remain unchanged. Whether to adopt that upstream change, and its improvement for a parsed lone backslash at EOF, requires a separate decision.                                           |
| Owned `printer-zsh-prefix-order.patch`                                          | Keeps option-state prefixes before length/existence operators, matching the parser without changing grammar or other printer behavior.                                                                             | Public parse/print/reparse tests retain all state fields and hand-written spelling/stdout under default and KeepPadding; real Zsh preserves `${=#a}` as length three instead of the printed `${#=a}` value zero.                        |
| Owned `zsh-subscript-pattern.patch`                                             | Preserves escaped brackets, balanced character classes, and ordinary word expansions in flagged Zsh subscripts without arithmetic rewriting.                                                                       | Native and public regressions assert quoted/unquoted `CmdSubst` and `ParamExp`, walk/command discovery, and default/KeepPadding spelling. Handwritten real-Zsh controls assert matching results, including plain and wildcard patterns. |

All owned patches are sh-ast maintenance, not official upstream fixes. The native
nesting units count grammar work, including iteratively constructed operator
trees; they are neither stack frames nor total tokens. The fixed binding policy
is not a TypeScript grammar option or a safety guarantee for arbitrary caller
stacks or constructed trees.

The subscript-pattern correction is owned sh-ast maintenance for [#88](https://github.com/mike-north/sh-ast/issues/88), not an official upstream change. It repairs the v3.14.1 raw-pattern scan by using the existing word parser for expansions and retaining balanced bracket text. The preceding arithmetic interpretation already printed character classes incorrectly; restoring it would also reject valid wildcard patterns. Flag syntax, unrelated grammar, and the existing nesting/refusal policy remain outside this correction's responsibility. The patch digest and reverse reconstruction cover the complete owned change.

## Printer overlap and limits

The delimiter hunk of #80 overlaps upstream
[`0d47c1c`](https://github.com/mvdan/sh/commit/0d47c1c), associated with
[#1446](https://github.com/mvdan/sh/issues/1446). That commit is **not in
v3.14.1**: the tag still writes unquoted delimiter bytes directly. The owned
protection therefore remains, without importing the later shared quote-removal
helper or its other parser/delimiter changes. Pristine v3.14.1 still turns literal
VT into layout whitespace; the maintained tests prove preservation on the new pin.

Upstream v3.14.1 itself preserves the internal HT in #85's ordinary `<<-` example
under default options and `KeepPadding`; pristine v3.13.1 prints a space instead.
No separate internal-HT correction is added here. The continuation correction
composes with the release's existing HT preservation, and nested control-byte
assertions are strengthened where the new writer composition removes old limits.
These tests cover their explicit fixtures, not every nested writer combination.

`KeepPadding` remains deprecated upstream, with escape-marker and shrinking-column
limits tracked in [#658](https://github.com/mvdan/sh/issues/658). The retained
Minify shebang path still transforms VT/FF and can expose text after FF as code;
this update does not repair that path. Existing named tests retain that limit.

## Verification and public model

The release adds `ParamExp.Split`, `GlobSubst`, and `RcExpand`, plus the uint8
`OptState` domain and its unset/on/off constants. The generator and both native
codecs preserve these values, including unnamed uint8 values without truncation.
The faithful public bridge keeps numeric token operators even though upstream's
legacy typed JSON now uses token spellings. The cached legacy encoder follows
that upstream JSON format and remains byte-identical in its parity tests.

Upstream's clamped position arithmetic and corrected naked-index/braced-clause
bounds are reflected in live Walk comment placement. Walk also visits
`IfClause.Last`, matching the new native protocol. Oracle fixtures are refreshed
from independent native observations; comment hashes come from an isolated
pristine module without any replacement, never from the maintained parser.

Run from the repository root:

```sh
node tools/verify-mvdan-backport.mjs
node --test tools/verify-mvdan-backport.test.mjs
go test -C packages/sh-ast/shim ./...
go test -C tools/gen-visitor-keys ./...
```

The offline verifier checks release identity, inventory, all patch digests, both
module replacements, and reconstruction of every pristine file. Tamper tests
reject missing/reordered/altered patches, undeclared edits, extra files, missing
licenses, and disconnected routing. For another update, audit grammar and model
changes, rebase remaining corrections explicitly, regenerate artifacts, and run
the suites and corpus comparison. Remove a correction only when independent
behavior tests prove its protected outcome still holds.
