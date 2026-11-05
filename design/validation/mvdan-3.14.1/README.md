# mvdan/sh v3.14.1 validation

The baseline is main `211c5b7d4207b5e409d3b1ed841ad629d5f03fde`, including
#80 and #84. The target is tagged upstream v3.14.1, commit
`a3f0c75d21d918756fa38de8b5d3429efde7948b`, the latest tagged release at the
comparison. Choosing the tag avoids importing later grammar decisions, notably
#1428's EOF-terminated missing heredocs. The source closure and correction audit
are in [the vendor README](../../../third_party/mvdan-sh/README.md).

## Corpus

[The summary](corpus-summary.json) records all 16 project commits, the selected
source-manifest digest, counts, and every file with a grammar or print change.
Selection follows the existing soak: tracked `.sh`, `.bash`, `.bats` and selected
extensionless shell scripts; exclude other interpreters, NUL-containing files,
and files over 512 KiB. Dialects follow the shebang, with `.bats` taking Bats and
other unspecified scripts taking Bash. All 2,867 source bytesets match between
runs. Scripts were parsed and printed, **never executed**.

- Both versions accept 2,758 files and refuse 109. Newly accepted: **none**.
  Newly refused: **none**. Refusal classes, messages, positions and all existing
  partial-tree fields are unchanged.
- 2,424 accepted trees change: 2,422 only add the three zero-valued `ParamExp`
  fields; the following two also change existing structure. The same added fields
  occur in 104 refusal partial trees; five refusal trees are byte-identical.
- `shunit2/shunit2`: escaped double quotes inside a double-quoted backtick
  substitution now become one `DblQuoted` argument, matching Bash's backtick
  quote removal. Previously they became literal quote bytes around an unquoted
  expansion. Printing now preserves one argument containing a space.
- `bash-it/lib/helpers.bash`: adjacent literal `{` and bracket-pattern text
  coalesce into one `Lit`; surrounding quotes and brace expansion are unchanged.
  Bash still produces the two expected brace-expanded words. Print is identical.
- Default output changes only in `shunit2/shunit2` (the quote correction) and
  `oh-my-bash/lib/base.sh` (separated adjacent closing parentheses).
- KeepPadding changes in 78 files: the same quote correction and 77 files with
  whitespace changes at command/subshell closing parentheses or the resulting
  column adjustment. The complete filename list is in `keepPaddingPrint` in the
  summary. Upstream now applies the recorded close column to substitutions and
  separates nested closing parentheses. No corpus heredoc body changes.
- Every changed print output was reparsed under the same new parser and dialect,
  comparing all fields except source positions. Of 80 comparisons (two default,
  78 KeepPadding), 78 preserve syntax exactly. The other two are the intended
  quote correction in `shunit2/shunit2`, once per print mode.

A supplementary all-Bash run accepts 2,269 and refuses 598 on both sides; its
extra refusals are primarily Bats syntax, so it is not used as the soak baseline.
It identifies the same two existing-tree changes and default-output changes.

## Independent Bash reproductions

[Original/base observations](repro-base.json) and
[original/head observations](repro-head.json) include the hand-written sources,
expected stdout, exact printed text, exit status, stdout and stderr for Apple
Bash 3.2 and Homebrew Bash 5.3. No corpus source is executed.

The backtick reproduction expects `<alpha beta>\n`. Both Bash versions produce
that from source and the new print; the old print instead produces
`<"alpha><beta">\n`. The bracket/brace reproduction disables globbing and expects
the literal pattern plus the second brace-expanded word, equally on both pins.
The closing-parenthesis and stored-close-column reproductions both expect
`safe\n` and retain it across both options and both versions. The three new
zero-valued fields represent absence of Zsh overrides, so these Bash values
remain governed by the shell's existing options.

Neither named risk changes corpus acceptance. Pristine v3.14.1 still refuses
`cat <<X\nbody\n`, while Bash consumes through EOF (Bash 5.3 warns). The tag does
not contain #1428. Pristine v3.14.1 also refuses the valid pending-heredoc
subshell reproduction with an unclosed-document error; the maintained subshell
patch retains `body\nin\n`, attachment to `cat`, and the later subshell command.
Its existing scope/error controls remain unchanged.

## Internal tab observation (#85)

No corpus heredoc body changes were observed. [Pristine v3.13.1](pristine-3.13.1-tab.jsonl) emits
`name value` under default and KeepPadding. [Pristine v3.14.1](pristine-3.14.1-probes.jsonl)
emits `name<TAB>value` under both. The maintained candidate also preserves the
source's `name<TAB>value\n` stdout in both Bash versions and both modes. This is
behavior already in the tagged upstream printer; no separate #85 fix is added.
The standalone [native probe](pristine-printer.go.txt) runs in an isolated module
requiring the chosen version, without a replacement. Its VT probe still shows
upstream data corruption, so the owned #80 protection remains necessary.

## Compatibility decision held

Upstream now doubles an odd trailing backslash at each `Lit` boundary. Existing
constructed adjacent-literal tests require escape runs to retain their spelling
across those boundaries. `printer-backslash-compat.patch` retains that behavior;
no existing test is weakened. Adopting upstream's behavior would also fix printing
a parsed lone backslash at EOF, but changes constructed trees. That compatibility
choice remains separate from this pin update.

## Verification

The required build/check/test gate, native shim and generator suites, provenance
and tamper tests, public array-expansion regression, depth/refusal controls,
Unicode controls, and both Bash fixture runs are recorded locally under
`/Users/mnorth/Development/eslint-sh/scratch/m4/sh-ast-82/`. Complete source hashes,
parse/print snapshots and comparison scripts are retained there for independent
verification. Public declarations, API reports and Markdown API docs are generated
from the new pin. CI independently checks the Linux rebuild; local WASM uses Go 1.26.10 and
wasm-opt 131.

## Parse and print timing

Both runs use the repository's real `tools/benchmark/worker.mjs`, serial fresh
processes, rotated artifact order, Bash, retained comments, and post-clock
correctness checks. Runtime asset hashes are recorded separately. Node is
v24.14.0 on macOS arm64. No builds, tests or corpus comparisons run concurrently
with measurements in this worktree; the machine itself is shared.

The [initial run](benchmark.json) uses seven process rounds, five excluded warmups
and 20 samples per worker. Its [raw observations](benchmark-samples.json) are
retained, including the apparent 1.44x small-fixture parse slowdown. The
[longer follow-up](benchmark-followup.json) uses nine process rounds, 100 warmups
and 200 measured calls for parsing and small-fixture printing. Printing sources
over 5,000 characters uses 20 warmups and 20 measured calls per worker.
[All follow-up samples](benchmark-followup-samples.json) retain worker identity,
round, call counts and individual durations.

These are medians of process medians, in milliseconds:

| Fixture           | Parse base → head | Ratio | Print base → head | Ratio |
| ----------------- | ----------------: | ----: | ----------------: | ----: |
| representative-1  |     0.131 → 0.143 | 1.09x |     0.769 → 0.844 | 1.10x |
| representative-50 |     4.942 → 5.439 | 1.10x |   45.841 → 48.175 | 1.05x |
| nested-8          |     0.251 → 0.276 | 1.10x |     1.524 → 1.336 | 0.88x |
| heredoc           |     0.073 → 0.065 | 0.89x |     0.362 → 0.400 | 1.11x |
| consumer-m2       |     8.435 → 8.519 | 1.01x |   72.150 → 75.048 | 1.04x |

All process-median ranges overlap, with substantial outliers (for example,
consumer print spans 60.35–84.99 ms on base and 62.34–229.67 ms on head). The
large initial small-fixture parse difference does not persist with longer warmup.
The remaining median ratios range from 0.88x to 1.11x. **These measurements do not
establish non-regression conclusively; acceptance criterion 4 remains unconfirmed.**
The raw observations are retained so independent verification can assess that
criterion without treating noise as either proof of a regression or proof of parity.

## Bounded Zsh and analyze follow-up

The corpus and timing observations above identify the original `f2bbe6c` assets;
they are retained without further performance measurements. Review follow-up is
limited to Zsh prefix ordering, the four analyze option-state exports, and the
obsolete package README description of the dropped sentinel backport.

A hand-written Zsh 5.9 program sets `a=abc` and prints `${=#a}` with `printf`.
Its expected output is `<3>\n`; the original printer emitted `${#=a}`, whose real
Zsh output is `<0>\n`. Public parse/print/reparse tests first failed on the lost
`Split: OptOn`, `Length: true` and parameter name, and now retain those fields.
Fifteen hand-written fixtures, each under default and KeepPadding, cover on/off
states, combined prefixes, length/existence operators, and unaffected controls.
Each checks source and printed Zsh stdout, exact printed spelling, and explicit
semantic fields after reparsing. Only synthetic programs are executed.

`printer-zsh-prefix-order.patch` moves the option-state loop before the existing
operator switch; parsing and all other printer branches are unchanged. The
manifest, offline reversal gate and missing/altered-digest tests include it.
Analyze-only runtime and type tests first failed on missing `OptState`, `OptUnset`,
`OptOn` and `OptOff`; the analyze barrel now exposes the consumed type and all its
named values. The uint8 boundary and cross-family type rejection remain tested.
Schema regeneration produces no changes; analyze API rollups and docs are current.
Performance criterion 4 remains inconclusive and separately held.
