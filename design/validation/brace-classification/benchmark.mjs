/** Isolates analyzer overhead on ordinary and brace-heavy trees without timing assertions. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const { parseSync } = await import(pathToFileURL(`${root}/packages/sh-ast/dist/index.js`).href);
const { enumerateCommands, resolveArgv0 } = await import(
  pathToFileURL(`${root}/packages/sh-ast/dist/analyze/index.js`).href
);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const rows = [];
for (const [name, word] of [
  ['ordinary', 'ordinary'],
  ['braces', '{中,🎉}'],
]) {
  const source = Array.from({ length: 100 }, (_, i) => `echo ${word} item${i}\n`).join('');
  const file = parseSync(source);
  const analyze = () => {
    const sites = enumerateCommands(file);
    const commands = sites.map((site) => resolveArgv0(site));
    if (
      sites.length !== 100 ||
      commands.some((command) => !command.effective.static || command.effective.text !== 'echo')
    )
      throw new Error('benchmark lost command work');
    return sites.filter((site) => site.argv[1]?.static === false).length;
  };
  for (let i = 0; i < 10; i++) analyze();
  const samples = [];
  let dynamicArguments;
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    dynamicArguments = analyze();
    samples.push(performance.now() - start);
  }
  const sorted = samples.toSorted((a, b) => a - b);
  rows.push({
    name,
    sourceSha256: hash(source),
    bytes: Buffer.byteLength(source),
    commands: 100,
    dynamicArguments,
    warmup: 10,
    samplesMs: samples,
    medianMs: sorted[15],
    p90Ms: sorted[26],
  });
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      wasmSha256: hash(readFileSync(`${root}/packages/sh-ast/shim/sh-ast.wasm`)),
      rows,
    },
    null,
    2,
  ),
);
