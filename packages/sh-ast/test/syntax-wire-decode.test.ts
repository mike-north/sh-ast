/**
 * Decoding owns the fresh JSON graph. Byte tags may be replaced, but ordinary
 * records and arrays must survive by identity so restoration does not allocate a
 * duplicate syntax tree. Hand-authored transport and the retired copying decoder
 * provide independent expected values for the adaptation boundary.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShInternalError } from '../src/errors.js';
import { decodeWire, isRecord } from '../src/syntax-wire.js';
import { callSyntax } from '../src/wasm-instance.js';

afterEach(() => vi.restoreAllMocks());

/** The previous allocation-heavy decoder is retained only as a value oracle. */
function copyingDecode(text: string): unknown {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (!isRecord(item)) return item;
    if (Object.keys(item).length === 1 && typeof item.Bytes === 'string') {
      return new Uint8Array(Buffer.from(item.Bytes, 'base64'));
    }
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
  };
  return visit(JSON.parse(text));
}

describe('owned JSON graph restoration', () => {
  it('retains parsed records and arrays while replacing only byte tags', () => {
    const ordinary = { Type: 'Lit', Value: '🎉中e\u0301', Extra: null };
    const nested = [{ Value: { Bytes: '/wCA' } }, ordinary];
    const parsed = { File: { Parts: nested }, Error: null };
    vi.spyOn(JSON, 'parse').mockReturnValueOnce(parsed);

    const result = decodeWire('response supplied by JSON.parse');
    expect(result).toBe(parsed);
    expect(parsed.File.Parts).toBe(nested);
    expect(parsed.File.Parts[1]).toBe(ordinary);
    expect(parsed.File.Parts[0]).toEqual({ Value: new Uint8Array([255, 0, 128]) });
  });

  it('retains a root array and ordinary descendants', () => {
    const child = { nested: [null, true, 42, '中'] };
    const parsed = [child, { Bytes: '' }];
    vi.spyOn(JSON, 'parse').mockReturnValueOnce(parsed);
    expect(decodeWire('array response')).toBe(parsed);
    expect(parsed[0]).toBe(child);
    expect(parsed[1]).toEqual(new Uint8Array());
  });

  it('restores byte tags in own __proto__ properties without altering prototypes', () => {
    const text =
      '{"__proto__":{"Bytes":"/w=="},"child":{"__proto__":{"polluted":true}},"constructor":{"Bytes":"AA=="}}';
    const decoded = decodeWire(text);
    expect(isRecord(decoded)).toBe(true);
    if (!isRecord(decoded) || !isRecord(decoded.child)) throw new Error('expected records');
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(decoded.child)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')).toEqual({
      value: new Uint8Array([255]),
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(Object.hasOwn(decoded.child, '__proto__')).toBe(true);
    expect(decoded.child.polluted).toBeUndefined();
    expect(decoded.constructor).toEqual(new Uint8Array([0]));
  });

  it.each([
    '{"Value":"🎉中é<>&\\u2028\\u2029","Parts":[null,{"Bytes":"/wCA"}],"Typed":{"Type":"TypedNil","Kind":"Word"}}',
    '[{"Name":{"Bytes":"/w=="}},{"Bytes":"AA==","Other":"ordinary record"},true,0,null]',
    '{"__proto__":{"Bytes":"/w=="},"constructor":{"prototype":{"Bytes":"AA=="}}}',
    '{"Bytes":""}',
    '"🎉中é"',
  ])('matches the retired decoder for independent wire fixture %s', (text) => {
    expect(decodeWire(text)).toEqual(copyingDecode(text));
  });

  it.each(['{"Bytes":"?"}', '[{"Bytes":"/w"}]', '{"deep":{"Bytes":"AB=="}}'])(
    'rejects noncanonical base64 at every depth: %s',
    (text) => {
      expect(() => decodeWire(text)).toThrow(ShInternalError);
    },
  );

  it('reports malformed JSON as a bridge error', () => {
    expect(() => decodeWire('{')).toThrow(ShInternalError);
  });

  it.each([
    '# 中\necho "🎉" é\n',
    "cat <<'EOF'\n🎉中é <>&\nEOF\n",
    'for x in 🎉 中; do echo "$x"; done\n',
    'echo 中; (',
  ])(
    'preserves real parse/snapshot envelopes for %s',
    (source) => {
      for (const operation of ['parse', 'parse-with-positions']) {
        const response = callSyntax(
          operation,
          new TextEncoder().encode(source),
          '{"KeepComments":true,"Filename":{"Bytes":"/y5zaA=="}}',
        );
        expect(decodeWire(response)).toEqual(copyingDecode(response));
      }
    },
    15_000,
  );
});
