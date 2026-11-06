/**
 * An array element's trailing bracket is ordinary glob text when it follows a
 * parameter expansion. Bash must receive the whole expanded word; it is not an
 * indexed assignment requiring an equals sign.
 */
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { parseSync, printSync } from '../src/index.js';

it('accepts the array expansion from issue 82 and retains its Bash value', () => {
  const source =
    "target='alpha@beta'; target=(${target//@/ }[0]); printf '<%s>\\n' \"${target[@]}\"\n";
  const expected = '<alpha>\n<beta[0]>\n';
  // The expected words are written independently of either parser or printer.
  const original = spawnSync('bash', ['-c', source], { encoding: 'utf8' });
  expect(original.status).toBe(0);
  expect(original.stderr).toBe('');
  expect(original.stdout).toBe(expected);
  const file = parseSync(source);
  expect(file.Stmts?.[1]?.Cmd).toMatchObject({
    Type: 'CallExpr',
    Assigns: [
      {
        Array: {
          Elems: [
            {
              Value: {
                Parts: [
                  { Type: 'ParamExp', Param: { Value: 'target' } },
                  { Type: 'Lit', Value: '[0]' },
                ],
              },
            },
          ],
        },
      },
    ],
  });
  const printed = printSync(file);
  expect(typeof printed).toBe('string');
  const result = spawnSync('bash', ['-c', String(printed)], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(expected);
});

it('clamps derived positions rather than wrapping into a different line', async () => {
  const { newPos, nodeEnd } = await import('../src/index.js');
  const end = nodeEnd({ Type: 'Comment', Hash: newPos(0xffff_fff4, 1, 16383), Text: 'x' });
  expect(end).toMatchObject({
    Offset: 0xffff_fff4,
    Line: 1,
    Col: 0,
    IsValid: true,
    OffsetOverflow: false,
  });
});

it('preserves upstream Zsh option overrides as three-state numeric fields', async () => {
  const { LangZsh, OptOn, OptOff, OptUnset } = await import('../src/index.js');
  expect([OptUnset, OptOn, OptOff]).toEqual([0, 1, 2]);
  const file = parseSync('echo ${=a} ${==a} ${~a} ${~~a} ${^a} ${^^a}\n', { Variant: LangZsh });
  expect(file.Stmts?.[0]?.Cmd).toMatchObject({
    Args: [
      {},
      { Parts: [{ Type: 'ParamExp', Split: 1, GlobSubst: 0, RcExpand: 0 }] },
      { Parts: [{ Type: 'ParamExp', Split: 2, GlobSubst: 0, RcExpand: 0 }] },
      { Parts: [{ Type: 'ParamExp', Split: 0, GlobSubst: 1, RcExpand: 0 }] },
      { Parts: [{ Type: 'ParamExp', Split: 0, GlobSubst: 2, RcExpand: 0 }] },
      { Parts: [{ Type: 'ParamExp', Split: 0, GlobSubst: 0, RcExpand: 1 }] },
      { Parts: [{ Type: 'ParamExp', Split: 0, GlobSubst: 0, RcExpand: 2 }] },
    ],
  });
  expect(printSync(file)).toBe('echo ${=a} ${==a} ${~a} ${~~a} ${^a} ${^^a}\n');
});

it('checks the uint8 storage boundary for unnamed option states', async () => {
  const { rawOperator, InputError } = await import('../src/index.js');
  const { isSyntaxNode } = await import('../src/syntax-wire.js');
  const { syntheticNode } = await import('./syntax-fixtures.js');
  const node = syntheticNode('ParamExp', { Split: rawOperator('OptState', 255) });
  expect(isSyntaxNode(node)).toBe(true);
  expect(isSyntaxNode({ ...node, Split: 256 })).toBe(false);
  expect(rawOperator('OptState', 255)).toBe(255);
  expect(() => rawOperator('OptState', 256)).toThrow(InputError);
  expect(() => rawOperator('OptState', -1)).toThrow(InputError);
});
