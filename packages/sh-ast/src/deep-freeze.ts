/**
 * Recursively freezes `value` and every object/array it (transitively)
 * contains, so a frozen shared table's immutability holds at every level —
 * not just its own top-level keys — rather than relying on every caller to
 * treat it as read-only by convention.
 *
 * Generic, structural recursion over an unknown shape needs a cast to index
 * into `value`'s own properties; contained to this one small, well-tested
 * utility rather than spread across every table that uses it.
 *
 * @internal
 */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    for (const key of Object.getOwnPropertyNames(value)) {
      const prop = (value as Record<string, unknown>)[key];
      if (prop !== null && typeof prop === 'object') {
        deepFreeze(prop);
      }
    }
    Object.freeze(value);
  }
  return value;
}
