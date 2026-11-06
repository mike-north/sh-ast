/** Release policy fixtures encode the owner's boundary independently of package behavior. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve('tools/release-gate.mjs');
const policy =
  /stays in the 0\.x series until the owner declares the shape stable.*no override flag/is;

/** Each fixture is a real Changesets workspace; generated reports stay inside this worktree. */
function fixture(action, { version = '0.10.0', bump = 'minor', privatePackage = false } = {}) {
  mkdirSync(resolve('scratch'), { recursive: true });
  const root = mkdtempSync(resolve('scratch/release-gate-'));
  try {
    mkdirSync(join(root, '.changeset'));
    mkdirSync(join(root, 'packages/example'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['packages/*'] }),
    );
    writeFileSync(
      join(root, 'packages/example/package.json'),
      JSON.stringify({ name: 'example', version, private: privatePackage }),
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
        `---\n"example": ${bump}\n---\n\nChange.\n`,
      );
    action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function gate(root, mode) {
  return spawnSync(process.execPath, [script, mode], { cwd: root, encoding: 'utf8' });
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
