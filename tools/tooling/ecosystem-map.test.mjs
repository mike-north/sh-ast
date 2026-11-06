/** Guards the owner-ratified ecosystem map as bytes, independent of local source files. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// This owner-approved digest is independent ground truth, never derived from the copy under test.
const ratifiedSha256 = '70d3c639af497fdea72a40925c4c5048d24865c5e684f25f4a2aa47e55f100a2';
// Delimiters belong to repository instructions; their contents alone are the shared map.
const begin = Buffer.from('<!-- ecosystem-map:begin -->');
const end = Buffer.from('<!-- ecosystem-map:end -->');
const instructions = readFileSync(new URL('../../AGENTS.md', import.meta.url));

/** Requires one ordered pair of standalone LF marker lines and hashes the unmodified interior. */
function assertRatifiedMap(bytes) {
  const offsets = [begin, end].map((marker) => {
    const offset = bytes.indexOf(marker);
    assert.notEqual(offset, -1, `missing ${marker}`);
    assert.equal(bytes.indexOf(marker, offset + marker.length), -1, `duplicate ${marker}`);
    assert.ok(offset === 0 || bytes[offset - 1] === 10, `${marker} must start a line`);
    assert.equal(bytes[offset + marker.length], 10, `${marker} must end an LF line`);
    return offset;
  });
  const start = offsets[0] + begin.length + 1;
  assert.ok(start < offsets[1], 'map must follow the begin marker and precede the end marker');
  // No decoding, trimming, or newline normalization may conceal drift, including the final LF.
  const actual = createHash('sha256').update(bytes.subarray(start, offsets[1])).digest('hex');
  assert.equal(actual, ratifiedSha256, 'ecosystem map bytes differ from the owner-ratified map');
}

test('tracked AGENTS.md contains the exact owner-ratified ecosystem map', () => {
  assertRatifiedMap(instructions);
});

test('map guard rejects missing, duplicate, malformed, and reversed delimiters', () => {
  assertRatifiedMap(instructions);
  const text = instructions.toString('utf8');
  for (const invalid of [
    text.replace(begin.toString(), ''),
    text.replace(end.toString(), ''),
    `${begin}\n${text}`,
    `${text}${end}\n`,
    text.replace(begin.toString(), ` ${begin}`),
    text.replace(end.toString(), `${end} `),
    text
      .replace(begin.toString(), 'PLACEHOLDER')
      .replace(end.toString(), begin.toString())
      .replace('PLACEHOLDER', end.toString()),
  ]) {
    assert.throws(() => assertRatifiedMap(Buffer.from(invalid)));
  }
});

test('map guard rejects byte drift even when rendered Markdown is equivalent', () => {
  assertRatifiedMap(instructions);
  const text = instructions.toString('utf8');
  for (const invalid of [
    text.replace('# Ecosystem map\n', '# Ecosystem map \n'),
    text.replace('# Ecosystem map\n', '# Ecosystem map\r\n'),
    text.replace(`\n${end}`, end.toString()),
    text.replace(`\n${end}`, `\n\n${end}`),
    text.replace('# Ecosystem map', '# Ecosystem Map'),
  ]) {
    assert.throws(() => assertRatifiedMap(Buffer.from(invalid)));
  }
});
