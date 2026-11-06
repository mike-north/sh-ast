/**
 * Valid deep native output and representable constructed input must either
 * succeed or refuse with a typed bridge resource failure. Child isolation uses
 * the normal Node stack and proves input atomicity plus later operation reuse.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const entry = new URL('../dist/index.js', import.meta.url).href;
const fixture = fileURLToPath(new URL('./fixtures/split-braces-depth-child.mjs', import.meta.url));

describe('SplitBraces host stack boundary', () => {
  it.each([
    ['output', 20, 1],
    ['output', 100, 1],
    ['output', 1000, 1],
    ['output', 2000, 8],
    ['bytes', 1000, 1],
    ['input', 2000, 1],
  ])(
    'keeps %s depth %i failures typed, atomic, and reusable',
    (mode, depth, attempts) => {
      const child = spawnSync(
        process.execPath,
        [fixture, entry, mode, String(depth), String(attempts)],
        {
          encoding: 'utf8',
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
        },
      );
      expect(child.error, child.stderr).toBeUndefined();
      expect(child.signal, child.stderr).toBeNull();
      expect(child.status, child.stderr).toBe(0);
      const observation: unknown = JSON.parse(child.stdout.trim());
      expect(observation).toMatchObject({ mode, depth, attempts, reused: true });
    },
    20_000,
  );
});
