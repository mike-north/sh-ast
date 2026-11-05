/**
 * Validates unnamed numeric values against the faithful field domains. This
 * shared constructor owns numeric branding only; it does not parse syntax or
 * promise that an upstream operation accepts every representable value.
 */
import { SYNTAX_SCHEMA } from '../generated/syntax-schema.js';
import type { OperatorFamily, RawOperator } from '../generated/syntax-constants.js';
import { InputError } from './syntax-errors.js';

/** Returns the upstream storage bound; OptState is uint8, token enums are uint32. @internal */
export function operatorMaximum(family: string | null): number {
  return family === 'OptState' ? 0xff : 0xffff_ffff;
}

/**
 * Represents an unnamed value in an upstream numeric family. Named
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
  if (!knownFamily || !Number.isInteger(value) || value < 0 || value > operatorMaximum(family)) {
    throw new InputError(
      `An operator value must belong to a known family and be an integral ${family === 'OptState' ? 'uint8' : 'uint32'}`,
    );
  }
  // The runtime check establishes the opaque numeric brand; no value is changed.
  return value as RawOperator<Family>;
}
