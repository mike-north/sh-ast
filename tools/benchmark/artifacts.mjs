/** Freeze exact registry releases and a built local package outside workspace dependency resolution. */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyIdentity } from './model.mjs';

/** SHA-256 is a content identity, while registry SRI separately authenticates downloaded tar bytes. */
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Every extracted file participates, including JS glue and generated metadata as well as WASM. */
function assetHashes(directory) {
  const entries = {};
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else entries[relative(directory, path)] = hash(readFileSync(path));
    }
  };
  visit(directory);
  return entries;
}
/** Subcommands use argument arrays so paths/options never become shell programs. */
function command(name, args, cwd) {
  return execFileSync(name, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}
/** Packaging never runs install hooks or modifies workspace manifests/lockfiles. The local build is refreshed before freezing its package. */
export function prepare(root) {
  command('pnpm', ['build'], root);
  command('pnpm', ['--filter', 'sh-ast', 'check:api-report'], root);
  const cache = mkdtempSync(join(tmpdir(), 'sh-ast-benchmark-'));
  const artifacts = [];
  for (const label of ['0.3.1', '0.4.0', '0.5.0', 'local']) {
    const directory = join(cache, label);
    mkdirSync(directory);
    const local = label === 'local';
    const cwd = local ? join(root, 'packages/sh-ast') : directory;
    const spec = local ? '.' : `sh-ast@${label}`;
    const registry = local
      ? null
      : JSON.parse(command('npm', ['view', spec, 'dist', '--json'], directory));
    const [packed] = JSON.parse(
      command(
        'npm',
        ['pack', spec, '--ignore-scripts', '--json', '--pack-destination', directory],
        cwd,
      ),
    );
    const tarball = join(directory, packed.filename);
    const packageRoot = join(directory, 'package');
    extractPackage(tarball, packageRoot);
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    verifyIdentity(
      manifest,
      local ? packed.version : label,
      readFileSync(tarball),
      registry?.integrity ?? packed.integrity,
    );
    const entry = resolve(packageRoot, manifest.main);
    verifyEntrypoints(packageRoot, manifest);
    artifacts.push({
      label: local ? 'local-candidate' : label,
      version: manifest.version,
      entry,
      packageRoot,
      tarball,
      tarballSha256: hash(readFileSync(tarball)),
      integrity: registry?.integrity ?? packed.integrity,
      registryTarball: registry?.tarball ?? null,
      assets: assetHashes(packageRoot),
      ...(local
        ? {
            gitHead: command('git', ['rev-parse', 'HEAD'], root).trim(),
            gitStatus: command('git', ['status', '--short'], root),
            sourceAssets: assetHashes(join(root, 'packages/sh-ast/src')),
          }
        : {}),
    });
  }
  return { schemaVersion: 1, preparedAt: new Date().toISOString(), cache, artifacts };
}
/** Reusing a prepared manifest still verifies every frozen byte before workers can import it. */
export function verifyPrepared(prepared) {
  for (const artifact of prepared.artifacts) {
    const bytes = readFileSync(artifact.tarball);
    if (hash(bytes) !== artifact.tarballSha256) throw new Error('Prepared tarball changed');
    const manifest = JSON.parse(readFileSync(join(artifact.packageRoot, 'package.json'), 'utf8'));
    verifyIdentity(manifest, artifact.version, bytes, artifact.integrity);
    verifyEntrypoints(artifact.packageRoot, manifest);
    if (JSON.stringify(assetHashes(artifact.packageRoot)) !== JSON.stringify(artifact.assets))
      throw new Error('Prepared package assets changed');
  }
}

/** Runtime and declaration entrypoints are package promises, even when only runtime phases are measured. */
export function verifyEntrypoints(packageRoot, manifest) {
  const targets = new Set([manifest.main, manifest.types].filter(Boolean));
  const collect = (value) => {
    if (typeof value === 'string') targets.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(manifest.exports);
  for (const target of targets) readFileSync(resolve(packageRoot, target));
}

/**
 * Accept only npm's package/ member namespace and strip it into a fresh directory.
 * Tar owns archive decoding; listing checks reject unexpected names before writes,
 * and extraction retains local ownership/umask rather than archive privileges.
 * This bounds package preparation, not arbitrary hostile-code execution: accepted
 * registry packages are subsequently imported by benchmark workers.
 */
export function extractPackage(tarball, packageRoot) {
  const parent = resolve(packageRoot, '..');
  const members = command('tar', ['-tzf', tarball], parent).trimEnd().split('\n');
  if (
    !members.length ||
    members.some(
      (name) =>
        !(name === 'package' || name.startsWith('package/')) ||
        name.split('/').some((part) => part === '..' || part === '.') ||
        /[\r\\]/.test(name),
    )
  )
    throw new Error('Archive members must remain under package/ without traversal');
  mkdirSync(packageRoot, { mode: 0o700 });
  command(
    'tar',
    [
      '-xzf',
      tarball,
      '--strip-components=1',
      '--no-same-owner',
      '--no-same-permissions',
      '-C',
      packageRoot,
      'package',
    ],
    parent,
  );
  // npm packs regular files/directories. Do not let later asset hashing follow symbolic links
  // or consume special files left by a nonconforming archive.
  const validate = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const entry = lstatSync(path);
      if (entry.isDirectory()) validate(path);
      else if (!entry.isFile())
        throw new Error('Package archive contains a symbolic link or special file');
    }
  };
  validate(packageRoot);
  if (!lstatSync(join(packageRoot, 'package.json')).isFile())
    throw new Error('Package archive must contain package/package.json');
}
