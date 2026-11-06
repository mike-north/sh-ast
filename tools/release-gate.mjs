/**
 * Release tooling enforces the owner's 0.x boundary independently of syntax APIs.
 * Both proposed changes and publishable versions must remain below the stable
 * series; only an owner-directed policy change can remove this boundary.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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

/** CLI status computes dependency/fixed/linked effects without applying version changes. */
function releasePlan(root) {
  const directory = mkdtempSync(join(root, '.release-gate-'));
  try {
    const output = join(directory, 'plan.json');
    const cli = join(cliManifest, '..', 'bin.js');
    execFileSync(process.execPath, [cli, 'status', '--output', output], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(readFileSync(output, 'utf8'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    for (const release of releasePlan(root).releases)
      checkVersion(release.newVersion, `Changesets next version for ${release.name}`);
  }
  console.log(`0.x release gate passed (${mode}).`);
} catch (error) {
  console.error(`${error.message}\n${policy}`);
  process.exitCode = 1;
}
