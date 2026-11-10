# Acceptance scenarios and consumer gate

Status: these scenarios were written to be implemented before the software
changes they cover, and the shipped releases implement them; the test suite and
[IMPLEMENTATION.md](IMPLEMENTATION.md) record the results. They elaborate
[D1-D8](ARCHITECTURE.md#accepted-direction).
Use the exact pinned upstream Go package as an independent behavioral oracle and
hand-derived assertions for important examples. Do not generate expectations from
the production codec or its schema generator.

## Release A: owned by sh-ast

| ID  | Scenario                                                                                                                                       | Observable acceptance                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Fresh Node subprocess imports the built/installed package and immediately parses `echo hi`                                                     | First call returns a File synchronously, with no initialization await or prewarm. Queue a microtask immediately before the call and assert the result is available first. Verify asset resolution from the installed package. Observe exactly one compilation/instantiation across calls if that reuse is promised; timing alone is not proof.                                                  |
| A2  | `""`, whitespace, `# only\n`, `echo ''`, `echo hi`, `echo hi;`, `echo ${a:-}`                                                                  | Match upstream empty File, invalid boundaries, comments, absent versus present token positions, false flags, empty literal value, and nil/empty collections. Runtime requiredness matches declarations. Do not synthesize valid bounds to make an ESLint assertion pass.                                                                                                                        |
| A3  | `echo "🎉" 你好\n`, combining marks, tabs, CRLF, trailing newline, long lines, leading/trailing comments                                       | Raw byte positions match Go. For the CJK literal, bytes `[12,18)` and columns 13-19 correspond to UTF-16 indices `[10,12)` and columns 11-13. Derive consumer locations separately from the exact source. Leading comment spans may precede parent Stmt spans.                                                                                                                                  |
| A4  | Every exported AST field, every interface alternative, auxiliary struct, and operator family                                                   | Compare independent Go values with the public TS tree. Compile direct scalar reads and discriminant narrowing; reject misspelled fields and cross-domain/invalid operator inputs. Cover optional pointers, booleans both ways, nil and empty slices, and zero values. BraceExp can be constructed by an oracle using SplitBraces without changing Parse behavior.                               |
| A5  | `(foo \|` with RecoverErrors and position constructor edge cases                                                                               | Recovered statement and closing parenthesis remain distinguishable from ordinary invalid positions. Compare Offset/Line/Col/IsValid/IsRecovered and supported position behavior. Exercise 18-bit line/14-bit column overflow and offset saturation using small constructed cases, not multi-gigabyte source.                                                                                    |
| A6  | Valid/invalid parser options and dialect matrix                                                                                                | Compare KeepComments true/false/default, Variant values, `sh` alias if a string setter is exposed, unsupported LangAuto, unknown values, StopAt length/whitespace/prefix/quoted behavior, and recovery limits. Four-byte StopAt examples: `éé` fits; `ééé` does not. Preserve POSIX `[[ a == b ]]` as an ordinary CallExpr where upstream does. No shell-version compatibility policy is added. |
| A7  | `echo ok; (` and mksh `[[ a =~ b ]]`, plus errors after Unicode                                                                                | Preserve partial File and distinguish ParseError from LangError. Compare every original field and message, including Incomplete/Text versus Feature/Langs/LangUsed. Upstream raw positions survive any diagnostic view. Invalid caller options are distinguishable from source syntax and bridge failures.                                                                                      |
| A8  | Repeated parses with alternating source/filename/options, success-error-success; malformed bridge response; allocation failure/exception paths | No stale source, options, filename or tree state; an ordinary syntax error does not poison the WASM instance. Memory ownership is released on failure paths. Corrupt envelopes and runtime failures do not masquerade as ParseError. Measure cold and warm behavior separately; no unaccepted performance threshold.                                                                            |
| A9  | Parse/encode/decode observation round trip, including quotes, substitutions, arithmetic/test operators, comments and heredocs                  | Every upstream-observable field needed for Print survives. A test-only upstream Print of the reconstructed unchanged tree agrees with Print of the original Go tree under the same options. Recovery and nil/empty cases need explicit reconstruction proof. This is private codec acceptance, not a public Release A printer.                                                                  |

For A3/A5, test `NewPos` observable behavior even when a line or column becomes
zero; validity is not simply “all coordinates positive.” For A4, coverage must
enumerate fields as well as node kinds: visiting one instance of each node does
not cover every scalar or alternative. Keep current loop-body and quoting-flag
regressions when adapting old tests to the new representation.

Input-domain tests depend on the byte-policy decision. If byte input is accepted,
assert upstream's ParseError and partial result for invalid UTF-8, rather than
successful parsing of malformed bytes. Separately test transport of constructed
AST string and filename byte values. For a string convenience, specify
lone-surrogate encoding explicitly and test it. If a narrower source domain is
accepted, assert a precise rejection or documented conversion rather than silently
replacing bytes.

## Release B: owned by sh-ast

| ID  | Scenario                                                                                                                  | Observable acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Compare upstream and TS Walk event traces for nested commands, substitutions, assignments, redirects and auxiliary fields | Same entry order and nil exit events; Slice/Replace/Expansion themselves are not visited as Nodes. A generated field-key list alone is not the oracle. Include upstream's specialized leading/trailing statement-comment handling.                                                                                                                                                                                                                                                                   |
| B2  | Callback returns false at root and at a nested node                                                                       | Exact upstream pruning: no children or exit callback for a pruned node; unpruned siblings continue in upstream order. Callback exceptions propagate predictably without retained traversal state. Do not substitute a Promise or call a callback only once.                                                                                                                                                                                                                                          |
| B3  | Print File, Stmt, Word, Assign, each supported Command/WordPart family, and unsupported roots                             | Compare output/errors with upstream Print. Only File gets its trailing newline guarantee. Unsupported root kinds are errors; do not pretend every Node is printable.                                                                                                                                                                                                                                                                                                                                 |
| B4  | Printer option cases                                                                                                      | Cover Indent, BinaryNextLine, SwitchCaseIndent, SpaceRedirects, KeepPadding, Minify, SingleLine, FunctionNextLine, including disabled/zero defaults and incompatible Minify+SingleLine. Preserve KeepPadding's upstream best-effort/deprecated status. Assert comment/heredoc behavior and input numeric constraints.                                                                                                                                                                                |
| B5  | Edit a parsed argument, operator, and constructed node in separate cases; print and reparse                               | Edits reach Go rather than being lost to a reparse of old source. Compare with equivalent Go edits and printer output; assert selected syntax/meaning after reparsing. Do not compare source bytes to the original input. Newly created nodes and stale/invalid source positions obey the selected contract.                                                                                                                                                                                         |
| B6  | Ordinary-array callback edits under the [accepted contract](WALK-MUTATION-DECISION.md)                                    | Future-slot replacement is observed; appends beyond captured length are ignored; replacing the owner array does not retarget an active list; later walks see the new array. Stored Comment replacement keeps the retained old JS object, while item-comment copies isolate original values. Keep field/child edits, pruning, synchronous boolean callbacks and reentrancy. Destructive active-array edits and unrestricted Go storage parity are outside the contract, not invented rejection cases. |

Also edit a Comment's text and replace a Word's last part, then compare subsequent
Node.Pos()/End() observations and printing with equivalent Go edits. Derived
bounds must reflect upstream computations from the current tree, not independently
editable serialized bounds left over from parsing.

Printing is formatting, not an execution equivalence proof. Tests should compare
known syntax and literal meaning without executing shell scripts. A source edit
need not preserve whitespace or quote spelling to satisfy the intended fix.

## Consumer responsibilities and existing evidence

The sibling checkout has a real ESLint integration, so extend it rather than
creating an ESLint harness in sh-ast. At consumer commit `7412616a`:

| Evidence                                                                      | Current behavior / implication                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/eslint-plugin/src/language/shell-language.ts:1,165`                 | Imports ShAstError and directly calls parseSync. Candidate baseline 0.1.0 lacks ShAstError (it has ShBridgeError), so the unchanged consumer cannot load it. Resolve the baseline/API migration before interpreting this as a parser regression. |
| `packages/eslint-plugin/src/index.ts:2,26`                                    | Imports and re-exports `sh-ast/analyze` resolveWord. The corrected baseline does have it. Its future disposition needs coordinated migration.                                                                                                    |
| `packages/eslint-plugin/src/language/shell-source-code.ts:367,421`            | Builds enter/exit events and ancestry from visitor keys; gathers comments with walk and sorts them by source position. These are consumer adapters.                                                                                              |
| `packages/eslint-plugin/test/helpers.ts:28`, `integration.test.ts:51`         | Real Linter.verify, nested events and ancestors already tested.                                                                                                                                                                                  |
| `packages/eslint-plugin/test/loop-body-traversal.test.ts:73`                  | For/while body reachability already tested.                                                                                                                                                                                                      |
| `packages/eslint-plugin/test/multibyte.test.ts:30`, `parse-errors.test.ts:36` | Unicode columns and fatal diagnostic conversion already tested.                                                                                                                                                                                  |
| `packages/eslint-plugin/test/unused-directive-fix.test.ts:47`                 | Real verifyAndFix tests text fixes; this does not prove tree edit/print/reparse.                                                                                                                                                                 |
| `packages/eslint-plugin/test/packaged-install-smoke.test.ts:74-97`            | Packs the plugin and installs into a new temp project. Registry transitive sh-ast bypasses a workspace link unless the harness is changed.                                                                                                       |

### Proposed consumer checks

- **C1 Cold first lint:** in a fresh Node process, load the linked/built candidate
  through the real plugin and lint immediately, without prewarming. Verify exact
  resolved package path/build identity from the plugin importer.
- **C2 Adaptation:** retain exact enter/exit events, ancestor identity, loop-body
  reachability, comments/directives, fatal errors, and source text access. Cover
  empty/comment-only files. Convert byte positions into ESLint locations in the
  adapter, including appropriate column conventions and invalid-position policy.
- **C3 Unicode fix placement:** exercise a real Linter report and verifyAndFix after
  emoji/CJK/combining characters and across CRLF. Assert the precise replacement
  range and unchanged surrounding source.
- **C4 Installed candidate:** run the packed-plugin smoke test with its transitive
  sh-ast explicitly supplied by the candidate tarball; verify resolved identity
  inside that temporary installation. A registry baseline pass is insufficient.
- **C5 Real tree edit and printed fix:** parse `printf '%s\n' 'old 🎉'\n`; on a
  separate editable tree change the final single-quoted value to `new 🎉`; Print;
  return that output as a real ESLint replacement fix; reparse. Assert one printf
  command with three arguments, unchanged format argument and only the selected
  argument's meaning changed. A second fix pass is stable. Existing lint traversal
  caches (`shell-source-code.ts:286`) remain associated with the original tree.
  Add comment/heredoc/operator variants after this minimal case.

## Exact candidate workflow

This runbook describes the candidate gate as designed; the implementation
records hold the executed results. Perform
consumer migration/linking only in a disposable consumer validation worktree
based on its recorded commit. Leave `<consumer>` intact.
Use the app's worktree tool or an explicitly created validation checkout; record
its actual absolute path as `consumer_dir`. Set `candidate_dir` to the actual
sh-ast implementation checkout and `artifact_dir` to a retained evidence folder.

1. Record both HEADs, dirty/untracked inventories, package versions, manifest and
   lockfile hashes, upstream pins, and Node/pnpm/Go/Binaryen versions. A dirty
   candidate also needs its patch and untracked-source inventory; HEAD alone does
   not identify the source. Reconcile missing ShAstError and any later migration
   before using consumer failures as feature evidence.
2. In the candidate, use the repository scripts below. A source change to the shim
   additionally requires the pinned canonical Linux WASM build and version_131
   optimization from `.github/workflows/wasm-reproducibility.yml`. Ordinary
   `pnpm build` compiles TypeScript only. Record the WASM bytes actually tested.

   ```sh
   cd "$candidate_dir"
   pnpm install --frozen-lockfile
   pnpm run clean
   NX_SKIP_NX_CACHE=true pnpm build
   NX_SKIP_NX_CACHE=true pnpm check
   NX_SKIP_NX_CACHE=true pnpm test
   go -C packages/sh-ast/shim test ./...
   ```

   For public API changes, update reports with
   `pnpm --filter sh-ast run fix:api-report` and
   `NX_SKIP_NX_CACHE=true pnpm build:docs`, then rerun the affected checks. Run
   `pnpm run generate:sh-ast-schema` and inspect generated drift. These update steps
   belong before final acceptance; the final candidate must have no unexplained
   generated changes. Follow the existing pinned Linux WASM reproducibility gate.

3. Pack the built candidate and retain its identity. `prepack` runs API Extractor;
   it does not substitute for the build or WASM rebuild.

   ```sh
   cd "$candidate_dir/packages/sh-ast"
   npm pack --json --pack-destination "$artifact_dir"
   ```

   Record the returned tarball filename and SHA-256; also hash the WASM,
   wasm_exec.js, generated schema, built JS and rolled-up declarations. List the
   tarball contents and verify that all export targets/assets are included.

4. In the disposable consumer checkout, install its locked dependencies, then
   link the built candidate from the actual importing package. pnpm 11 linking
   can change dependency metadata; inventory that intentional change.

   ```sh
   cd "$consumer_dir"
   pnpm install --frozen-lockfile
   pnpm --dir "$consumer_dir/packages/eslint-plugin" link "$candidate_dir/packages/sh-ast"
   ```

   Before tests, resolve `sh-ast` and any retained subpaths from
   `packages/eslint-plugin`, resolve symlinks, and assert the result is this
   candidate. Compare hashes, not merely the displayed version. Put these receipt
   assertions in the future consumer gate so a stale link cannot produce green
   evidence. The manifest's existing `^0.3.0` excludes the declared baseline's
   `0.1.0`; the candidate override must be explicit.

5. Migrate/test the consumer adapter in that worktree, using its actual scripts:

   ```sh
   cd "$consumer_dir"
   pnpm run clean
   NX_SKIP_NX_CACHE=true pnpm build
   NX_SKIP_NX_CACHE=true pnpm check
   NX_SKIP_NX_CACHE=true pnpm test
   ```

   For public API changes, regenerate the consumer API reports with
   `pnpm --filter @eslint-sh/eslint-plugin run fix:api-report` and, if its surface
   changes, `pnpm --filter eslint-sh run fix:api-report`. Run
   `NX_SKIP_NX_CACHE=true pnpm build:docs`, inspect and retain generated changes,
   then rerun affected checks before accepting the candidate.

   Add fresh-process C1/C4 probes alongside the existing suite. Extend the packed
   install harness so its temporary package.json uses an exact file-tarball
   candidate dependency/override for sh-ast, installs that artifact with ESLint 10
   and the packed plugin, and asserts resolution from the installed plugin. Verify
   the chosen npm override mechanism in that harness before counting the result;
   no candidate-injection flag exists today. A passing unmodified smoke test is
   labeled registry-baseline-only.

6. Save commands, exits, logs, receipt assertions and test coverage with the
   candidate/consumer identities. Restore or discard only the dedicated validation
   checkout when finished; do not overwrite the maintainer's original checkout state.

Release acceptance requires both linked development-consumer evidence and packed
installation evidence for the same candidate content. Refresh receipt hashes after
every rebuild. Skip-cache avoids stale task results, but is not a substitute for
checking which package the process loaded.
