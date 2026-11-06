/**
 * Release tooling enforces the owner's 0.x boundary independently of syntax APIs.
 * Both proposed changes and publishable versions must remain below the stable
 * series; only an owner-directed policy change can remove this boundary.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const cliManifest = require.resolve('@changesets/cli/package.json');
// Use the parser bundled with our installed CLI rather than define a second YAML grammar.
const cliRequire = createRequire(cliManifest);
const readRequire = createRequire(cliRequire.resolve('@changesets/read'));
const parseChangeset = readRequire('@changesets/parse').default;
const policy =
  'This project stays in the 0.x series until the owner declares the shape stable. There is no override flag.';

/** Generated artifacts and dependency copies are not release source manifests. */
const excluded = new Set([
  'node_modules',
  '.git',
  '.nx',
  '.pnpm-store',
  '.cache',
  'dist',
  'temp',
  'scratch',
  'api-docs-temp',
  'api-report-combined',
]);
function* files(directory, sourceManifests = true) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (
      entry.isDirectory() &&
      (!sourceManifests || !excluded.has(entry.name)) &&
      !entry.name.startsWith('.release-gate-')
    )
      yield* files(path, sourceManifests);
    else if (entry.isFile()) yield path;
  }
}

/** Fail closed on missing/invalid versions, including stable-series prereleases. */
function checkVersion(version, source) {
  if (
    typeof version !== 'string' ||
    !/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.test(
      version,
    )
  ) {
    throw new Error(`${source}: disallowed or invalid version ${JSON.stringify(version)}`);
  }
}

/**
 * Compute the installed CLI's real dependency/fixed/linked/prerelease effects
 * from local manifests, changesets, and configuration without applying versions.
 * A version ceiling is independent of Git change eligibility: a version commit
 * has already consumed its changesets, and a shallow PR may lack main's history.
 * CLI status additionally validates those states before emitting its plan, so
 * use its planner without a history ref. Planning/configuration errors still
 * propagate to the gate's failure handler; no substitute plan is accepted.
 */
function releasePlan(root) {
  const getReleasePlan = cliRequire('@changesets/get-release-plan').default;
  return getReleasePlan(root);
}

try {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || !['changesets', 'versions'].includes(mode))
    throw new Error('Usage: release-gate.mjs changesets|versions');
  const root = resolve('.');
  if (mode === 'changesets') {
    for (const path of files(join(root, '.changeset'), false)) {
      if (!path.endsWith('.md') || basename(path) === 'README.md') continue;
      for (const release of parseChangeset(readFileSync(path, 'utf8')).releases) {
        if (release.type === 'major') throw new Error(`${path}: major bump for ${release.name}`);
      }
    }
  } else {
    for (const path of files(root)) {
      if (basename(path) !== 'package.json') continue;
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      if (manifest.private !== true) checkVersion(manifest.version, path);
    }
    // Group constraints can make the provider and its dependent stable together.
    // Evaluate the complete plan so an earlier violation cannot hide a later
    // dependent's forbidden version. Every validation failure still rejects.
    const violations = [];
    for (const release of (await releasePlan(root)).releases) {
      try {
        checkVersion(release.newVersion, `Changesets next version for ${release.name}`);
      } catch (error) {
        violations.push(error.message);
      }
    }
    if (violations.length) throw new Error(violations.join('\n'));
  }
  console.log(`0.x release gate passed (${mode}).`);
} catch (error) {
  console.error(`${error.message}\n${policy}`);
  process.exitCode = 1;
}
