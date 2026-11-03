/**
 * Validates unnamed operator values against the faithful field domains. This
 * shared constructor owns numeric branding only; it does not parse syntax or
 * promise that an upstream operation accepts every representable operator.
 */
import { SYNTAX_SCHEMA } from '../generated/syntax-schema.js';
import type { OperatorFamily, RawOperator } from '../generated/syntax-constants.js';
import { InputError } from './syntax-errors.js';

/**
 * Represents an unnamed value in an upstream uint32 operator family. Named
 * constants remain precise literal unions; this explicit path preserves other Go
 * values without claiming an operation such as Print accepts them.
 * @public
 */
export function rawOperator<Family extends OperatorFamily>(
  family: Family,
  value: number,
): RawOperator<Family> {
  const knownFamily = Object.values(SYNTAX_SCHEMA).some((record) =>
    Object.values(record.fields).some(
      (field) => field.kind === 'operator' && field.type === family,
    ),
  );
  if (!knownFamily || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new InputError(
      'An operator value must belong to a known family and be an integral uint32',
    );
  }
  // The runtime check establishes the opaque numeric brand; no value is changed.
  return value as RawOperator<Family>;
}
