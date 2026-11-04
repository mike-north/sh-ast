/**
 * Guards the Go toolchain floor. golang/go#80472 (js/wasm itabInit storing method
 * PCs through a GC write barrier, aborting the runtime with "found bad pointer in
 * Go heap") is fixed in go1.26.6 and go1.27.0, so any 1.26 pin below .6 ships a
 * WASM shim that can abort. Both go.mod files must stay at or above the fix.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Parses the `go 1.X.Y` directive into [major, minor, patch]; patch defaults to 0. */
function goDirective(goMod: string): [number, number, number] {
  const match = /^go (\d+)\.(\d+)(?:\.(\d+))?\s*$/m.exec(goMod);
  if (!match) throw new Error('no go directive');
  return [Number(match[1]), Number(match[2]), Number(match[3] || '0')];
}

/** True when `version` is at or above the first release fixing #80472 on its minor line. */
function hasItabFix([major, minor, patch]: [number, number, number]): boolean {
  if (major !== 1) return major > 1;
  if (minor === 26) return patch >= 6;
  return minor >= 27;
}

describe('Go toolchain floor (golang/go#80472)', () => {
  it('parses go directives', () => {
    expect(goDirective('module m\n\ngo 1.26.10\n')).toEqual([1, 26, 10]);
    expect(goDirective('go 1.27\n')).toEqual([1, 27, 0]);
  });

  it('classifies versions around the fix', () => {
    expect(hasItabFix([1, 26, 5])).toBe(false);
    expect(hasItabFix([1, 26, 6])).toBe(true);
    expect(hasItabFix([1, 26, 10])).toBe(true);
    expect(hasItabFix([1, 25, 9])).toBe(false);
    expect(hasItabFix([1, 27, 0])).toBe(true);
  });

  it.each(['../shim/go.mod', '../../../tools/gen-visitor-keys/go.mod'])(
    '%s pins a release with the itab fix',
    (relative) => {
      const goMod = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
      expect(hasItabFix(goDirective(goMod))).toBe(true);
    },
  );
});
