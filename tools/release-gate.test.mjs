/** Release policy fixtures encode the owner's boundary independently of package behavior. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const script = resolve('tools/release-gate.mjs');
const require = createRequire(import.meta.url);
const cliManifest = require.resolve('@changesets/cli/package.json');
const cli = join(cliManifest, '..', 'bin.js');
const policy =
  /stays in the 0\.x series until the owner declares the shape stable.*no override flag/is;

/** Isolate Git configuration as well as history from the developer's surrounding checkout. */
function git(root, ...args) {
  return spawnSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    },
  );
}

/** Setup failures must never masquerade as a policy rejection. */
function succeeded(result) {
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

/** Fixture commits record genuine release lifecycle states without invoking repository hooks. */
function commit(root, message) {
  succeeded(git(root, 'add', '.'));
  succeeded(
    git(
      root,
      '-c',
      'user.name=Mike North',
      '-c',
      'user.email=michael.l.north@gmail.com',
      'commit',
      '--author=Mike North <michael.l.north@gmail.com>',
      '-m',
      message,
    ),
  );
}

/** Each fixture owns its Git root and main ref; no ancestor checkout can supply history. */
function fixture(
  action,
  { version = '0.10.0', bump = 'minor', privatePackage = false, packageName = 'example' } = {},
) {
  mkdirSync(resolve('scratch'), { recursive: true });
  const root = mkdtempSync(resolve('scratch/release-gate-'));
  try {
    mkdirSync(join(root, '.changeset'));
    mkdirSync(join(root, 'packages', packageName), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['packages/*'] }),
    );
    writeFileSync(
      join(root, 'packages', packageName, 'package.json'),
      JSON.stringify({ name: packageName, version, private: privatePackage }),
    );
    writeFileSync(
      join(root, '.changeset/config.json'),
      JSON.stringify({
        baseBranch: 'main',
        access: 'public',
        changelog: false,
        commit: false,
        fixed: [],
        linked: [],
        ignore: [],
        updateInternalDependencies: 'patch',
      }),
    );
    if (bump)
      writeFileSync(
        join(root, '.changeset/change.md'),
        `---\n"${packageName}": ${bump}\n---\n\nChange.\n`,
      );
    succeeded(git(root, 'init', '-b', 'main'));
    commit(root, 'Initial release fixture');
    assert.equal(succeeded(git(root, 'rev-parse', '--show-toplevel')), root);
    action(root);
  } finally {
    // Optional evidence retention affects only test cleanup, never release policy.
    if (process.env.RELEASE_GATE_TEST_KEEP_FIXTURES === '1') console.log(`Fixture: ${root}`);
    else rmSync(root, { recursive: true, force: true });
  }
}

function gate(root, mode) {
  return spawnSync(process.execPath, [script, mode], { cwd: root, encoding: 'utf8' });
}

/** Invoke the installed CLI, including its separate Git eligibility checks, without a shell stub. */
function changeset(root, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}

/** Handwritten minor intent has the unambiguous outcome 0.10.0 -> 0.11.0. */
function minorFeature(root) {
  succeeded(git(root, 'checkout', '-b', 'feature'));
  writeFileSync(join(root, 'packages/example/index.js'), 'export const value = 2;\n');
  writeFileSync(join(root, '.changeset/minor.md'), '---\n"example": minor\n---\n\nChange.\n');
  commit(root, 'Minor feature');
}

/** Snapshot the CLI's real plan without asking whether changed packages need changesets. */
function plannedVersions(root) {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { createRequire } from 'node:module';
     const require = createRequire(${JSON.stringify(cliManifest)});
     console.log(JSON.stringify(await require('@changesets/get-release-plan').default(process.cwd())));`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  succeeded(result);
  return Object.fromEntries(
    JSON.parse(result.stdout).releases.map(({ name, newVersion }) => [name, newVersion]),
  );
}

/**
 * Preserve actual CLI output and input bytes when collecting regression evidence.
 * This test-only destination never supplies or changes a release plan.
 */
function recordInferredEvidence(root, label, oracle, intent, versions) {
  const destination = process.env.RELEASE_GATE_TEST_EVIDENCE_DIR;
  if (!destination) return;
  const directory = join(destination, label);
  mkdirSync(directory, { recursive: true });
  const files = [
    'package.json',
    'packages/a/package.json',
    'packages/b/package.json',
    '.changeset/config.json',
    '.changeset/change.md',
    '.release-gate-oracle.json',
  ];
  for (const file of files) {
    const path = join(directory, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, readFileSync(join(root, file)));
  }
  for (const [name, result] of Object.entries({ oracle, intent, versions })) {
    writeFileSync(join(directory, `${name}.stdout.log`), result.stdout);
    writeFileSync(join(directory, `${name}.stderr.log`), result.stderr);
  }
  writeFileSync(
    join(directory, 'receipt.json'),
    JSON.stringify(
      {
        root,
        head: succeeded(git(root, 'rev-parse', 'HEAD')),
        node: process.execPath,
        cli,
        oracle: {
          argv: [process.execPath, cli, 'status', '--output', '.release-gate-oracle.json'],
          exit: oracle.status,
        },
        intent: { argv: [process.execPath, script, 'changesets'], exit: intent.status },
        versions: { argv: [process.execPath, script, 'versions'], exit: versions.status },
      },
      null,
      2,
    ),
  );
}

/**
 * A minor provider release can require a major peer-dependent release even in
 * the 0.x series. Group constraints may then raise both planned versions. The
 * oracle's order is left intact: diagnostics must still identify dependent b.
 */
for (const relationship of ['plain', 'fixed', 'linked']) {
  test(`G2 names the inferred stable dependent in an actual CLI ${relationship} plan`, () =>
    fixture(
      (root) => {
        mkdirSync(join(root, 'packages/b'));
        writeFileSync(
          join(root, 'packages/b/package.json'),
          JSON.stringify({
            name: 'b',
            version: '0.3.0',
            peerDependencies: { a: '^0.8.0' },
          }),
        );
        const configPath = join(root, '.changeset/config.json');
        const config = JSON.parse(readFileSync(configPath));
        if (relationship !== 'plain') config[relationship] = [['a', 'b']];
        writeFileSync(configPath, JSON.stringify(config));
        commit(root, 'Two-package baseline');
        succeeded(git(root, 'checkout', '-b', 'feature'));
        writeFileSync(join(root, 'packages/a/index.js'), 'export const value = 2;\n');
        writeFileSync(join(root, '.changeset/change.md'), '---\n"a": minor\n---\n\nChange.\n');
        commit(root, 'Minor provider change');
        const oracle = changeset(root, 'status', '--output', '.release-gate-oracle.json');
        succeeded(oracle);
        const plan = JSON.parse(readFileSync(join(root, '.release-gate-oracle.json')));
        const releases = Object.fromEntries(
          plan.releases.map(({ name, type, newVersion }) => [name, { type, newVersion }]),
        );
        const intent = gate(root, 'changesets');
        const versions = gate(root, 'versions');
        recordInferredEvidence(root, relationship, oracle, intent, versions);
        assert.deepEqual(releases, {
          a:
            relationship === 'plain'
              ? { type: 'minor', newVersion: '0.9.0' }
              : { type: 'major', newVersion: '1.0.0' },
          b: { type: 'major', newVersion: '1.0.0' },
        });
        succeeded(intent);
        assert.equal(versions.status, 1);
        assert.match(versions.stderr, /Changesets next version for b:.*1\.0\.0/);
        if (relationship !== 'plain')
          assert.match(versions.stderr, /Changesets next version for a:.*1\.0\.0/);
        assert.match(versions.stderr, policy);
      },
      { version: '0.8.0', bump: null, packageName: 'a' },
    ));
}

/** Ordinary dependencies use a patch for an out-of-range update under the default config. */
test('G2 accepts the actual CLI ordinary-dependent 0.x control', () =>
  fixture(
    (root) => {
      mkdirSync(join(root, 'packages/b'));
      writeFileSync(
        join(root, 'packages/b/package.json'),
        JSON.stringify({
          name: 'b',
          version: '0.3.0',
          dependencies: { a: '^0.8.0' },
        }),
      );
      commit(root, 'Two-package baseline');
      succeeded(git(root, 'checkout', '-b', 'feature'));
      writeFileSync(join(root, '.changeset/change.md'), '---\n"a": minor\n---\n\nChange.\n');
      commit(root, 'Minor provider change');
      const oracle = changeset(root, 'status', '--output', '.release-gate-oracle.json');
      succeeded(oracle);
      const intent = gate(root, 'changesets');
      const versions = gate(root, 'versions');
      recordInferredEvidence(root, 'safe-ordinary-dependent', oracle, intent, versions);
      const plan = JSON.parse(readFileSync(join(root, '.release-gate-oracle.json')));
      assert.deepEqual(
        Object.fromEntries(
          plan.releases.map(({ name, type, newVersion }) => [name, { type, newVersion }]),
        ),
        {
          a: { type: 'minor', newVersion: '0.9.0' },
          b: { type: 'patch', newVersion: '0.3.1' },
        },
      );
      succeeded(intent);
      succeeded(versions);
    },
    { version: '0.8.0', bump: null, packageName: 'a' },
  ));

test('G2 accepts an actual Version Packages commit after its changeset is consumed', () =>
  fixture(
    (root) => {
      minorFeature(root);
      succeeded(git(root, 'checkout', '-b', 'version-packages'));
      succeeded(changeset(root, 'version'));
      commit(root, 'Version Packages');
      assert.equal(
        JSON.parse(readFileSync(join(root, 'packages/example/package.json'))).version,
        '0.11.0',
      );
      assert.equal(existsSync(join(root, '.changeset/minor.md')), false);
      const eligibility = changeset(root, 'status');
      assert.equal(eligibility.status, 1);
      assert.match(eligibility.stderr, /changed but no changesets were found/);
      assert.deepEqual(plannedVersions(root), {});
      succeeded(gate(root, 'changesets'));
      succeeded(gate(root, 'versions'));
    },
    { bump: null },
  ));

for (const disconnected of [false, true]) {
  test(`G2 accepts a detached shallow PR with ${disconnected ? 'disconnected' : 'no'} main`, () =>
    fixture(
      (source) => {
        minorFeature(source);
        const root = join(source, '.release-gate-shallow');
        succeeded(
          git(
            source,
            'clone',
            '--depth',
            '1',
            '--single-branch',
            '--branch',
            'feature',
            pathToFileURL(source).href,
            root,
          ),
        );
        succeeded(git(root, 'checkout', '--detach'));
        assert.equal(succeeded(git(root, 'rev-parse', '--show-toplevel')), root);
        assert.equal(succeeded(git(root, 'rev-parse', '--is-shallow-repository')), 'true');
        if (disconnected) {
          succeeded(git(root, 'fetch', '--depth', '1', 'origin', 'main:refs/heads/main'));
          succeeded(git(root, 'rev-parse', '--verify', 'refs/heads/main'));
          assert.equal(git(root, 'merge-base', 'HEAD', 'main').status, 1);
        } else
          assert.equal(git(root, 'show-ref', '--verify', '--quiet', 'refs/heads/main').status, 1);
        const eligibility = changeset(root, 'status');
        assert.equal(eligibility.status, 1);
        assert.match(eligibility.stderr, /Failed to find where HEAD diverged/);
        assert.deepEqual(plannedVersions(root), { example: '0.11.0' });
        succeeded(gate(root, 'changesets'));
        succeeded(gate(root, 'versions'));
      },
      { bump: null },
    ));
}

test('G2 accepts a shallow PR whose main baseline is connected', () =>
  fixture(
    (source) => {
      const root = join(source, '.release-gate-shallow');
      succeeded(
        git(
          source,
          'clone',
          '--depth',
          '1',
          '--single-branch',
          '--branch',
          'main',
          pathToFileURL(source).href,
          root,
        ),
      );
      minorFeature(root);
      assert.equal(succeeded(git(root, 'rev-parse', '--is-shallow-repository')), 'true');
      assert.equal(
        succeeded(git(root, 'merge-base', 'HEAD', 'main')),
        succeeded(git(root, 'rev-parse', 'main')),
      );
      succeeded(changeset(root, 'status'));
      succeeded(gate(root, 'versions'));
    },
    { bump: null },
  ));

test('G2 accepts an unchanged 0.x workspace without pending changesets', () =>
  fixture((root) => succeeded(gate(root, 'versions')), { bump: null }));

test('G2 accepts an actual CLI empty changeset for a changed package', () =>
  fixture(
    (root) => {
      succeeded(git(root, 'checkout', '-b', 'tooling'));
      writeFileSync(join(root, 'packages/example/index.js'), '// No published behavior change.\n');
      succeeded(changeset(root, 'add', '--empty'));
      commit(root, 'Tooling change with empty changeset');
      succeeded(changeset(root, 'status'));
      succeeded(gate(root, 'changesets'));
      succeeded(gate(root, 'versions'));
    },
    { bump: null },
  ));

/** Coupled packages exercise Changesets' real dependency, fixed, and linked release calculations. */
for (const relationship of ['dependency', 'fixed', 'linked']) {
  test(`G2 preserves a safe 0.x ${relationship} plan`, () =>
    fixture(
      (root) => {
        mkdirSync(join(root, 'packages/companion'));
        writeFileSync(
          join(root, 'packages/companion/package.json'),
          JSON.stringify({
            name: 'companion',
            version: '0.10.0',
            ...(relationship === 'dependency' ? { dependencies: { example: '~0.10.0' } } : {}),
          }),
        );
        const configPath = join(root, '.changeset/config.json');
        const config = JSON.parse(readFileSync(configPath));
        if (relationship !== 'dependency') config[relationship] = [['example', 'companion']];
        writeFileSync(configPath, JSON.stringify(config));
        writeFileSync(join(root, '.changeset/minor.md'), '---\n"example": minor\n---\n\nChange.\n');
        // Linked groups align packages already being released; they do not release untouched members.
        if (relationship === 'linked')
          writeFileSync(
            join(root, '.changeset/companion.md'),
            '---\n"companion": patch\n---\n\nChange.\n',
          );
        assert.deepEqual(plannedVersions(root), {
          example: '0.11.0',
          companion: relationship === 'dependency' ? '0.10.1' : '0.11.0',
        });
        succeeded(gate(root, 'versions'));
      },
      { bump: null },
    ));
}

test('G2 rejects a projected stable-series prerelease', () =>
  fixture(
    (root) => {
      writeFileSync(
        join(root, '.changeset/pre.json'),
        JSON.stringify({
          mode: 'pre',
          tag: 'rc',
          initialVersions: { example: '0.10.0' },
          changesets: [],
        }),
      );
      const result = gate(root, 'versions');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /1\.0\.0-rc\.0/);
      assert.match(result.stderr, policy);
    },
    { bump: 'major' },
  ));

for (const failure of ['configuration', 'planning']) {
  test(`G2 fails closed on a real Changesets ${failure} error`, () =>
    fixture((root) => {
      if (failure === 'configuration') {
        const configPath = join(root, '.changeset/config.json');
        const config = JSON.parse(readFileSync(configPath));
        config.fixed = [['missing-package']];
        writeFileSync(configPath, JSON.stringify(config));
      } else
        writeFileSync(
          join(root, '.changeset/change.md'),
          '---\n"missing-package": minor\n---\n\nChange.\n',
        );
      const result = gate(root, 'versions');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /missing-package/);
      assert.match(result.stderr, policy);
    }));
}

for (const mode of ['changesets', 'versions']) {
  test(`0.x with a minor changeset passes ${mode}`, () =>
    fixture((root) => {
      const result = gate(root, mode);
      assert.equal(result.status, 0, result.stderr);
    }));
}

test('major changeset fails G1 with owner policy', () =>
  fixture(
    (root) => {
      const result = gate(root, 'changesets');
      assert.equal(result.status, 1);
      assert.match(result.stderr, policy);
    },
    { bump: 'major' },
  ));

test('nested changeset for any package fails G1', () =>
  fixture((root) => {
    mkdirSync(join(root, '.changeset/nested'));
    writeFileSync(
      join(root, '.changeset/nested/change.md'),
      "---\n'other': 'major' # owner decision required\n---\n\nChange.\n",
    );
    const result = gate(root, 'changesets');
    assert.equal(result.status, 1);
    assert.match(result.stderr, policy);
  }));

for (const version of ['1.0.0', '2.3.4', '1.0.0-rc.1']) {
  test(`G2 rejects manifest ${version}`, () =>
    fixture(
      (root) => {
        const result = gate(root, 'versions');
        assert.equal(result.status, 1);
        assert.match(result.stderr, policy);
      },
      { version, bump: null },
    ));
}

test('G2 rejects the actual Changesets next version before manifests are bumped', () =>
  fixture(
    (root) => {
      const result = gate(root, 'versions');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /1\.0\.0/);
      assert.match(result.stderr, policy);
      assert.equal(
        JSON.parse(readFileSync(join(root, 'packages/example/package.json'))).version,
        '0.10.0',
      );
    },
    { bump: 'major' },
  ));

test('G2 discovers publishable manifests outside workspace package globs', () =>
  fixture((root) => {
    mkdirSync(join(root, 'extra'));
    writeFileSync(join(root, 'extra/package.json'), '{"name":"extra","version":"1.0.0"}');
    const result = gate(root, 'versions');
    assert.equal(result.status, 1);
    assert.match(result.stderr, policy);
  }));

test('private manifests are not publishable', () =>
  fixture(
    (root) => {
      const result = gate(root, 'versions');
      assert.equal(result.status, 0, result.stderr);
    },
    { version: '2.0.0', bump: null, privatePackage: true },
  ));

test('malformed versions fail closed', () =>
  fixture(
    (root) => {
      const result = gate(root, 'versions');
      assert.equal(result.status, 1);
      assert.match(result.stderr, policy);
    },
    { version: 'invalid', bump: null },
  ));

test('gate arguments cannot bypass policy', () =>
  fixture((root) => {
    const result = spawnSync(process.execPath, [script, 'versions', '--override'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, policy);
  }));

/** The policy must guard every automated path that can create release versions or tags. */
test('CI and release enforce both gates before publication', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  assert.match(scripts['check:release'], /check:release:changesets.*&&.*check:release:versions/);
  assert.match(scripts.release, /check:release && changeset publish$/);
  assert.match(scripts['version-packages'], /check:release && changeset version$/);
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /push:\s+branches: \[main\]/);
  assert.match(ci, /pull_request:/);
  assert.match(ci, /pnpm run check:release && pnpm run test:release-gate/);
  const release = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.ok(
    release.indexOf('run: pnpm run check:release') < release.indexOf('uses: changesets/action'),
  );
  assert.match(release, /version: pnpm version-packages/);
  assert.match(release, /publish: pnpm release/);
});
