/** Regenerates the API reference in isolation so checks never rewrite committed documentation. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { compareApiDocs } from './api-docs.mjs';

const require = createRequire(import.meta.url);
// Keep scratch output inside this worktree; the generated API model is prepared by Nx.
const output = mkdtempSync(join(import.meta.dirname, '.api-docs-'));
try {
  const documenter = require.resolve('@microsoft/api-documenter/lib/start');
  execFileSync(
    process.execPath,
    [documenter, 'markdown', '-i', resolve('api-docs-temp'), '-o', output],
    { stdio: 'inherit' },
  );
  const differences = compareApiDocs(resolve('docs'), output);
  if (differences.length > 0) {
    console.error(
      `API documentation is stale: ${differences.join(', ')}\nRun pnpm build:docs and commit the result.`,
    );
    process.exitCode = 1;
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
