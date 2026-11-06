/**
 * Real Go-cache tamper proof, independent of mocked module metadata. Only a copied
 * cache is changed: the shared cache and published fork source remain untouched.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyGoSource } from './verify-go-source.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));

/** Copies cache entries without giving the test any write access to their originals. */
function copyEntry(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

test('rejects real original-requirement drift and altered cache despite the same fork pin', async (t) => {
  const identity = JSON.parse(readFileSync(join(repository, 'tools/go-source.json'), 'utf8'));
  const env = { ...process.env, GOWORK: 'off', GOFLAGS: '-mod=readonly' };
  const goRoot = execFileSync('go', ['env', 'GOROOT'], {
    cwd: join(repository, 'packages/sh-ast/shim'),
    env,
    encoding: 'utf8',
  }).trim();
  const goBinary = join(goRoot, 'bin/go');
  const originalCache = execFileSync('go', ['env', 'GOMODCACHE'], { env, encoding: 'utf8' }).trim();
  const downloaded = JSON.parse(
    execFileSync('go', ['mod', 'download', '-json', `${identity.fork}@${identity.version}`], {
      cwd: join(repository, 'packages/sh-ast/shim'),
      env,
      encoding: 'utf8',
    }),
  );
  const directory = mkdtempSync(join(tmpdir(), 'sh-ast-fork-cache-test-'));
  const cache = join(directory, 'cache');
  try {
    const checker = join(directory, 'verify-module-source');
    execFileSync(goBinary, ['build', '-o', checker, './verify-source'], {
      cwd: join(repository, 'tools/gen-visitor-keys'),
      env,
    });
    const repack = join(directory, 'repack-module');
    execFileSync(goBinary, ['build', '-o', repack, '../test-fixtures/repack-module.go'], {
      cwd: join(repository, 'tools/gen-visitor-keys'),
      env,
    });
    const root = join(directory, 'repository');
    copyEntry(join(repository, 'tools/go-source.json'), join(root, 'tools/go-source.json'));
    // The minimal graphs select precisely the fork being verified, avoiding any
    // dependence on unrelated module caches in this integrity outcome test.
    for (const consumer of ['packages/sh-ast/shim', 'tools/gen-visitor-keys']) {
      mkdirSync(join(root, consumer), { recursive: true });
      writeFileSync(
        join(root, consumer, 'go.mod'),
        `module cache-integrity-probe

go 1.26.10

require ${identity.module} v3.14.1

replace ${identity.module} => ${identity.fork} ${identity.version}
`,
      );
      copyEntry(join(repository, 'packages/sh-ast/shim/go.sum'), join(root, consumer, 'go.sum'));
    }
    copyEntry(downloaded.Dir, join(cache, relative(originalCache, downloaded.Dir)));
    const downloadDirectory = dirname(downloaded.Info);
    copyEntry(downloadDirectory, join(cache, relative(originalCache, downloadDirectory)));
    const run = (_command, args, options) =>
      execFileSync(
        args[0] === 'run' ? checker : goBinary,
        args[0] === 'run' ? args.slice(2) : args,
        {
          ...options,
          env: { ...options.env, GOMODCACHE: cache, GOPROXY: 'off', GOTOOLCHAIN: 'local' },
        },
      );
    assert.doesNotThrow(() => verifyGoSource(root, run));
    // A replacement keeps its exact source even when the original require label
    // changes. Both real module graphs must still agree with the recorded label.
    for (const consumer of ['packages/sh-ast/shim', 'tools/gen-visitor-keys']) {
      const manifest = join(root, consumer, 'go.mod');
      const baseline = readFileSync(manifest, 'utf8');
      await t.test(`refuses ${consumer} original-version drift`, () => {
        try {
          writeFileSync(
            manifest,
            baseline.replace('require mvdan.cc/sh/v3 v3.14.1', 'require mvdan.cc/sh/v3 v3.14.0'),
          );
          assert.throws(() => verifyGoSource(root, run), /Incorrect effective source/);
        } finally {
          writeFileSync(manifest, baseline);
        }
      });
    }
    const sourceIdentity = join(root, 'tools/go-source.json');
    await t.test('refuses recorded original-version drift', () => {
      try {
        writeFileSync(
          sourceIdentity,
          JSON.stringify({ ...identity, upstream: { version: 'v3.14.0' } }),
        );
        assert.throws(() => verifyGoSource(root, run), /Incorrect effective source/);
      } finally {
        writeFileSync(sourceIdentity, JSON.stringify(identity));
      }
    });
    // Hold the real baseline Go metadata fixed to isolate the file check from
    // Go's own earlier go.mod verification. The source checker must inspect the
    // actual cache file even when all surrounding reports still agree.
    const baselineModules = new Map(
      ['packages/sh-ast/shim', 'tools/gen-visitor-keys'].map((consumer) => [
        join(root, consumer),
        run('go', ['list', '-m', '-json', identity.module], {
          cwd: join(root, consumer),
          env,
          encoding: 'utf8',
        }),
      ]),
    );
    const baselineDownload = run(
      'go',
      ['mod', 'download', '-json', `${identity.fork}@${identity.version}`],
      {
        cwd: join(root, 'packages/sh-ast/shim'),
        env,
        encoding: 'utf8',
      },
    );
    await t.test('refuses altered cached go.mod bytes with unchanged checksum reports', () => {
      const manifest = join(cache, relative(originalCache, downloaded.GoMod));
      const baseline = readFileSync(manifest, 'utf8');
      try {
        chmodSync(manifest, 0o644);
        writeFileSync(manifest, `${baseline}\n// altered cached module metadata\n`);
        const heldReports = (command, args, options) => {
          if (args[0] === 'list') return baselineModules.get(options.cwd);
          if (args[0] === 'mod' && args[1] === 'download') return baselineDownload;
          if (args[0] === 'mod' && args[1] === 'verify') return '';
          return run(command, args, options);
        };
        assert.throws(
          () => verifyGoSource(root, heldReports),
          (error) => /go.mod has been modified/.test(String(error.stderr)),
        );
      } finally {
        writeFileSync(manifest, baseline);
      }
    });
    const parser = join(cache, relative(originalCache, downloaded.Dir), 'syntax/parser.go');
    chmodSync(parser, 0o644);
    writeFileSync(
      parser,
      `${readFileSync(parser, 'utf8')}
// altered cached parser source
`,
    );
    assert.throws(
      () => verifyGoSource(root, run),
      (error) => {
        assert.match(String(error.stderr), /expanded source has been modified/);
        return true;
      },
    );
    await t.test(
      'refuses coherent altered source, archive, cache sums and both consumer go.sum files',
      () => {
        const archive = join(cache, relative(originalCache, downloaded.Zip));
        const source = join(cache, relative(originalCache, downloaded.Dir));
        chmodSync(archive, 0o644);
        const alteredSum = execFileSync(
          repack,
          [source, archive, identity.fork, identity.version],
          {
            encoding: 'utf8',
          },
        ).trim();
        assert.notEqual(alteredSum, downloaded.Sum);
        writeFileSync(`${archive}hash`, alteredSum);
        for (const consumer of ['packages/sh-ast/shim', 'tools/gen-visitor-keys']) {
          const sums = join(root, consumer, 'go.sum');
          writeFileSync(sums, readFileSync(sums, 'utf8').replace(downloaded.Sum, alteredSum));
          const actual = JSON.parse(
            run('go', ['list', '-m', '-json', identity.module], {
              cwd: join(root, consumer),
              env,
              encoding: 'utf8',
            }),
          );
          assert.equal(actual.Replace.Sum, alteredSum);
        }
        const actual = JSON.parse(
          run('go', ['mod', 'download', '-json', `${identity.fork}@${identity.version}`], {
            cwd: join(root, 'packages/sh-ast/shim'),
            env,
            encoding: 'utf8',
          }),
        );
        assert.equal(actual.Sum, alteredSum);
        assert.equal(actual.Origin.Hash, identity.revision);
        // The prior consistency-only gate accepted this coherent altered source.
        assert.throws(() => verifyGoSource(root, run), /effective source|downloaded source/);
      },
    );
  } finally {
    // Go's expanded module directories are read-only on Linux. Its own cache
    // cleaner removes only this isolated copy without weakening the fixture or
    // changing permissions in the shared cache used by actual builds.
    execFileSync(goBinary, ['clean', '-modcache'], {
      env: { ...env, GOMODCACHE: cache, GOTOOLCHAIN: 'local' },
      stdio: 'pipe',
    });
    rmSync(directory, { recursive: true, force: true });
  }
});
