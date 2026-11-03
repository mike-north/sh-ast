/** Stage one accepted consumer build and frozen runtime dependencies without changing its checkout. */
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { hash, verifyPrepared } from './artifacts.mjs';
import { matchedArtifacts } from './stream-encoding-model.mjs';

/** Hash owned package files only; dependency edges are recorded separately to avoid cycles. */
export function files(directory) {
  const result = {};
  const visit = (path) => {
    for (const name of readdirSync(path).sort()) {
      if (name === 'node_modules') continue;
      const child = join(path, name);
      if (statSync(child).isDirectory()) visit(child);
      else result[relative(directory, child)] = hash(readFileSync(child));
    }
  };
  visit(directory);
  return result;
}

/** Resolve package roots through Node's actual dependency graph, including pnpm-linked versions. */
function dependencyRoot(parent, name) {
  const require = createRequire(join(parent, 'package.json'));
  // Type-only packages can intentionally export no runtime entry or package.json.
  // Search Node's resolution directories instead of requiring such an export.
  for (const directory of require.resolve.paths(`${name}/package.json`) ?? []) {
    const path = join(directory, name);
    try {
      if (JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).name === name)
        return realpathSync(path);
    } catch {
      /* A lookup directory need not contain this package. */
    }
  }
  throw new Error(`Cannot resolve package root for ${name}`);
}

/** Links are created only inside staging and point to frozen bytes, never mutable workspace dependencies. */
function link(root, name, target) {
  const destination = join(root, 'node_modules', name);
  mkdirSync(dirname(destination), { recursive: true });
  symlinkSync(target, destination, 'dir');
}

/** Copy every transitive runtime package once while preserving separate versions and cyclic dependency edges. */
export function freezeDependencies(roots, output) {
  mkdirSync(output, { recursive: true });
  const seen = new Map();
  const packages = [];
  const freeze = (source) => {
    source = realpathSync(source);
    if (seen.has(source)) return seen.get(source);
    const target = join(output, String(seen.size), 'package');
    seen.set(source, target);
    cpSync(source, target, {
      recursive: true,
      dereference: true,
      filter: (entry) => !relative(source, entry).split('/').includes('node_modules'),
    });
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    const record = {
      source,
      root: target,
      name: manifest.name,
      version: manifest.version,
      assets: files(target),
      dependencies: {},
    };
    packages.push(record);
    const dependencies = {
      ...manifest.peerDependencies,
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };
    for (const name of Object.keys(dependencies).sort()) {
      let child;
      try {
        child = dependencyRoot(source, name);
      } catch (error) {
        if (
          Object.hasOwn(manifest.optionalDependencies ?? {}, name) ||
          manifest.peerDependenciesMeta?.[name]?.optional
        )
          continue;
        throw error;
      }
      const frozen = freeze(child);
      link(target, name, frozen);
      record.dependencies[name] = frozen;
    }
    return target;
  };
  return {
    roots: Object.fromEntries(Object.entries(roots).map(([name, path]) => [name, freeze(path)])),
    packages,
  };
}

/** Read an existing producer manifest without rebuilding or relabeling a published release. */
function producer(path) {
  const prepared = JSON.parse(readFileSync(path, 'utf8'));
  verifyPrepared(prepared);
  const local = prepared.artifacts.filter((x) => x.gitHead);
  assert.equal(local.length, 1, 'producer manifest must identify one local build');
  return local[0];
}

/** Preparation is deliberately separate from measurement; compilation cannot contaminate quiet timing rounds. */
export function prepareConsumer({
  baseline,
  candidate,
  consumerRoot,
  consumerRef,
  dependencyRoot: installationRoot = consumerRoot,
  output,
  expectedJavascriptChanges = {},
  compactSidecar = false,
}) {
  output = resolve(output);
  consumerRoot = resolve(consumerRoot);
  installationRoot = resolve(installationRoot);
  assert.match(consumerRef, /^[a-f0-9]{40}$/, 'exact accepted consumer SHA required');
  const artifacts = matchedArtifacts(
    producer(baseline),
    producer(candidate),
    expectedJavascriptChanges,
  );
  mkdirSync(output); // Refuse to overwrite an earlier frozen experiment.
  const build = join(output, 'build');
  mkdirSync(build);
  const archive = execFileSync(
    'git',
    [
      'archive',
      consumerRef,
      'packages/eslint-plugin/src',
      'packages/eslint-plugin/package.json',
      'packages/eslint-plugin/tsconfig.json',
      'tsconfig.base.json',
      'pnpm-lock.yaml',
    ],
    { cwd: consumerRoot },
  );
  execFileSync('tar', ['-xf', '-', '-C', build], { input: archive });
  const source = join(installationRoot, 'packages/eslint-plugin');
  const runtimeNames = ['eslint', '@eslint/core', '@eslint/plugin-kit'];
  const dependencies = freezeDependencies(
    Object.fromEntries(runtimeNames.map((name) => [name, dependencyRoot(source, name)])),
    join(output, 'dependencies'),
  );
  const plugin = join(build, 'packages/eslint-plugin');
  for (const [name, path] of Object.entries(dependencies.roots)) link(plugin, name, path);
  link(plugin, 'sh-ast', artifacts[0].packageRoot);
  // Build-only compiler/types resolution can read the existing installation; runtime resolution is frozen above.
  symlinkSync(join(installationRoot, 'node_modules'), join(build, 'node_modules'), 'dir');
  const compiler = dependencyRoot(installationRoot, 'typescript');
  execFileSync(process.execPath, [join(compiler, 'bin/tsc'), '-p', join(plugin, 'tsconfig.json')], {
    stdio: 'inherit',
  });
  const arms = {};
  for (const artifact of artifacts) {
    const root = join(output, artifact.label, 'consumer');
    mkdirSync(root, { recursive: true });
    cpSync(join(plugin, 'dist'), join(root, 'dist'), { recursive: true });
    cpSync(join(plugin, 'package.json'), join(root, 'package.json'));
    for (const [name, path] of Object.entries(dependencies.roots)) link(root, name, path);
    link(root, 'sh-ast', artifact.packageRoot);
    arms[artifact.label] = { root, entry: join(root, 'dist/index.js'), assets: files(root) };
  }
  assert.deepEqual(
    arms.baseline.assets,
    arms.candidate.assets,
    'consumer emission must be identical',
  );
  const prepared = {
    schemaVersion: 1,
    preparedAt: new Date().toISOString(),
    artifacts,
    expectedJavascriptChanges,
    compactSidecar,
    arms,
    dependencies,
    consumer: {
      gitHead: consumerRef,
      sourceRoot: consumerRoot,
      sourceArchiveSha256: hash(archive),
      lockSha256: hash(readFileSync(join(build, 'pnpm-lock.yaml'))),
      version: JSON.parse(readFileSync(join(plugin, 'package.json'))).version,
    },
    build: {
      node: process.version,
      execPath: process.execPath,
      installationRoot,
      installedLockSha256: hash(readFileSync(join(installationRoot, 'pnpm-lock.yaml'))),
      compilerVersion: JSON.parse(readFileSync(join(compiler, 'package.json'))).version,
      compilerSha256: hash(readFileSync(join(compiler, 'lib/typescript.js'))),
    },
  };
  writeFileSync(join(output, 'prepared.json'), JSON.stringify(prepared, null, 2) + '\n');
  return prepared;
}

/** Revalidate immutable files and dependency resolution edges before and after each measurement campaign. */
export function verifyExperiment(prepared) {
  matchedArtifacts(
    prepared.artifacts.find((x) => x.label === 'baseline'),
    prepared.artifacts.find((x) => x.label === 'candidate'),
    prepared.expectedJavascriptChanges,
  );
  verifyPrepared({ artifacts: prepared.artifacts });
  for (const arm of Object.values(prepared.arms))
    assert.deepEqual(files(arm.root), arm.assets, 'consumer bytes changed');
  assert.deepEqual(
    prepared.arms.baseline.assets,
    prepared.arms.candidate.assets,
    'consumer arms differ',
  );
  for (const pkg of prepared.dependencies.packages) {
    assert.deepEqual(files(pkg.root), pkg.assets, 'runtime dependency bytes changed');
    for (const [name, target] of Object.entries(pkg.dependencies))
      assert.equal(
        realpathSync(join(pkg.root, 'node_modules', name)),
        target,
        'dependency edge changed',
      );
  }
  for (const artifact of prepared.artifacts) {
    const arm = prepared.arms[artifact.label];
    assert.equal(
      realpathSync(join(arm.root, 'node_modules/sh-ast')),
      realpathSync(artifact.packageRoot),
    );
    for (const [name, target] of Object.entries(prepared.dependencies.roots))
      assert.equal(realpathSync(join(arm.root, 'node_modules', name)), target);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      baseline: { type: 'string' },
      candidate: { type: 'string' },
      'consumer-root': { type: 'string' },
      'consumer-ref': { type: 'string' },
      'dependency-root': { type: 'string' },
      output: { type: 'string' },
      'reviewed-javascript-changes': { type: 'string' },
      'compact-sidecar': { type: 'boolean', default: false },
    },
  });
  for (const key of ['baseline', 'candidate', 'consumer-root', 'consumer-ref', 'output'])
    assert(values[key], `--${key} required`);
  prepareConsumer({
    ...values,
    consumerRoot: values['consumer-root'],
    consumerRef: values['consumer-ref'],
    dependencyRoot: values['dependency-root'],
    expectedJavascriptChanges: values['reviewed-javascript-changes']
      ? JSON.parse(readFileSync(resolve(values['reviewed-javascript-changes']), 'utf8'))
      : {},
    compactSidecar: values['compact-sidecar'],
  });
  console.log(join(resolve(values.output), 'prepared.json'));
}
