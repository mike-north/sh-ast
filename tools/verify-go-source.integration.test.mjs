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

test('rejects altered cached fork source even when pin, origin and zip remain unchanged', () => {
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
  try {
    const checker = join(directory, 'verify-module-source');
    execFileSync(goBinary, ['build', '-o', checker, './verify-source'], {
      cwd: join(repository, 'tools/gen-visitor-keys'),
      env,
    });
    const cache = join(directory, 'cache');
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
