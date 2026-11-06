# Versioning and changelogs

Use `pnpm changeset` for published-package behavior and type changes. Tooling-only
changes do not require a package changeset. Changesets generates package versions
and `CHANGELOG.md` through `pnpm version-packages` in the existing release action.

This project stays in the 0.x series until the owner declares the shape stable.
There is no override flag. Breaking changes are expected during 0.x; use `minor`
for observable syntax or binding changes. Do not add compatibility shims or
migration paths.

`pnpm check:release` rejects every `major` changeset, publishable manifests outside
0.x (including stable-series prereleases), and Changesets release plans outside
0.x. It runs in CI, before release versioning, and before publishing or tagging.
Run its regression tests with `pnpm test:release-gate`.
