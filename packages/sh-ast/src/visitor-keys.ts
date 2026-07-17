import { deepFreeze } from './deep-freeze.js';
import { visitorKeys as generatedVisitorKeys } from '../generated/visitor-keys.js';

/**
 * Maps each normalized node `type` to the field names (lowercased, matching
 * the normalized node shape produced by `normalize`) whose values hold child
 * nodes.
 *
 * Generated from mvdan/sh's `syntax` package struct definitions by
 * `tools/gen-visitor-keys` (see design/ARCHITECTURE.md, "The schema table is
 * generated, not hand-written") — this module only re-exports the generated
 * table under the public name, frozen. {@link walk} does not depend on this
 * table for correctness — it discovers children structurally — so any gap
 * here (there shouldn't be one; the kitchen-sink golden test guards it)
 * affects only external consumers that choose to traverse via this table.
 *
 * Frozen (including each per-type field-name array) so immutability of this
 * shared, module-scoped table is a contract, not just a convention any
 * importer happens to honor.
 *
 * @public
 */
export const visitorKeys: Readonly<Record<string, readonly string[]>> =
  deepFreeze(generatedVisitorKeys);
