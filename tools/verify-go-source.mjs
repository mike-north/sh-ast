/**
 * Verifies the actual Go source selected by both syntax consumers. Release labels
 * alone cannot identify a fork: the immutable pseudo-version, full Git revision,
 * and Go content checksum must agree before schema generation or WASM builds.
 * The original requirement label must agree across both module graphs as well;
 * that label does not establish the consumed fork's Git ancestry.
 * Go downloads use its normal checksum verification; no semantic patches are
 * applied by this binding repository.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Checks an isolated repository root; the runner seam lets tests model effective
 * module graph drift independently of the declarations that are being checked.
 * GOWORK and caller GOFLAGS cannot redirect a supposedly reproducible build.
 */
export function verifyGoSource(root, run = execFileSync) {
  const identity = JSON.parse(readFileSync(join(root, 'tools/go-source.json'), 'utf8'));
  if (
    identity.module !== 'mvdan.cc/sh/v3' ||
    identity.fork !== 'github.com/mike-north/sh/v3' ||
    !/^v3\.\d+\.\d+(?:-0)?\.\d{14}-[a-f0-9]{12}$/.test(identity.version) ||
    !/^[a-f0-9]{40}$/.test(identity.revision) ||
    !identity.version.endsWith(`-${identity.revision.slice(0, 12)}`)
  ) {
    throw new Error('Expected an immutable fork identity with a full Git revision');
  }
  // upstream.version records the required original module label. Only the fork
  // pin, origin and content checks below identify consumed bytes. An ancestry
  // revision belongs in the historical audit, not in unverified machine metadata.
  if (
    identity.upstream === null ||
    typeof identity.upstream !== 'object' ||
    Array.isArray(identity.upstream) ||
    Object.keys(identity.upstream).length !== 1 ||
    typeof identity.upstream.version !== 'string' ||
    !/^v3\.\d+\.\d+$/.test(identity.upstream.version)
  ) {
    throw new Error('Expected only a tagged original requirement version in upstream metadata');
  }
  const env = { ...process.env, GOWORK: 'off', GOFLAGS: '-mod=readonly' };
  const modules = ['packages/sh-ast/shim', 'tools/gen-visitor-keys'].map((directory) => {
    const module = JSON.parse(
      run('go', ['list', '-m', '-json', identity.module], {
        cwd: join(root, directory),
        env,
        encoding: 'utf8',
      }),
    );
    if (
      module.Path !== identity.module ||
      module.Version !== identity.upstream.version ||
      module.Replace?.Path !== identity.fork ||
      module.Replace?.Version !== identity.version ||
      typeof module.Replace?.Sum !== 'string' ||
      !module.Replace.Sum.startsWith('h1:')
    ) {
      throw new Error(`Incorrect effective source in ${directory}`);
    }
    return module;
  });
  const downloaded = JSON.parse(
    run('go', ['mod', 'download', '-json', `${identity.fork}@${identity.version}`], {
      cwd: join(root, 'packages/sh-ast/shim'),
      env,
      encoding: 'utf8',
    }),
  );
  if (
    downloaded.Error ||
    downloaded.Path !== identity.fork ||
    downloaded.Version !== identity.version ||
    typeof downloaded.Dir !== 'string' ||
    typeof downloaded.Zip !== 'string' ||
    modules.some((module) => module.Replace.Sum !== downloaded.Sum)
  ) {
    throw new Error('The downloaded source differs from the selected Go modules');
  }
  if (
    downloaded.Origin?.VCS !== 'git' ||
    downloaded.Origin?.URL !== 'https://github.com/mike-north/sh' ||
    downloaded.Origin?.Hash !== identity.revision
  ) {
    throw new Error('The downloaded source has a different Git revision');
  }
  // The remote replacement has a different cache path from the original
  // requirement. Go's ordinary graph verifier misses that source directory;
  // use Go's checksum algorithm for its exact archive and expanded source.
  run(
    'go',
    [
      'run',
      './verify-source',
      '-dir',
      downloaded.Dir,
      '-zip',
      downloaded.Zip,
      '-module',
      identity.fork,
      '-version',
      identity.version,
      '-sum',
      downloaded.Sum,
    ],
    { cwd: join(root, 'tools/gen-visitor-keys'), env, encoding: 'utf8' },
  );
  // Verify the remaining module graph as well; all failures propagate to CI.
  for (const directory of ['packages/sh-ast/shim', 'tools/gen-visitor-keys']) {
    run('go', ['mod', 'verify'], { cwd: join(root, directory), env, encoding: 'utf8' });
  }
  return identity;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const identity = verifyGoSource(fileURLToPath(new URL('../', import.meta.url)));
  console.log(
    `Verified ${identity.fork}@${identity.version} (${identity.revision}) for schema and WASM`,
  );
}
