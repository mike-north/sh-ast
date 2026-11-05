/**
 * Offline provenance gate for the mvdan/sh release and maintained corrections. The
 * checked-in module must reverse exactly to the inventoried upstream release;
 * build routing must make the parser and schema generator consume that module.
 * This command neither downloads nor modifies dependency source in the checkout.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Exact bytes, including comments and license text, are part of provenance. */
function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Reject added files of any kind, including platform-specific build sources. */
function inventory(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return inventory(join(directory, entry.name), path);
      if (!entry.isFile()) throw new Error(`Unexpected non-file in inventory: ${path}`);
      return [path];
    })
    .sort();
}

/** Validates one repository root; exported so tests can probe isolated mutations. */
export function verifyBackport(root) {
  const directory = join(root, 'third_party/mvdan-sh');
  const source = join(directory, 'upstream');
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (
    manifest.module !== 'mvdan.cc/sh/v3' ||
    manifest.version !== 'v3.14.1' ||
    manifest.releaseCommit !== 'a3f0c75d21d918756fa38de8b5d3429efde7948b' ||
    manifest.sentinelUpstreamCommit !== 'dccf23ff9b34b866c92fa3c6c66e0cd00f4ad159' ||
    manifest.nestingUpstreamCommit !== '0e0eb36bb6dd6a143842ffda25738e9a82dc915e'
  ) {
    throw new Error('Unexpected upstream backport identity');
  }
  // Each correction applies to the source produced by the preceding patches.
  // Reverse the entire declared chain before comparing pristine release bytes.
  const appliedPatches = [
    'comment-iteration.patch',
    'nesting-backport.patch',
    'binding-budget.patch',
    'subshell-heredoc.patch',
    'printer-control-bytes.patch',
    'heredoc-continuation.patch',
    'printer-backslash-compat.patch',
    'printer-zsh-prefix-order.patch',
    'zsh-subscript-pattern.patch',
  ];
  if (JSON.stringify(manifest.appliedPatches) !== JSON.stringify(appliedPatches)) {
    throw new Error('Unexpected maintained patch order');
  }
  for (const patch of appliedPatches) {
    if (typeof manifest.patches[patch] !== 'string') {
      throw new Error(`Missing patch digest: ${patch}`);
    }
  }
  for (const [patch, expected] of Object.entries(manifest.patches)) {
    if (digest(join(directory, patch)) !== expected)
      throw new Error(`Invalid patch digest: ${patch}`);
  }
  const expectedFiles = Object.keys(manifest.pristineFiles).sort();
  if (JSON.stringify(inventory(source)) !== JSON.stringify(expectedFiles))
    throw new Error('Upstream source inventory differs');
  for (const [path, replacement] of [
    ['packages/sh-ast/shim/go.mod', '../../../third_party/mvdan-sh/upstream'],
    ['tools/gen-visitor-keys/go.mod', '../../third_party/mvdan-sh/upstream'],
  ]) {
    const text = readFileSync(join(root, path), 'utf8');
    if (
      !/^\s*(?:require\s+)?mvdan\.cc\/sh\/v3 v3\.14\.1(?:\s|$)/m.test(text) ||
      !text.split('\n').includes(`replace mvdan.cc/sh/v3 => ${replacement}`)
    ) {
      throw new Error(`Incorrect pinned replacement in ${path}`);
    }
  }
  const temporary = mkdtempSync(join(tmpdir(), 'sh-ast-backport-'));
  try {
    cpSync(source, temporary, { recursive: true });
    // Apply outside any repository so a parent's working-directory prefix cannot
    // silently filter patch paths. Reverse reconstruction never touches checkout files.
    for (const patch of appliedPatches.toReversed()) {
      execFileSync('git', ['apply', '--reverse', join(directory, patch)], {
        cwd: temporary,
        stdio: 'pipe',
        env: { ...process.env, GIT_DIR: join(temporary, '.absent-git') },
      });
    }
    for (const [path, expected] of Object.entries(manifest.pristineFiles)) {
      if (digest(join(temporary, path)) !== expected)
        throw new Error(`Invalid pristine source: ${path}`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyBackport(fileURLToPath(new URL('../', import.meta.url)));
  console.log(
    'Verified mvdan/sh v3.14.1 (including Unicode) with comment iteration, native budget, subshell heredoc, printer literal-byte, heredoc continuation, split-literal compatibility, Zsh prefix-order, and Zsh subscript-pattern corrections.',
  );
}
