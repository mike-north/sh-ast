import { Linter } from 'eslint';
import plugin from './dist/index.js';
const big = Array.from(
  { length: 100 },
  (_, i) =>
    `f${i}() {\n  local x="v${i} 🎉"\n  if [ -n "$x" ]; then\n    echo "$x" | tr a-z A-Z\n  fi\n}\ncase "$1" in a) f${i};; esac\n`,
).join('');
const linter = new Linter();
const cfg = [{ files: ['**/*.sh'], plugins: { sh: plugin }, language: 'sh/sh', rules: {} }];
const t0 = performance.now();
let m = linter.verify(big, cfg, { filename: 'a.sh' });
const cold = performance.now() - t0;
const xs = [];
for (let i = 0; i < 25; i++) {
  const s = performance.now();
  m = linter.verify(big, cfg, { filename: 'a.sh' });
  xs.push(performance.now() - s);
}
xs.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    lines: big.split('\n').length,
    msgs: m.length,
    cold: +cold.toFixed(1),
    warmMedian: +xs[12].toFixed(1),
    warmMin: +xs[0].toFixed(1),
  }),
);
