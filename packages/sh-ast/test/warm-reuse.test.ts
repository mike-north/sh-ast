/**
 * Warm-reuse smoke test — criterion 6 of
 * https://github.com/mike-north/eslint-sh/issues/4.
 *
 * Ports the spike's ~700-line warm-parse exercise (`spike/perf-test.mjs`,
 * `spike/lint-test.mjs` #3): the WASM instance must be instantiated once and
 * reused across many `parseSync` calls without error. No latency gate is
 * asserted here (see design/MILESTONES.md M2 for the performance work).
 */
import { describe, expect, it } from 'vitest';
import { parseSync } from '../src/index.js';

function buildFixture(functionCount: number): string {
  return Array.from({ length: functionCount }, (_, i) => {
    const n = String(i);
    return `f${n}() {\n  local x="v${n} 🎉"\n  if [ -n "$x" ]; then\n    echo "$x" | tr a-z A-Z\n  fi\n}\ncase "$1" in a) f${n};; esac\n`;
  }).join('');
}

describe('warm-reuse smoke test', () => {
  const big = buildFixture(100); // ~700 lines, matching the spike's fixture size

  it('produces a script of roughly the size the spike exercised', () => {
    expect(big.split('\n').length).toBeGreaterThan(600);
  });

  // 30s: this test's 23 WASM parses of the ~700-line fixture comfortably
  // clear vitest's 5000ms default on a fast local machine, but not on the
  // 2-core GitHub Actions runner — give it headroom there rather than
  // shrinking the batch, which is the point of the smoke test.
  it('parses repeatedly without re-instantiating or throwing (instance reuse)', () => {
    // Warm-up calls, then a batch — every call must succeed and produce a
    // File root, proving the lazily-instantiated WASM module keeps working
    // across calls rather than being torn down or reset.
    for (let i = 0; i < 3; i++) {
      const file = parseSync(big);
      expect(file.type).toBe('File');
    }
    const results = Array.from({ length: 20 }, () => parseSync(big));
    expect(results).toHaveLength(20);
    for (const file of results) {
      expect(file.type).toBe('File');
      expect(file.stmts.length).toBeGreaterThan(0);
    }
  }, 30_000);

  // 30s: same headroom as the instance-reuse test above — this also does
  // repeated WASM parses of the ~700-line fixture on the same slow CI runner.
  it('produces identical normalized output across repeated warm parses of the same input', () => {
    const first = JSON.stringify(parseSync(big));
    const second = JSON.stringify(parseSync(big));
    expect(second).toBe(first);
  }, 30_000);
});
