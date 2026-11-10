/**
 * Guards the published tarball's legal contents: the MIT license and the
 * BSD-3-Clause notices for the bundled mvdan/sh and Go code must ship with the
 * package, alongside the README npm renders.
 *
 * @see https://docs.npmjs.com/cli/commands/npm-pack
 * @see https://spdx.org/licenses/BSD-3-Clause.html
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = fileURLToPath(new URL('..', import.meta.url));

/** Paths (relative to the package root) that `npm pack` would put in the tarball. */
function packedPaths(): string[] {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageDir,
    encoding: 'utf8',
  });
  const [report] = JSON.parse(out.slice(out.indexOf('['))) as { files: { path: string }[] }[];
  return report.files.map((f) => f.path);
}

describe('npm tarball license contents', () => {
  const paths = packedPaths();

  it.each(['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'])('includes %s', (file) => {
    expect(paths).toContain(file);
  });

  it('grants the MIT license to Mike North', () => {
    const text = readFileSync(`${packageDir}LICENSE`, 'utf8');
    expect(text).toMatch(/^MIT License/);
    expect(text).toContain('Copyright (c) 2026 Mike North');
  });

  it('credits mvdan/sh and the Go project with their BSD-3-Clause terms', () => {
    const text = readFileSync(`${packageDir}THIRD_PARTY_NOTICES.md`, 'utf8');
    expect(text).toContain('Copyright (c) 2016, Daniel Martí');
    expect(text).toContain('Copyright 2009 The Go Authors');
    expect(text.match(/Redistribution and use in source and binary forms/g)).toHaveLength(2);
  });
});
