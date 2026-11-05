/** Analyze-only callers can construct every named state consumed by ParamExp. */
import { expect, it } from 'vitest';
import { OptUnset, OptOn, OptOff, rawOperator } from '../src/analyze/index.js';
import type { OptState, ParamExp } from '../src/analyze/index.js';

it('exports the complete option-state domain through analyze alone', () => {
  const fields: Pick<ParamExp, 'Split' | 'GlobSubst' | 'RcExpand'> = {
    Split: OptOn,
    GlobSubst: OptOff,
    RcExpand: OptUnset,
  };
  const states: readonly OptState[] = [OptUnset, OptOn, OptOff];
  expect(states).toEqual([0, 1, 2]);
  expect(fields).toEqual({ Split: 1, GlobSubst: 2, RcExpand: 0 });
  expect(rawOperator('OptState', 255)).toBe(255);
  expect(() => rawOperator('OptState', 256)).toThrow('uint8');
});
