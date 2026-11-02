/**
 * Public parsing outcomes derived from mvdan/sh v3.13.1, independently of the
 * bridge's typedjson encoding. Empty programs and Go zero values are meaningful
 * syntax data; their presence must not depend on JSON omission conventions.
 */
import { describe, expect, it } from 'vitest';
import { parseSync } from '../src/index.js';

describe('faithful whole-file parsing', () => {
  it.each(['', ' \t\r\n', '# only\n'])('represents an empty program: %j', (source) => {
    expect(parseSync(source)).toEqual({ Type: 'File', Name: '', Stmts: null, Last: null });
  });

  it('preserves scalar defaults and upstream field spelling', () => {
    expect(parseSync('echo hi')).toMatchObject({
      Type: 'File',
      Name: '',
      Last: null,
      Stmts: [
        {
          Type: 'Stmt',
          Comments: null,
          Negated: false,
          Background: false,
          Coprocess: false,
          Redirs: null,
          Cmd: {
            Type: 'CallExpr',
            Assigns: null,
            Args: [
              { Type: 'Word', Parts: [{ Type: 'Lit', Value: 'echo' }] },
              { Type: 'Word', Parts: [{ Type: 'Lit', Value: 'hi' }] },
            ],
          },
        },
      ],
    });
  });
});
