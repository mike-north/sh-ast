/**
 * The binding and schema must consume one immutable, published fork revision.
 * Synthetic Go responses exercise refusal boundaries without trusting the local
 * checkout or requiring a network dependency for every tamper probe.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyGoSource } from './verify-go-source.mjs';

const revision = '0123456789abcdef0123456789abcdef01234567';
const version = 'v3.14.2-0.20261105000000-0123456789ab';
const identity = {
  module: 'mvdan.cc/sh/v3',
  fork: 'github.com/mike-north/sh/v3',
  version,
  revision,
  sum: 'h1:dm2hfQDs8359vB9QziwgnoY/Nsp02ut9jUY0HibSPBc=',
  goModSum: 'h1:syYCoFET8w9tvevxiXUtY8/ICrU+l26jHmhJDra3Vwo=',
  upstream: { version: 'v3.14.1' },
};

/** Isolated manifests and effective module metadata never rewrite real build inputs. */
function fixture(action, change = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'sh-ast-go-source-'));
  try {
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools/go-source.json'), JSON.stringify(identity));
    const modules = ['packages/sh-ast/shim', 'tools/gen-visitor-keys'].map((directory) => ({
      directory,
      Path: identity.module,
      Version: 'v3.14.1',
      Replace: {
        Path: identity.fork,
        Version: version,
        Sum: identity.sum,
        GoModSum: identity.goModSum,
      },
    }));
    const download = {
      Path: identity.fork,
      Version: version,
      Sum: identity.sum,
      GoModSum: identity.goModSum,
      GoMod: '/module-cache/fork.mod',
      Dir: '/module-cache/fork-source',
      Zip: '/module-cache/fork.zip',
      Origin: { VCS: 'git', URL: 'https://github.com/mike-north/sh', Hash: revision },
    };
    change({ root, modules, download });
    const calls = [];
    const run = (command, args, options) => {
      assert.equal(command, 'go');
      assert.equal(options.env.GOWORK, 'off');
      assert.equal(options.env.GOFLAGS, '-mod=readonly');
      calls.push({ args, cwd: options.cwd });
      if (args[0] === 'mod' && args[1] === 'verify') return '';
      if (args[0] === 'run') return '';
      if (args[0] === 'list') {
        assert.deepEqual(args, ['list', '-m', '-json', identity.module]);
        return JSON.stringify(modules.find((m) => options.cwd === join(root, m.directory)));
      }
      assert.deepEqual(args, ['mod', 'download', '-json', `${identity.fork}@${version}`]);
      return JSON.stringify(download);
    };
    action(root, run, calls);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('checks both Go consumers and the downloaded full Git revision', () => {
  fixture((root, run, calls) => {
    assert.deepEqual(verifyGoSource(root, run), identity);
    assert.deepEqual(
      calls.filter((c) => c.args[0] === 'list').map((c) => c.cwd),
      [join(root, 'packages/sh-ast/shim'), join(root, 'tools/gen-visitor-keys')],
    );
    assert.ok(calls.some((c) => c.args[1] === 'download'));
    assert.ok(calls.some((c) => c.args[0] === 'run' && c.args[1] === './verify-source'));
    const sourceCheck = calls.find((c) => c.args[0] === 'run');
    assert.equal(sourceCheck.args[sourceCheck.args.indexOf('-sum') + 1], identity.sum);
    assert.equal(sourceCheck.args[sourceCheck.args.indexOf('-go-mod-sum') + 1], identity.goModSum);
    assert.equal(
      sourceCheck.args[sourceCheck.args.indexOf('-go-mod') + 1],
      '/module-cache/fork.mod',
    );
    assert.deepEqual(
      calls.filter((c) => c.args[1] === 'verify').map((c) => c.cwd),
      [join(root, 'packages/sh-ast/shim'), join(root, 'tools/gen-visitor-keys')],
    );
  });
});

for (const directory of ['packages/sh-ast/shim', 'tools/gen-visitor-keys']) {
  for (const field of ['Sum', 'GoModSum']) {
    test(`rejects ${directory} replacement ${field} drift from the repository pin`, () => {
      fixture(
        (root, run) => assert.throws(() => verifyGoSource(root, run), /effective source/),
        ({ modules }) => {
          modules.find((m) => m.directory === directory).Replace[field] = `h1:${'A'.repeat(43)}=`;
        },
      );
    });
  }
  test(`rejects ${directory} original requirement drift despite the same replacement`, () => {
    fixture(
      (root, run) => assert.throws(() => verifyGoSource(root, run), /effective source/),
      ({ modules }) => {
        modules.find((m) => m.directory === directory).Version = 'v3.14.0';
      },
    );
  });

  for (const replacement of [
    { Path: '../../../third_party/mvdan-sh/upstream' },
    { Path: 'github.com/mvdan/sh/v3', Version: version },
    { Path: identity.fork, Version: 'v3.14.1' },
  ]) {
    test(`rejects ${directory} routed to ${JSON.stringify(replacement)}`, () => {
      fixture(
        (root, run) => assert.throws(() => verifyGoSource(root, run), /effective source/),
        ({ modules }) => {
          modules.find((m) => m.directory === directory).Replace = replacement;
        },
      );
    });
  }
}

for (const field of ['Sum', 'GoModSum']) {
  test(`rejects coherent false ${field} reports despite unchanged fork revision`, () => {
    fixture(
      (root, run) =>
        assert.throws(() => verifyGoSource(root, run), /effective source|downloaded source/),
      ({ modules, download }) => {
        const falseSum = `h1:${'A'.repeat(43)}=`;
        for (const module of modules) module.Replace[field] = falseSum;
        download[field] = falseSum;
      },
    );
  });
}

for (const field of ['sum', 'goModSum']) {
  for (const value of [
    undefined,
    null,
    'h1:unverified',
    `h2:${'A'.repeat(43)}=`,
    `h1:${'A'.repeat(42)}B=`,
  ]) {
    test(`rejects invalid pinned ${field}: ${JSON.stringify(value)}`, () => {
      fixture(
        (root, run) => assert.throws(() => verifyGoSource(root, run), /pinned Go checksums/),
        ({ root }) => {
          writeFileSync(
            join(root, 'tools/go-source.json'),
            JSON.stringify({ ...identity, [field]: value }),
          );
        },
      );
    });
  }
}

for (const upstream of [
  { version: 'v3.14.0' },
  { version: 'main' },
  {},
  { version: 'v3.14.1', revision: 'a3f0c75d21d918756fa38de8b5d3429efde7948b' },
]) {
  test(`rejects drift or unverified fields in the recorded original requirement: ${JSON.stringify(upstream)}`, () => {
    fixture(
      (root, run) =>
        assert.throws(() => verifyGoSource(root, run), /effective source|original requirement/),
      ({ root }) => {
        writeFileSync(
          join(root, 'tools/go-source.json'),
          JSON.stringify({ ...identity, upstream }),
        );
      },
    );
  });
}

test('rejects a different full commit even when its abbreviated suffix collides', () => {
  fixture(
    (root, run) => assert.throws(() => verifyGoSource(root, run), /Git revision/),
    ({ download }) => {
      download.Origin.Hash = `${revision.slice(0, 12)}ffffffffffffffffffffffffffff`;
    },
  );
});

test('rejects downloaded module identity or checksum disagreement', () => {
  fixture(
    (root, run) => assert.throws(() => verifyGoSource(root, run), /downloaded source/),
    ({ download }) => {
      download.Sum = 'h1:other-source';
    },
  );
});

for (const field of [
  { version: 'main' },
  { revision: revision.slice(0, 12) },
  { fork: '../local-fork' },
]) {
  test(`rejects a mutable or incomplete source declaration: ${JSON.stringify(field)}`, () => {
    fixture(
      (root, run) => assert.throws(() => verifyGoSource(root, run), /immutable fork identity/),
      ({ root }) => {
        writeFileSync(
          join(root, 'tools/go-source.json'),
          JSON.stringify({ ...identity, ...field }),
        );
      },
    );
  });
}

test('propagates an integrity failure despite matching module metadata', () => {
  fixture((root, run) => {
    const corruptCache = (command, args, options) => {
      if (args[0] === 'run') throw new Error('module cache directory has been modified');
      return run(command, args, options);
    };
    assert.throws(() => verifyGoSource(root, corruptCache), /has been modified/);
  });
});
