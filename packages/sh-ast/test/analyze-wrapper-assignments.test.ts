/**
 * Wrapper assignment operands follow utility argument grammars, not shell
 * identifier syntax. Expected commands are hand-derived from GNU/BSD env and
 * sudo parse_args.c; no command in these fixtures is executed.
 */
import { describe, expect, it } from 'vitest';
import { enumerateCommands, resolveArgv0 } from '../src/analyze/index.js';
import type { Argv0Resolution, ResolveArgv0Options, WrapperSpec } from '../src/analyze/index.js';
import { parseSync, ShAnalyzeInvalidWrapperSpecError } from '../src/index.js';

/** Resolve the sole simple command in a fixture without executing its source. */
function resolve(source: string, options?: ResolveArgv0Options): Argv0Resolution {
  const sites = enumerateCommands(parseSync(source));
  expect(sites).toHaveLength(1);
  const site = sites.at(0);
  if (site === undefined) {
    throw new Error('fixture must contain one command');
  }
  return resolveArgv0(site, options);
}

describe('utility assignment operands', () => {
  // env.c scans strchr(word, '='); sudo is_envar also rejects / and = prefixes.
  it.each([
    'env A-B=1 rm x',
    'env 1X=2 rm x',
    'env 名=🎉 rm x',
    'env A=1 B-C=2 rm x',
    'env é=中 rm x',
    'env /tmp/name=value rm x',
    'sudo A-B=1 rm x',
    'sudo 1X=2 rm x',
    'sudo 名=🎉 rm x',
    'env A=1 rm x',
    'env rm x',
  ])('%s identifies rm', (source) => {
    expect(resolve(source).effective).toEqual({ static: true, text: 'rm' });
  });

  it('shell assignment counts exclude utility assignment operands', () => {
    expect(resolve('A=1 env B-C=2 rm x')).toEqual({
      chainIndices: [0, 2],
      chain: [
        { static: true, text: 'env' },
        { static: true, text: 'rm' },
      ],
      effective: { static: true, text: 'rm' },
      assignmentsSkipped: 1,
    });
  });

  it.each(['env =x rm', 'env -- =x rm', 'env A=1 =x rm'])(
    '%s fails closed on a platform-dependent empty name',
    (source) => {
      // GNU env with glibc accepts empty names; FreeBSD setenv rejects them.
      expect(resolve(source).effective).toEqual({ static: false, reason: 'ambiguous-assignment' });
    },
  );

  it.each([
    ['sudo =x rm', '=x'],
    ['sudo /tmp/name=value rm', '/tmp/name=value'],
    ['sudo -- A-B=1 rm', 'A-B=1'],
    ['sudo -- A=1 rm', 'A=1'],
    ['sudo -- -u alice rm', '-u'],
    ['env -- A-B=1 rm', 'rm'],
    ['env -- -u=alice rm', 'rm'],
    ['env A-B=1 -u alice rm', '-u'],
    ['env A-B=1 -- rm', '--'],
    ['env A=1 --split-string=rm echo', 'echo'],
    ['env A=1 -S rm', '-S'],
    ['sudo A-B=1 -u alice rm', 'rm'],
    ['sudo -u alice A-B=1 rm', 'rm'],
  ])('%s respects utility scanning boundaries', (source, command) => {
    expect(resolve(source).effective).toEqual({ static: true, text: command });
  });

  it('env split-string remains unresolved while option parsing is active', () => {
    expect(resolve("env -S 'a b'").effective).toEqual({
      static: false,
      reason: 'embedded-command',
    });
  });

  it('dynamic operands remain unresolved rather than skipped as assignments', () => {
    expect(resolve('env A-B="$x" rm').effective).toEqual({ static: false, reason: 'expansion' });
  });

  it.each([
    'nice A-B=1 rm',
    'timeout 10 A-B=1 rm',
    'nohup A-B=1 rm',
    'command A-B=1 rm',
    'exec A-B=1 rm',
    '"time" A-B=1 rm',
  ])('%s does not invent assignment operands for other defaults', (source) => {
    expect(resolve(source).effective).toEqual({ static: true, text: 'A-B=1' });
  });

  it.each([
    ['retry A=1 rm', 'rm'],
    ['retry A-B=1 rm', 'A-B=1'],
    ['retry -- A=1 rm', 'A=1'],
  ])('%s preserves legacy caller wrapper grammar', (source, command) => {
    expect(
      resolve(source, { transparentWrappers: [{ names: ['retry'], skipAssignmentOperands: true }] })
        .effective,
    ).toEqual({ static: true, text: command });
  });

  it('an explicit grammar works for caller-named wrappers and takes precedence over the legacy boolean', () => {
    expect(
      resolve('retry -- 名=🎉 rm', {
        transparentWrappers: [
          { names: ['retry'], skipAssignmentOperands: false, assignmentOperands: 'env' },
        ],
      }).effective,
    ).toEqual({ static: true, text: 'rm' });
    expect(
      resolve('retry A-B=1 rm', {
        transparentWrappers: [{ names: ['retry'], assignmentOperands: 'sudo' }],
      }).effective,
    ).toEqual({ static: true, text: 'rm' });
    expect(
      resolve('retry A-B=1 rm', {
        transparentWrappers: [{ names: ['retry'], assignmentOperands: 'shell-identifier' }],
      }).effective,
    ).toEqual({ static: true, text: 'A-B=1' });
  });

  it.each(['contains-equals', true, {}, null])(
    'rejects an invalid grammar %j at the boundary',
    (assignmentOperands) => {
      // Deliberately inject untyped caller data to exercise the runtime boundary.
      const spec = { names: ['retry'], assignmentOperands } as unknown as WrapperSpec;
      expect(() => resolve('retry rm', { transparentWrappers: [spec] })).toThrow(
        ShAnalyzeInvalidWrapperSpecError,
      );
    },
  );
});
