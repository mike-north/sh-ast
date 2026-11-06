# mvdan/sh v3.14.1 validation

The baseline is main `211c5b7d4207b5e409d3b1ed841ad629d5f03fde`, including
#80 and #84. The target is tagged upstream v3.14.1, commit
`a3f0c75d21d918756fa38de8b5d3429efde7948b`, the latest tagged release at the
comparison. Choosing the tag avoids importing later grammar decisions, notably
#1428's EOF-terminated missing heredocs. The source closure and correction audit
were recorded with the former vendored source. That source now lives in the
maintained fork; see its [source closure and correction audit](https://github.com/mike-north/sh/blob/bbc7c4ace575d5de375726fdaa2a5c001c46564c/FORK-MAINTENANCE.md)
and the binding's [fork-source migration record](../FORK-SOURCE-MIGRATION.md).

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
Unicode controls, and both Bash fixture runs accompany the source/corpus
comparison. The source-manifest digest and every corpus delta are retained in
[the summary](corpus-summary.json); the final fixed timing receipt is below.
Public declarations, API reports and Markdown API docs are generated
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
The remaining median ratios range from 0.88x to 1.11x. These initial observations
were inconclusive at the original review checkpoint and do not establish
non-regression. They remain separate from the fixed comparison below; overlap
and noise establish neither a stable regression nor parity.

## Bounded Zsh and analyze follow-up

The corpus and earlier timing observations above identify the original `f2bbe6c`
assets. The fixed comparison below instead measures the repaired `1f4282f` head.
The functional follow-up is
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
The measured tradeoff is recorded separately below.

The native Zsh oracle is optional: discovery and execution use the same `zsh`
command on PATH, with a successful `-f -c 'exit 0'` probe required to run it.
All 30 public parse/print/reparse, field and spelling cases run unconditionally;
the separate 30 native stdout cases explicitly skip when the executable is
unavailable. A masked-PATH run records 30 API passes and 30 native skips; this
host's Zsh 5.9 run records 60 passes. This is not evidence of native Zsh coverage
on Linux hosts without Zsh. Workflows and checker configuration are unchanged.

## Fixed comparison and accepted tradeoff

The correctness/performance tradeoff is accepted with the exact observations
below. The original no-tolerance comparison remains **FAIL**: three of ten head
aggregates exceed baseline. Acceptance of the pin does not relabel that result
or establish non-regression. No samples, targets or recorded verdicts were
changed, and no replacement campaign was run.

The baseline is `211c5b7d4207b5e409d3b1ed841ad629d5f03fde`; the measured repaired
head is `1f4282f5381394f1e08dda9c9ea2398d10f48b6b`. Subsequent integration of
main `d8534e6ddae76a05433d64651f3892c29326a9ae` adds only the separate #87
documentation/evidence receipt. Runtime, harness and measured assets are
unchanged by this integration and the tradeoff documentation.

This one fixed campaign used Node **v24.14.0**, Darwin **27.2.0 arm64**, Apple
**M5 Max**, 18 logical CPUs and 128 GiB. Both arms are locally packaged sources,
not npm release measurements. [Prepared package identities and all asset hashes](fixed-campaign/package-artifacts.json)
and the [original preparation identity](fixed-campaign/campaign-identity.json)
pin both tarballs, JavaScript, declarations, WASM, harness and fixtures. The
preparation identity's `timingsRun: false` describes preparation before this
campaign; it is retained unchanged, not a current execution-status field.

Each fixture/phase has nine paired rounds, alternating base/head order, with
serial fresh processes and post-clock correctness checks. Parse and the three
small print cells use 100 excluded warmups and 200 measured calls per process;
the two large print cells use 20/20. Parse, small print, then large print ran in
that order. All 180 timing processes and 20 separate verification processes
succeeded; 29,520 measured calls and 15,120 excluded warmups are accounted for.
No corpus script was executed as shell code. All process IDs, samples and
outliers remain in the raw records.

Each aggregate is the median of nine process medians, in milliseconds. Ratios
are head/base; decisions in the original comparison use unrounded values.

| Fixture / phase           |     Base median, ms |     Head median, ms |          Head/base | Original strict result |
| ------------------------- | ------------------: | ------------------: | -----------------: | ---------------------- |
| representative-1 / parse  | 0.09860400000000169 | 0.09795849999999717 | 0.9934536124294704 | MEETS                  |
| representative-1 / print  |  0.5946039999999897 |  0.5828544999999963 |  0.980239789843335 | MEETS                  |
| representative-50 / parse |   3.885062499999947 |  3.8439579999999296 | 0.9894198613278377 | MEETS                  |
| representative-50 / print |  37.481437500000084 |   36.82489600000008 |    0.9824835560269 | MEETS                  |
| nested-8 / parse          | 0.16566600000000165 | 0.17270849999999882 | 1.0425102314294852 | FAIL                   |
| nested-8 / print          |   0.979708500000001 |  0.9834374999999795 | 1.0038062342012737 | FAIL                   |
| heredoc / parse           | 0.05683299999999747 |  0.0539164999999997 |  0.948682983477946 | MEETS                  |
| heredoc / print           |  0.2666255000000035 |  0.2473954999999961 | 0.9278763659139612 | MEETS                  |
| consumer-m2 / parse       |   6.434646000000043 |    6.49635399999994 | 1.0095899603490068 | FAIL                   |
| consumer-m2 / print       |   59.82118750000018 |   55.16770900000006 | 0.9222101951754116 | MEETS                  |

Nested parse increased **4.251023142948517%**, about **0.0070425 ms**; nested
print increased about **0.003729 ms**. Consumer parse has the largest absolute
increase, about **0.061708 ms**. Consumer print decreased about **4.6534785 ms**.
Those absolute differences are displayed to seven decimal places; the original
binary floating-point values and all 90 paired-round ratios remain in the
[byte-identical strict comparison](fixed-campaign/strict-comparison.json.txt).
The `.txt` suffix preserves the original JSON bytes against automatic formatting.

Ongoing benchmark acceptance blocks only for a documented-budget violation or a
repeatable slowdown above 5% on a realistic fixture. Smaller differences do not
trigger another campaign. That policy and acceptance of this specific pin do
not change the original strict FAIL or turn these measurements into a general
performance guarantee. A single campaign does not establish stable causality;
the consumer-m2 fixture name does not identify the hardware.

The readiness sample lasted 1,076.063042 ms, with no recognized build/test
runtime reaching the fixed 50%-CPU readiness threshold. The host was not idle:
PerfPowerServices used about 169.135072% sampled CPU. Pre/post context is retained
in [provenance](fixed-campaign/provenance.json), not continuous monitoring or a
causal explanation. All three measurement segments exited 0; the one-shot shell
exited 1 after writing the strict FAIL, with post-run identities matching.

The [parse](fixed-campaign/parse-samples.jsonl),
[small-print](fixed-campaign/small-print-samples.jsonl) and
[large-print](fixed-campaign/large-print-samples.jsonl) raw files and the strict
comparison are byte-identical originals. Provenance records the raw/full-report
hashes, schedule, and all 20 verification records. It is a derived metadata
summary, not a full-report copy. Only private execution-path string values in
the prepared manifest and preparation identity are normalized.
[Normalization proof](fixed-campaign/metadata-normalization.json) retains
original/path-only/final hashes, every changed JSON pointer and non-string-token
digests; metadata formatting changes whitespace only. No raw observation or
strict-comparison byte is normalized, rounded, omitted or overwritten.
