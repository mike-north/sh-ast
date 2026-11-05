/**
 * The vendored parser is accepted only when its reviewed upstream inventory and
 * patch reconstruct the pristine release. Mutations model accidental drift in
 * source, provenance, and build routing rather than reimplementing verification.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyBackport } from './verify-mvdan-backport.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Copies only verification inputs so destructive probes cannot touch the checkout. */
function fixture(action) {
  const directory = mkdtempSync(join(tmpdir(), 'sh-ast-backport-test-'));
  try {
    for (const path of [
      'third_party/mvdan-sh',
      'packages/sh-ast/shim/go.mod',
      'tools/gen-visitor-keys/go.mod',
    ]) {
      cpSync(join(root, path), join(directory, path), { recursive: true });
    }
    action(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('accepts precisely the reviewed source closure and patch', () => {
  const manifest = JSON.parse(
    readFileSync(join(root, 'third_party/mvdan-sh/manifest.json'), 'utf8'),
  );
  assert.deepEqual(manifest.appliedPatches, [
    'comment-iteration.patch',
    'nesting-backport.patch',
    'binding-budget.patch',
    'subshell-heredoc.patch',
    'printer-control-bytes.patch',
    'heredoc-continuation.patch',
    'printer-backslash-compat.patch',
  ]);
  assert.doesNotThrow(() => verifyBackport(root));
});

test('rejects arithmetic parser drift outside the declared nesting corrections', () => {
  fixture((directory) => {
    const path = join(directory, 'third_party/mvdan-sh/upstream/syntax/parser_arithm.go');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n// unreviewed arithmetic change\n`);
    assert.throws(() => verifyBackport(directory), /pristine.*syntax\/parser_arithm.go/);
  });
});

for (const name of [
  'nesting-backport.patch',
  'binding-budget.patch',
  'subshell-heredoc.patch',
  'printer-control-bytes.patch',
  'heredoc-continuation.patch',
  'printer-backslash-compat.patch',
]) {
  test(`requires the ${name} digest`, () => {
    fixture((directory) => {
      const path = join(directory, 'third_party/mvdan-sh/manifest.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      delete manifest.patches[name];
      writeFileSync(path, JSON.stringify(manifest));
      assert.throws(() => verifyBackport(directory), /patch digest/);
    });
  });
  test(`rejects changed ${name} bytes`, () => {
    fixture((directory) => {
      writeFileSync(join(directory, 'third_party/mvdan-sh', name), 'unreviewed patch\n');
      assert.throws(() => verifyBackport(directory), /patch digest/);
    });
  });
}

test('rejects interchanging the official nesting patch and owned binding adaptation', () => {
  fixture((directory) => {
    const path = join(directory, 'third_party/mvdan-sh/manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.appliedPatches = [
      'comment-iteration.patch',
      'binding-budget.patch',
      'nesting-backport.patch',
    ];
    writeFileSync(path, JSON.stringify(manifest));
    assert.throws(() => verifyBackport(directory), /patch order/);
  });
});

test('rejects a source edit outside the official backport', () => {
  fixture((directory) => {
    const path = join(directory, 'third_party/mvdan-sh/upstream/syntax/parser.go');
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('package syntax', '// unreviewed change\npackage syntax'),
    );
    assert.throws(() => verifyBackport(directory), /pristine.*syntax\/parser.go/);
  });
});

test('rejects printer drift outside the declared literal-byte correction', () => {
  fixture((directory) => {
    const path = join(directory, 'third_party/mvdan-sh/upstream/syntax/printer.go');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n// unreviewed printer change\n`);
    assert.throws(() => verifyBackport(directory), /pristine.*syntax\/printer.go/);
  });
});

test('rejects an extra Go source file that could change the build', () => {
  fixture((directory) => {
    writeFileSync(
      join(directory, 'third_party/mvdan-sh/upstream/syntax/extra.go'),
      'package syntax\n',
    );
    assert.throws(() => verifyBackport(directory), /inventory/);
  });
});

test('rejects missing upstream license provenance', () => {
  fixture((directory) => {
    rmSync(join(directory, 'third_party/mvdan-sh/upstream/LICENSE'));
    assert.throws(() => verifyBackport(directory), /inventory/);
  });
});

test('rejects a changed patch before attempting to apply it', () => {
  fixture((directory) => {
    const path = join(directory, 'third_party/mvdan-sh/comment-iteration.patch');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n`);
    assert.throws(() => verifyBackport(directory), /patch digest/);
  });
});

test('rejects generator routing away from the parser source used by WASM', () => {
  fixture((directory) => {
    const path = join(directory, 'tools/gen-visitor-keys/go.mod');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/replace mvdan.cc\/sh\/v3[^\n]+\n/, ''));
    assert.throws(() => verifyBackport(directory), /replacement/);
  });
});

test('rejects removing the maintained comment correction from patch order', () => {
  fixture((directory) => {
    const path = join(directory, 'third_party/mvdan-sh/manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.appliedPatches = ['sentinel-backport.patch'];
    writeFileSync(path, JSON.stringify(manifest));
    assert.throws(() => verifyBackport(directory), /patch order/);
  });
});

test('rejects changed maintained comment-iteration patch bytes', () => {
  fixture((directory) => {
    writeFileSync(
      join(directory, 'third_party/mvdan-sh/comment-iteration.patch'),
      'unreviewed maintained patch\n',
    );
    assert.throws(() => verifyBackport(directory), /patch digest/);
  });
});

test('requires a digest for every applied maintenance patch', () => {
  fixture((directory) => {
    const path = join(directory, 'third_party/mvdan-sh/manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    delete manifest.patches['comment-iteration.patch'];
    writeFileSync(path, JSON.stringify(manifest));
    assert.throws(() => verifyBackport(directory), /patch digest/);
  });
});
