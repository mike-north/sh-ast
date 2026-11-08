/**
 * Handwritten review outcomes exercise the script embedded in the real workflow.
 * Ruby's standard YAML reader avoids a second gate implementation or a new npm
 * dependency; CI's Ubuntu runner supplies Ruby and Node independently of PR code.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

/** Read workflow structure, including the executable block, with a YAML parser. */
function workflow(name) {
  return JSON.parse(
    execFileSync(
      'ruby',
      [
        '-ryaml',
        '-rjson',
        '-e',
        "v = YAML.load_file(ARGV.fetch(0)); v['on'] = v.delete(true) if v.key?(true); puts JSON.generate(v)",
        `.github/workflows/${name}.yml`,
      ],
      { encoding: 'utf8' },
    ),
  );
}

/** Real GraphQL connection shape; fixtures deliberately do not encode gate policy. */
function page(nodes, hasNextPage = false, endCursor = null) {
  return {
    repository: { pullRequest: { reviews: { nodes, pageInfo: { hasNextPage, endCursor } } } },
  };
}

/** The login is independently observed on sh-ast PR #91, not a guessed REST suffix. */
function review(state, login = 'chatgpt-codex-connector') {
  return { author: login === null ? null : { login }, state };
}

/**
 * Supply the same globals as github-script, recording failures as Action failures.
 * PR identity comes from event payload plus the base repository, never head.repo,
 * a review body, a branch name, or context.issue fallbacks.
 */
async function runGate(
  pages,
  context = {
    repo: { owner: 'mike-north', repo: 'sh-ast' },
    payload: { pull_request: { number: 91, head: { repo: { full_name: 'other/fork' } } } },
  },
) {
  const step = workflow('codex-review-gate').jobs['codex-review-present'].steps[0];
  const failures = [];
  const calls = [];
  const github = {
    graphql: async (query, variables) => {
      calls.push({ query, variables });
      assert.match(query, /query\b/);
      assert.doesNotMatch(query, /\bmutation\b/);
      assert.match(query, /repository\(owner: \$owner, name: \$repo\)/);
      assert.match(query, /pullRequest\(number: \$number\)/);
      assert.match(query, /reviews\(first: 100, after: \$after\)/);
      assert.match(query, /author\s*\{\s*login\s*\}/);
      assert.match(query, /\bstate\b/);
      assert.match(query, /pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/);
      assert.ok(calls.length <= pages.length, 'unexpected extra API request');
      const response = pages[calls.length - 1];
      if (response instanceof Error) throw response;
      return response;
    },
  };
  const core = { setFailed: (message) => failures.push(message), info: () => {} };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  try {
    await new AsyncFunction('github', 'context', 'core', step.with.script)(github, context, core);
  } catch (error) {
    // github-script fails the step on uncaught exceptions, including API errors.
    failures.push(String(error));
  }
  return { failures, calls };
}

test('the Codex filename and check replace the old gate without an alias', () => {
  assert.equal(existsSync('.github/workflows/copilot-review-gate.yml'), false);
  const gate = workflow('codex-review-gate');
  assert.equal(gate.name, 'Codex review gate');
  assert.deepEqual(Object.keys(gate.jobs), ['codex-review-present']);
  assert.equal(gate.jobs['codex-review-present'].name, 'codex-review-present');
});

test('all PR bases receive open/head/reopen/ready and submitted/dismissed review events', () => {
  assert.deepEqual(workflow('codex-review-gate').on, {
    pull_request: { types: ['opened', 'synchronize', 'reopened', 'ready_for_review'] },
    pull_request_review: { types: ['submitted', 'dismissed'] },
  });
});

test('the gate uses only the inline read-only Action, with no checkout or event interpolation', () => {
  const gate = workflow('codex-review-gate');
  assert.deepEqual(gate.permissions, { 'pull-requests': 'read' });
  assert.deepEqual(gate.concurrency, {
    group: 'codex-review-gate-${{ github.event.pull_request.number }}',
    'cancel-in-progress': true,
  });
  const job = gate.jobs['codex-review-present'];
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job.if, undefined);
  assert.equal(job.permissions, undefined);
  assert.equal(job['continue-on-error'], undefined);
  assert.equal(job.steps.length, 1);
  assert.equal(job.steps[0].uses, 'actions/github-script@v7');
  assert.deepEqual(Object.keys(job.steps[0]).sort(), ['name', 'uses', 'with']);
  assert.deepEqual(Object.keys(job.steps[0].with), ['script']);
  assert.doesNotMatch(job.steps[0].with.script, /\$\{\{|\brequire\s*\(|\bimport\b/);
});

test('the normal CI job runs these exact tests after Node setup without adding privileged events', () => {
  const ci = workflow('ci');
  assert.deepEqual(ci.on, { push: { branches: ['main'] }, pull_request: null });
  const steps = ci.jobs['build-check-test'].steps;
  const index = steps.findIndex(
    (step) => step.run === 'node --test tools/codex-review-gate.test.mjs',
  );
  assert.ok(index > steps.findIndex((step) => step.uses === 'actions/setup-node@v4'));
  assert.equal(steps[index].if, undefined);
});

for (const state of ['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED']) {
  test(`accepts an actual Codex ${state} review object`, async () => {
    assert.deepEqual((await runGate([page([review(state)])])).failures, []);
  });
}

for (const [label, reviews] of [
  ['missing review', []],
  ['pending review', [review('PENDING')]],
  ['dismissed review', [review('DISMISSED')]],
  ['unknown state', [review('SUBMITTED')]],
  ['Copilot review', [review('APPROVED', 'copilot-pull-request-reviewer')]],
  ['human review', [review('COMMENTED', 'mike-north')]],
  ['guessed bot suffix', [review('COMMENTED', 'chatgpt-codex-connector[bot]')]],
  ['deleted author', [review('COMMENTED', null)]],
]) {
  test(`rejects ${label}`, async () => {
    assert.equal((await runGate([page(reviews)])).failures.length, 1);
  });
}

test('follows cursors to accept review evidence beyond the first 100 results', async () => {
  const result = await runGate([
    page(
      Array.from({ length: 100 }, () => review('COMMENTED', 'mike-north')),
      true,
      'cursor-100',
    ),
    page([review('CHANGES_REQUESTED')]),
  ]);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(
    result.calls.map(({ variables }) => variables),
    [
      { owner: 'mike-north', repo: 'sh-ast', number: 91, after: null },
      { owner: 'mike-north', repo: 'sh-ast', number: 91, after: 'cursor-100' },
    ],
  );
});

test('API failures fail closed, including a later page after matching evidence', async () => {
  for (const pages of [
    [new Error('API unavailable')],
    [page([review('COMMENTED')], true, 'cursor-100'), new Error('API unavailable')],
  ]) {
    assert.equal((await runGate(pages)).failures.length, 1);
  }
});

for (const response of [
  { repository: null },
  { repository: { pullRequest: null } },
  { repository: { pullRequest: { reviews: null } } },
  page(null),
  { repository: { pullRequest: { reviews: { nodes: [review('COMMENTED')] } } } },
  page([review('COMMENTED')], true, null),
]) {
  test(`fails closed for missing or incomplete API data: ${JSON.stringify(response)}`, async () => {
    assert.equal((await runGate([response])).failures.length, 1);
  });
}

test('a nonadvancing pagination cursor fails instead of hanging or accepting partial evidence', async () => {
  const result = await runGate([
    page([review('COMMENTED')], true, 'same'),
    page([review('COMMENTED')], true, 'same'),
  ]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.calls.length, 2);
});

test('PR review delivery queries the event PR in the base repo, not an issue or fork number', async () => {
  const result = await runGate([page([review('COMMENTED')])], {
    repo: { owner: 'mike-north', repo: 'sh-ast' },
    issue: { number: 700 },
    payload: {
      action: 'submitted',
      pull_request: { number: 98 },
      review: { body: 'other/repo#1' },
    },
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.calls[0].variables.number, 98);
  assert.equal(result.calls[0].variables.repo, 'sh-ast');
});

test('missing or invalid event PR identity fails before an API call', async () => {
  for (const number of [undefined, null, 0, -1, '91', 1.5]) {
    const result = await runGate([], {
      repo: { owner: 'mike-north', repo: 'sh-ast' },
      payload: { pull_request: { number } },
    });
    assert.equal(result.failures.length, 1);
    assert.equal(result.calls.length, 0);
  }
});
