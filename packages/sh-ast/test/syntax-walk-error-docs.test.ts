/**
 * Public error bytes need a discoverable property contract in the shipped API
 * report and generated reference, not a description attached only to a constructor.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('WalkPanicError Message reference documentation', () => {
  it('publishes a description on the Message property page', () => {
    const page = readFileSync(
      new URL('../../../docs/sh-ast.walkpanicerror.message.md', import.meta.url),
      'utf8',
    );
    const summary = page
      .split('## WalkPanicError.Message property')
      .at(1)
      ?.split('**Signature:**')
      .at(0);
    expect(summary?.trim()).toBeTruthy();
  });

  it('marks Message as documented in the extracted API report', () => {
    const report = readFileSync(new URL('../api-report/sh-ast.api.md', import.meta.url), 'utf8');
    const declaration = report
      .split('export class WalkPanicError extends ShAstError {')
      .at(1)
      ?.split('}')
      .at(0);
    expect(declaration).toContain('readonly Message: GoString;');
    expect(declaration).not.toMatch(/\/\/ \(undocumented\)\s+readonly Message:/);
  });
});
