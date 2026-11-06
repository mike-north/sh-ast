/** Documentation checks compare independent committed and freshly generated trees. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { compareApiDocs } from './api-docs.mjs';

test('documentation drift includes changed, missing, and obsolete pages', () => {
  const root = mkdtempSync(join(import.meta.dirname, '.docs-test-'));
  const committed = join(root, 'committed');
  const generated = join(root, 'generated');
  try {
    mkdirSync(committed);
    mkdirSync(generated);
    writeFileSync(join(committed, 'same.md'), 'stable');
    writeFileSync(join(generated, 'same.md'), 'stable');
    mkdirSync(join(committed, 'nested'));
    mkdirSync(join(generated, 'nested'));
    writeFileSync(join(committed, 'nested', 'same.md'), 'stable nested page');
    writeFileSync(join(generated, 'nested', 'same.md'), 'stable nested page');
    assert.deepEqual(compareApiDocs(committed, generated), []);
    writeFileSync(join(committed, 'changed.md'), 'previous');
    writeFileSync(join(generated, 'changed.md'), 'current');
    writeFileSync(join(committed, 'obsolete.md'), 'removed API');
    writeFileSync(join(generated, 'missing.md'), 'added API');
    assert.deepEqual(compareApiDocs(committed, generated), [
      'changed.md',
      'missing.md',
      'obsolete.md',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
