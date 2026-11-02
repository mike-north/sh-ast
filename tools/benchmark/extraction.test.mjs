/** Adversarial archives pin extraction boundaries; the fixture encoder is test-only USTAR data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { extractPackage } from './artifacts.mjs';

/** Header names deliberately preserve traversal text that ordinary tar creation would normalize. */
function archive(entries) {
  const chunks = [];
  for (const [name, content] of entries) {
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    const octal = (offset, width, value) =>
      header.write(value.toString(8).padStart(width - 1, '0') + '\0', offset, width, 'ascii');
    header.write(name, 0, 100);
    octal(100, 8, 0o777);
    octal(108, 8, 1234);
    octal(116, 8, 1234);
    octal(124, 12, body.length);
    octal(136, 12, 0);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    chunks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
/** Each case receives an empty artifact directory and an independent archive outside its extraction root. */
function sandbox(entries, run) {
  const directory = mkdtempSync(join(tmpdir(), 'sh-ast-extraction-test-'));
  try {
    const tarball = join(directory, 'input.tgz');
    writeFileSync(tarball, archive(entries));
    const output = join(directory, 'artifact');
    mkdirSync(output);
    run({ tarball, output, packageRoot: join(output, 'package') });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('a top-level sibling in an archive is never extracted alongside the package', () => {
  sandbox(
    [
      ['package/package.json', '{}'],
      ['outside.txt', 'unexpected'],
    ],
    ({ tarball, output, packageRoot }) => {
      try {
        extractPackage(tarball, packageRoot);
      } catch {
        /* Rejection is acceptable; the boundary is mandatory. */
      }
      assert.equal(existsSync(join(output, 'outside.txt')), false);
    },
  );
});
test('package traversal is rejected and an existing outside file stays unchanged', () => {
  sandbox(
    [
      ['package/package.json', '{}'],
      ['package/../outside.txt', 'overwritten'],
    ],
    ({ tarball, output, packageRoot }) => {
      const outside = join(output, 'outside.txt');
      writeFileSync(outside, 'original');
      assert.throws(() => extractPackage(tarball, packageRoot));
      assert.equal(readFileSync(outside, 'utf8'), 'original');
    },
  );
});
test('npm layout without a directory header is stripped into a fresh package root using local ownership and umask', () => {
  sandbox(
    [
      ['package/package.json', '{}'],
      ['package/dist/index.js', 'export {};'],
    ],
    ({ tarball, packageRoot }) => {
      const oldMask = process.umask(0o022);
      try {
        extractPackage(tarball, packageRoot);
      } finally {
        process.umask(oldMask);
      }
      assert.equal(readFileSync(join(packageRoot, 'dist/index.js'), 'utf8'), 'export {};');
      assert.equal(existsSync(join(packageRoot, 'package')), false);
      const file = statSync(join(packageRoot, 'dist/index.js'));
      assert.equal(file.mode & 0o777, 0o755);
      assert.equal(file.uid, process.getuid());
      assert.throws(() => extractPackage(tarball, packageRoot));
    },
  );
});
