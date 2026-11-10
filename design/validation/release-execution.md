# Two-minor release execution

The user authorized the necessary implementation PR merges and repository-generated
release PR merges, including their automatic npm publication effects. The sequence
preserves separate 0.4.0 and 0.5.0 releases. Publication and tagging use the existing
CI workflow.

## Producer Release A

- [Implementation PR #30](https://github.com/mike-north/sh-ast/pull/30) merged at
  `b3e6218dcd2c950e9658fdf7d8bf09be29d4e827` after its checks and review. A merge
  commit preserves the Release B ancestry.
- [Generated release PR #32](https://github.com/mike-north/sh-ast/pull/32) contained
  exactly the A changeset removal, sh-ast 0.4.0 version, and changelog entry.
  Independent scope inspection and Copilot review found no issues. All four
  checks passed on head `14b53383d2e975eea015f9c0f11203726b1bb7d2` before merge
  `5865f1426095e5dab3a98999036f23cc585616a0`.
- The bot-created PR workflows initially awaited maintainer approval without
  jobs. Each normal GitHub **Approve and run** control was used; no protection
  settings changed. CI 41413734626, WASM 41413734766, schema 41413734635, and review
  gate 41413734627 passed on attempt 2.
- [Release workflow 41414457666](https://github.com/mike-north/sh-ast/actions/runs/41414457666)
  published sh-ast 0.4.0 at 2026-11-02T08:38:21Z and created its tag and release.
  npm subsequently returned version 0.4.0 and tarball
  `https://registry.npmjs.org/sh-ast/-/sh-ast-0.4.0.tgz`, with integrity
  `sha512-hDi3EXVabdlo+ROzVoKgBLkN/oNQSgn+iYmv2C/6SQrr6Vsl/YKhD/V7J4WCSNjnO17sBts76WNGCP6P4M/iJQ==`.
  npm did not return a `gitHead` field.
- The downloaded tarball SHA-256 is
  `16ba4818153950a0e3a5e1c4f96ef87bc6100eba91b05f95b8ebe129d0996f68`.
  Independent artifact acceptance matched all 73 runtime/declaration/map assets
  against the accepted A candidate. Its 26 tests passed for cold synchronous
  initialization, faithful defaults and positions/errors, and immutable original
  position snapshots. Root/analyze installed-name imports work; no B walk/print
  APIs leaked. Only package metadata differs from the candidate: version and
  removed prepack script. The [registry receipt](release-a-published/registry-metadata.json),
  [asset comparison](release-a-published/asset-comparison.json),
  [test results](release-a-published/test-results.json),
  [public surface check](release-a-published/public-surface-result.json), and
  [metadata comparison](release-a-published/package-metadata-diff.json) preserve
  this evidence. Source association comes from the CI checkout, not an npm
  `gitHead` claim.

## Dependent preparation

Consumer A PR #104 is refreshing its lockfile and importer receipts against the
actual published sh-ast 0.4.0. Its existing generated release PR #87 must regenerate
after #104 merges before it is merged, preserving the consumer's 0.4.0 step.

Producer B has merged the released A baseline locally at
`1d46fbca5e3b9ac34d42bf0b48ec026b7bd2468c`. This consumes the A changeset and retains
its 0.4.0 version/changelog. The reviewed B minor note is now active separately as
`.changeset/faithful-traversal-printing.md`, targeting 0.5.0. B is not yet merged or
published. Consumer B remains gated on actual producer 0.5.0 publication and its
ordinary registry-dependent frozen-install checks.

The rebased producer passed uncached build/check/test (666 runtime tests plus
type tests); uncached API/docs regeneration produced no changes. These checks
validate the candidate against the released baseline, not a future 0.5.0 registry
artifact.
