/** Exercises owner-required lint outcomes using the real workspace configuration. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { ESLint } from 'eslint';
import ts from 'typescript';

const eslint = new ESLint();
// An existing project member lets the project service type-check in-memory probes.
const filePath = 'packages/sh-ast/src/index.ts';

/** Returns diagnostics for a source probe without changing a project file. */
async function diagnostics(source) {
  const [result] = await eslint.lintText(source, { filePath });
  assert.equal(result.fatalErrorCount, 0);
  return result.messages;
}

test('a separate comment cannot supply a disable directive description', async () => {
  const messages = await diagnostics(
    '// A separate explanation is insufficient.\n// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport type Probe = any;\n',
  );
  assert.ok(
    messages.some(
      ({ ruleId }) => ruleId === '@eslint-community/eslint-comments/require-description',
    ),
  );
});

test('a used directive with its own description is accepted', async () => {
  assert.deepEqual(
    await diagnostics(
      '/** @public */\nexport type Probe = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- The probe deliberately models an unconstrained foreign API.\n',
    ),
    [],
  );
});

test('an unused disable directive is an error', async () => {
  const messages = await diagnostics(
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- This deliberately unnecessary exception must fail.\nexport type Probe = unknown;\n',
  );
  assert.ok(
    messages.some(
      ({ severity, ruleId, message }) =>
        severity === 2 &&
        (ruleId === '@eslint-community/eslint-comments/no-unused-disable' ||
          message.includes('Unused eslint-disable')),
    ),
  );
});

test('explicit any and unsafe flows from untyped JSON are rejected', async () => {
  const messages = await diagnostics(
    'export type Probe = any;\nexport const result = JSON.parse("{}");\nresult.run(result.value);\nparseInt(result);\nexport function read(): string { return JSON.parse("{}"); }\n',
  );
  for (const rule of [
    'no-explicit-any',
    'no-unsafe-assignment',
    'no-unsafe-call',
    'no-unsafe-member-access',
    'no-unsafe-argument',
    'no-unsafe-return',
  ]) {
    assert.ok(
      messages.some(({ ruleId }) => ruleId === `@typescript-eslint/${rule}`),
      rule,
    );
  }
});

test('every tracked TypeScript file has strict type-aware lint coverage', async () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
  for (const file of files.filter((name) => /\.(?:[cm]?ts|tsx)$/.test(name))) {
    assert.equal(await eslint.isPathIgnored(file), false, file);
    const config = await eslint.calculateConfigForFile(file);
    for (const rule of [
      'no-explicit-any',
      'no-unsafe-assignment',
      'no-unsafe-call',
      'no-unsafe-member-access',
      'no-unsafe-argument',
      'no-unsafe-return',
    ]) {
      assert.equal(config.rules[`@typescript-eslint/${rule}`][0], 2, `${file}: ${rule}`);
    }
    assert.equal(config.languageOptions.parserOptions.projectService, true, file);
  }
  for (const extension of ['ts', 'tsx', 'mts', 'cts']) {
    const config = await eslint.calculateConfigForFile(`packages/sh-ast/src/probe.${extension}`);
    assert.equal(config?.rules['@typescript-eslint/no-explicit-any']?.[0], 2, extension);
  }
});

test('every tsconfig enables noImplicitAny through its effective compiler options', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
  for (const file of files.filter((name) => /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(name))) {
    const config = ts.readConfigFile(file, ts.sys.readFile);
    assert.equal(config.error, undefined, file);
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      file.slice(0, file.lastIndexOf('/') + 1) || '.',
    );
    assert.equal(parsed.options.noImplicitAny, true, file);
  }
});
