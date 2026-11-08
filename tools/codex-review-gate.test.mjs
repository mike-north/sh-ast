/**
 * Handwritten outcomes execute the script embedded in the real gate workflow.
 * Fixtures describe API records independently of gate policy, rather than
 * duplicating its predicate. Ruby's standard YAML reader avoids an npm dependency.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

/** Distinct current, stale, and default-branch SHAs expose check-target mistakes. */
const head = '1234567890abcdef1234567890abcdef12345678';
const stale = 'abcdef1234567890abcdef1234567890abcdef12';
const defaultBranch = '9876543210abcdef9876543210abcdef98765432';

/** Parse workflow configuration and its executable block with standard YAML. */
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

/** GraphQL connection shape includes API-owned head identity on every page. */
function page(field, nodes, hasNextPage = false, endCursor = null, sha = head) {
  return {
    repository: {
      pullRequest: { headRefOid: sha, [field]: { nodes, pageInfo: { hasNextPage, endCursor } } },
    },
  };
}

/** A review's API author and commit are independent of its body text. */
function review(state = 'COMMENTED', sha = head, login = 'chatgpt-codex-connector') {
  return { author: login === null ? null : { login }, state, commit: { oid: sha } };
}

/** Structured metadata represents a finished code review, independent of findings. */
function completion(sha = head, status = 'completed', login = 'chatgpt-codex-connector') {
  return {
    author: login === null ? null : { login },
    body: `<!-- codex-review-state:v1 ${JSON.stringify({
      code_review: {
        commit_sha: sha,
        has_any_findings: false,
        has_unresolved_findings: false,
        status,
      },
      security_review: { status: null, commit_sha: null },
    })} -->`,
  };
}

/** Comment delivery carries a default-branch event SHA, never a usable PR head. */
function commentContext(action = 'created') {
  return {
    repo: { owner: 'mike-north', repo: 'sh-ast' },
    eventName: 'issue_comment',
    sha: defaultBranch,
    payload: {
      action,
      issue: { number: 98, pull_request: { url: 'metadata-only' } },
      comment: { user: { login: 'mike-north' }, body: '@codex review' },
    },
  };
}

/**
 * Emulate github-script globals, recording API identity and every check write.
 * Exceptions are Action failures, including errors after partial matching data.
 */
async function runGate({
  reviews = [page('reviews', [])],
  comments = [page('comments', [])],
  context = {
    repo: { owner: 'mike-north', repo: 'sh-ast' },
    eventName: 'pull_request_target',
    sha: defaultBranch,
    payload: {
      action: 'synchronize',
      pull_request: { number: 91, head: { sha: stale, repo: { full_name: 'other/fork' } } },
    },
  },
  initialHead = head,
  finalHead = head,
  createError,
  updateError,
} = {}) {
  const script = Object.values(workflow('codex-review-gate').jobs)[0].steps[0].with.script;
  const failures = [],
    queries = [],
    reads = [],
    creates = [],
    updates = [],
    published = [],
    trace = [];
  const queues = { reviews: [...reviews], comments: [...comments] };
  const github = {
    rest: {
      pulls: {
        get: async (params) => {
          reads.push(params);
          trace.push('pulls.get');
          const sha = reads.length === 1 ? initialHead : finalHead;
          if (sha instanceof Error) throw sha;
          return { data: { number: params.pull_number, head: { sha } } };
        },
      },
      checks: {
        create: async (params) => {
          creates.push(params);
          trace.push('checks.create');
          if (createError) throw createError;
          return { data: { id: 7001 } };
        },
        update: async (params) => {
          updates.push(params);
          trace.push('checks.update');
          if (updateError) throw updateError;
          published.push(params);
          return { data: { id: 7001 } };
        },
      },
    },
    graphql: async (query, variables) => {
      const field = query.includes('comments(first:') ? 'comments' : 'reviews';
      queries.push({ field, query, variables });
      trace.push(`graphql.${field}`);
      assert.match(query, /query\b/);
      assert.doesNotMatch(query, /\bmutation\b/);
      assert.match(query, /repository\(owner: \$owner, name: \$repo\)/);
      assert.match(query, /pullRequest\(number: \$number\)/);
      assert.match(query, new RegExp(`${field}\\(first: 100, after: \\$after\\)`));
      assert.match(query, /author\s*\{\s*login\s*\}/);
      assert.match(query, /\bheadRefOid\b/);
      if (field === 'reviews') {
        assert.match(query, /\bstate\b/);
        assert.match(query, /commit\s*\{\s*oid\s*\}/);
      } else assert.match(query, /\bbody\b/);
      assert.match(query, /pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/);
      assert.ok(queues[field].length, `unexpected extra ${field} request`);
      const response = queues[field].shift();
      if (response instanceof Error) throw response;
      return response;
    },
  };
  const core = { setFailed: (message) => failures.push(message), info: () => {} };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  try {
    await new AsyncFunction('github', 'context', 'core', script)(github, context, core);
  } catch (error) {
    failures.push(String(error));
  }
  return { failures, queries, reads, creates, updates, published, trace };
}

/** Every pass must be a completed required check on the current PR head. */
function assertSuccess(result) {
  assert.deepEqual(result.failures, []);
  assert.equal(result.creates.length, 1);
  assert.equal(result.creates[0].name, 'codex-review-present');
  assert.equal(result.creates[0].head_sha, head);
  assert.equal(result.creates[0].status, 'in_progress');
  assert.equal(result.creates[0].owner, 'mike-north');
  assert.equal(result.creates[0].repo, 'sh-ast');
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].check_run_id, 7001);
  assert.equal(result.updates[0].status, 'completed');
  assert.equal(result.updates[0].conclusion, 'success');
  assert.equal(result.updates[0].owner, 'mike-north');
  assert.equal(result.updates[0].repo, 'sh-ast');
}

/** Infrastructure errors must fail both the evaluator and the head-bound check. */
function assertFailure(result) {
  assert.ok(result.failures.length > 0);
  assert.equal(result.creates.length, 1);
  assert.equal(result.creates[0].head_sha, head);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].check_run_id, 7001);
  assert.equal(result.updates[0].status, 'completed');
  assert.equal(result.updates[0].conclusion, 'failure');
}

/**
 * Receipts use the actual bot's Markdown field observed on PR #98. Prefix
 * boundaries below are handwritten requirements, independent of the evaluator.
 */
function receipt(sha = head.slice(0, 10), login = 'chatgpt-codex-connector') {
  return {
    author: login === null ? null : { login },
    body: `<!-- codex-review-receipt:v1 -->\n\nCodex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${sha}\`\n`,
  };
}

/** Absence is a review decision, not a broken evaluator or duplicate job verdict. */
function assertMissing(result, expectedHead = head) {
  assert.deepEqual(result.failures, []);
  assert.equal(result.creates.length, 1);
  assert.equal(result.creates[0].name, 'codex-review-present');
  assert.equal(result.creates[0].head_sha, expectedHead);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].check_run_id, 7001);
  assert.equal(result.updates[0].conclusion, 'failure');
  assert.equal(result.updates[0].status, 'completed');
}

/** Native evaluator health remains distinct from the explicit review decision. */
test('one explicit decision context never shares its name with a successful native job', () => {
  const gate = workflow('codex-review-gate');
  assert.equal(gate.name, 'Codex review gate');
  assert.deepEqual(Object.keys(gate.jobs), ['evaluate-codex-review']);
  const job = gate.jobs['evaluate-codex-review'];
  assert.equal(job.name, 'Evaluate Codex review evidence');
  assert.equal(job['continue-on-error'], undefined);
  assert.equal(job.steps.length, 1);
  assert.equal(job.steps[0]['continue-on-error'], undefined);
});

test('only trusted lifecycle and conversation comment events route evaluations', () => {
  assert.deepEqual(workflow('codex-review-gate').on, {
    pull_request_target: { types: ['opened', 'synchronize', 'reopened', 'ready_for_review'] },
    issue_comment: { types: ['created', 'edited', 'deleted'] },
  });
  assert.equal(existsSync('.github/workflows/codex-review-event.yml'), false);
  assert.equal(existsSync('.github/workflows/copilot-review-gate.yml'), false);
});

test('minimal check permissions never accompany checkout, imports or executable PR text', () => {
  const gate = workflow('codex-review-gate');
  assert.deepEqual(gate.permissions, { 'pull-requests': 'read', checks: 'write' });
  assert.deepEqual(gate.concurrency, {
    group: 'codex-review-gate-${{ github.event.pull_request.number || github.event.issue.number }}',
    'cancel-in-progress': false,
  });
  const job = gate.jobs['evaluate-codex-review'];
  assert.equal(job.if, "github.event_name != 'issue_comment' || github.event.issue.pull_request");
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job.permissions, undefined);
  assert.equal(job.steps[0].uses, 'actions/github-script@v7');
  assert.deepEqual(Object.keys(job.steps[0]).sort(), ['name', 'uses', 'with']);
  assert.deepEqual(Object.keys(job.steps[0].with), ['script']);
  assert.doesNotMatch(job.steps[0].with.script, /\$\{\{|\brequire\s*\(|\bimport\b|\beval\s*\(/);
});

test('normal CI runs the actual workflow harness after Node setup', () => {
  const ci = workflow('ci');
  assert.deepEqual(ci.on, { push: { branches: ['main'] }, pull_request: null });
  const steps = ci.jobs['build-check-test'].steps;
  const index = steps.findIndex(
    (step) => step.run === 'node --test tools/codex-review-gate.test.mjs',
  );
  assert.ok(index > steps.findIndex((step) => step.uses === 'actions/setup-node@v4'));
  assert.equal(steps[index].if, undefined);
  execFileSync('ruby', ['design/validation/release-b/stacked-pr-workflows.rb']);
});

for (const login of ['chatgpt-codex-connector', 'chatgpt-codex-connector[bot]']) {
  test(`accepts ${login} structured current-head completion with either finding flag`, async () => {
    for (const flags of [false, true]) {
      const record = completion(head, 'completed', login);
      record.body = record.body.replaceAll('false', String(flags));
      assertSuccess(await runGate({ comments: [page('comments', [record])] }));
    }
  });
  for (const length of [7, 8, 10, 39, 40]) {
    test(`accepts ${login} receipt hexadecimal prefix of length ${length}`, async () => {
      assertSuccess(
        await runGate({ comments: [page('comments', [receipt(head.slice(0, length), login)])] }),
      );
    });
  }
}

test('receipt hexadecimal case does not change commit identity', async () => {
  assertSuccess(await runGate({ comments: [page('comments', [receipt(head.toUpperCase())])] }));
});

for (const make of [completion, receipt]) {
  for (const login of [
    'mike-north',
    'copilot-pull-request-reviewer',
    'chatgpt-codex-connector[bot][bot]',
    'chatgpt-codex-connector-bot',
    'Chatgpt-codex-connector',
    '',
    null,
  ]) {
    test(`${make.name} rejects actual author ${login} despite claimed identity`, async () => {
      const record = make(undefined, ...(make === completion ? ['completed', login] : [login]));
      record.body += '\nAuthor: chatgpt-codex-connector';
      assertMissing(await runGate({ comments: [page('comments', [record])] }));
    });
  }
}

for (const length of [0, 1, 2, 3, 4, 5, 6, 41]) {
  test(`rejects receipt prefix length ${length}`, async () => {
    assertMissing(
      await runGate({ comments: [page('comments', [receipt((head + '0').slice(0, length))])] }),
    );
  });
}
for (const sha of [
  stale,
  stale.slice(0, 7),
  '123456g',
  '1234567x',
  '1234567;echo',
  ' 1234567',
  '1234567 ',
  '0x1234567',
]) {
  test(`rejects nonmatching or invalid receipt token ${sha}`, async () => {
    assertMissing(await runGate({ comments: [page('comments', [receipt(sha)])] }));
  });
}

for (const [label, record] of [
  ['stale state', completion(stale)],
  ['abbreviated state', completion(head.slice(0, 10))],
  ['missing SHA', completion(null)],
  ['pending state', completion(head, 'pending')],
  ['running state', completion(head, 'in_progress')],
  ['missing status', completion(head, null)],
  ['malformed JSON', { ...completion(), body: '<!-- codex-review-state:v1 {invalid} -->' }],
  ['null JSON', { ...completion(), body: '<!-- codex-review-state:v1 null -->' }],
  ['unknown version', { ...completion(), body: completion().body.replace(':v1', ':v2') }],
  [
    'security only',
    {
      ...completion(),
      body: `<!-- codex-review-state:v1 {"security_review":{"commit_sha":"${head}","status":"completed"}} -->`,
    },
  ],
  ['prose only', { ...completion(), body: `Codex completed code review ${head}` }],
  ['duplicate states', { ...completion(), body: completion().body + '\n' + completion().body }],
  [
    'valid plus malformed state',
    { ...completion(), body: completion().body + '\n<!-- codex-review-state:v1 invalid -->' },
  ],
  [
    'missing receipt marker',
    { ...receipt(), body: receipt().body.replace('<!-- codex-review-receipt:v1 -->', '') },
  ],
  [
    'malformed receipt marker',
    { ...receipt(), body: receipt().body.replace(':v1 -->', ':v1 extra -->') },
  ],
  ['unknown receipt version', { ...receipt(), body: receipt().body.replace(':v1', ':v2') }],
  ['missing receipt field', { ...receipt(), body: '<!-- codex-review-receipt:v1 -->' }],
  [
    'unformatted receipt field',
    { ...receipt(), body: `<!-- codex-review-receipt:v1 -->\nReviewed commit: ${head}` },
  ],
  ['duplicate receipts', { ...receipt(), body: receipt().body + receipt().body }],
  [
    'duplicate receipt fields',
    { ...receipt(), body: receipt().body + `\n**Reviewed commit:** \`${stale}\`` },
  ],
  ['mixed evidence markers', { ...receipt(), body: receipt().body + completion().body }],
  [
    'valid plus malformed receipt marker',
    { ...receipt(), body: receipt().body + '\n<!-- codex-review-receipt:v1 extra -->' },
  ],
  [
    'valid plus malformed receipt field',
    { ...receipt(), body: receipt().body + '\n**Reviewed commit:** invalid' },
  ],
]) {
  test(`rejects ${label} without failing the evaluator`, async () => {
    assertMissing(await runGate({ comments: [page('comments', [record])] }));
  });
}

test('submitted review objects never supply evidence and are never requested', async () => {
  for (const state of ['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'PENDING', 'DISMISSED']) {
    const result = await runGate({ reviews: [page('reviews', [review(state)])] });
    assertMissing(result);
    assert.deepEqual(
      result.queries.map((call) => call.field),
      ['comments'],
    );
    assert.doesNotMatch(result.queries[0].query, /\breviews\b|\bcommit\s*\{/);
  }
});

test('missing evidence fails only the explicit check while API failure also fails evaluator', async () => {
  assertMissing(await runGate());
  assertFailure(await runGate({ comments: [new Error('API unavailable')] }));
});

test('all comment pages are requested even after a match', async () => {
  const result = await runGate({
    comments: [
      page('comments', [receipt()], true, 'cursor-100'),
      page(
        'comments',
        Array.from({ length: 100 }, () => completion(stale)),
        true,
        'cursor-200',
      ),
      page('comments', [completion()]),
    ],
  });
  assertSuccess(result);
  assert.deepEqual(
    result.queries.map(({ field, variables }) => ({ field, variables })),
    [null, 'cursor-100', 'cursor-200'].map((after) => ({
      field: 'comments',
      variables: { owner: 'mike-north', repo: 'sh-ast', number: 91, after },
    })),
  );
});

test('later-page match is found after 100 unrelated comments', async () => {
  assertSuccess(
    await runGate({
      comments: [
        page(
          'comments',
          Array.from({ length: 100 }, () => completion(stale)),
          true,
          'next',
        ),
        page('comments', [receipt()]),
      ],
    }),
  );
});

test('API and pagination failures cannot be hidden by an earlier matching comment', async () => {
  for (const pages of [
    [new Error('API unavailable')],
    [page('comments', [receipt()], true, 'next'), new Error('API unavailable')],
    [page('comments', [receipt()], true, null)],
    [page('comments', [receipt()], true, 'same'), page('comments', [], true, 'same')],
    [
      page('comments', [], true, 'one'),
      page('comments', [], true, 'two'),
      page('comments', [], true, 'one'),
    ],
  ])
    assertFailure(await runGate({ comments: pages }));
});

test('incomplete connection shapes and missing or invalid page heads fail the evaluator', async () => {
  for (const response of [
    { repository: null },
    { repository: { pullRequest: null } },
    { repository: { pullRequest: { headRefOid: head } } },
    page('comments', null),
    page('comments', [], 'false'),
    page('comments', [], false, null, null),
    page('comments', [], false, null, 'not-a-sha'),
  ])
    assertFailure(await runGate({ comments: [response] }));
});

for (const action of ['created', 'edited', 'deleted']) {
  test(`issue_comment ${action} uses only fresh comments at the API current head`, async () => {
    const result = await runGate({
      context: commentContext(action),
      comments: [page('comments', [receipt()])],
    });
    assertSuccess(result);
    assert.equal(result.reads[0].pull_number, 98);
    assert.notEqual(result.creates[0].head_sha, defaultBranch);
    assert.notEqual(result.creates[0].head_sha, stale);
    assert.equal(result.queries[0].variables.number, 98);
  });
}

test('triggering comment payload never substitutes for a deleted API record', async () => {
  const context = commentContext('deleted');
  context.payload.comment = { user: { login: 'chatgpt-codex-connector' }, body: receipt().body };
  assertMissing(await runGate({ context }));
});

test('ordinary issues create no checks and perform no API requests', async () => {
  const context = commentContext();
  delete context.payload.issue.pull_request;
  const result = await runGate({ context });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.creates, []);
  assert.deepEqual(result.reads, []);
  assert.deepEqual(result.queries, []);
});

for (const eventName of ['workflow_run', 'pull_request_review', 'pull_request', 'push']) {
  test(`rejects removed or untrusted ${eventName} route before API access`, async () => {
    const result = await runGate({
      context: {
        repo: { owner: 'mike-north', repo: 'sh-ast' },
        eventName,
        payload: { pull_request: { number: 99 } },
      },
    });
    assert.ok(result.failures.length > 0);
    assert.deepEqual(result.reads, []);
    assert.deepEqual(result.creates, []);
  });
}

/** Exact independent-review inputs distinguish ordinary synchronization from API breakage. */
const raceHead = 'c3c51d4af2e7cad9d784db0422e138be97d312a9';
const changedHead = '4af89865ad34a4304b19b42263dfd40234f67400';
const raceReceipt = {
  author: { login: 'chatgpt-codex-connector' },
  body: '<!-- codex-review-receipt:v1 -->\n\n**Reviewed commit:** `c3c51d4`\n',
};

test('ordinary final-read head change fails only the original head check', async () => {
  const result = await runGate({
    context: commentContext(),
    initialHead: raceHead,
    finalHead: changedHead,
    comments: [page('comments', [raceReceipt], false, null, raceHead)],
  });
  assertMissing(result, raceHead);
  assert.deepEqual(result.trace, [
    'pulls.get',
    'checks.create',
    'graphql.comments',
    'pulls.get',
    'checks.update',
  ]);
  assert.equal(
    result.published.some((update) => update.conclusion === 'success'),
    false,
  );
});

test('ordinary pagination head change fails only the original head check', async () => {
  const result = await runGate({
    context: commentContext(),
    initialHead: raceHead,
    comments: [
      page('comments', [raceReceipt], true, 'page-2', raceHead),
      page('comments', [raceReceipt], false, null, changedHead),
    ],
  });
  assertMissing(result, raceHead);
  assert.deepEqual(result.trace, [
    'pulls.get',
    'checks.create',
    'graphql.comments',
    'graphql.comments',
    'checks.update',
  ]);
  assert.equal(result.queries[1].variables.after, 'page-2');
  assert.equal(
    result.published.some((update) => update.conclusion === 'success'),
    false,
  );
});

test('a changed page head cannot hide malformed records or nonadvancing pagination', async () => {
  for (const response of [
    page('comments', null, false, null, changedHead),
    page('comments', [], 'false', null, changedHead),
    page('comments', [{ ...raceReceipt, body: null }], false, null, changedHead),
    page('comments', [], true, null, changedHead),
    page('comments', [], true, 'page-2', changedHead),
  ]) {
    assertFailure(
      await runGate({
        comments: [page('comments', [receipt()], true, 'page-2'), response],
      }),
    );
  }
});

test('pagination continues after a valid head change so later API failures stay red', async () => {
  assertFailure(
    await runGate({
      comments: [
        page('comments', [receipt()], true, 'page-2'),
        page('comments', [], true, 'page-3', changedHead),
        new Error('API unavailable after changed head'),
      ],
    }),
  );
});

test('missing or invalid final head after a match is an infrastructure failure', async () => {
  for (const finalHead of [undefined, null, '', 'not-a-sha', '1234567']) {
    // An omitted option uses the normal fixture default; null models a missing API value.
    assertFailure(
      await runGate({ finalHead: finalHead ?? null, comments: [page('comments', [receipt()])] }),
    );
  }
});

test('failure to write a stale-head check remains an evaluator failure', async () => {
  for (const options of [
    { finalHead: changedHead, comments: [page('comments', [receipt()])] },
    { comments: [page('comments', [receipt()], false, null, changedHead)] },
  ]) {
    const result = await runGate({
      ...options,
      updateError: new Error('stale check write failed'),
    });
    assertFailure(result);
    assert.deepEqual(result.published, []);
  }
});

test('receipt at an old head is absent evidence after the head changes', async () => {
  assertMissing(await runGate({ comments: [page('comments', [receipt(stale.slice(0, 10))])] }));
});

test('head lookup and check-write failures never publish success', async () => {
  for (const options of [
    { initialHead: new Error('head lookup failed') },
    { finalHead: new Error('head lookup failed') },
    { createError: new Error('check create failed') },
    { updateError: new Error('check update failed') },
  ]) {
    const result = await runGate({ ...options, comments: [page('comments', [receipt()])] });
    assert.ok(result.failures.length > 0);
    assert.equal(
      result.published.some((update) => update.conclusion === 'success'),
      false,
    );
  }
});

test('invalid API head cannot fall back to event head identity', async () => {
  for (const initialHead of [null, 'main', '1234567', '']) {
    const result = await runGate({ initialHead });
    assert.ok(result.failures.length > 0);
    assert.deepEqual(result.creates, []);
  }
});

test('invalid event PR identity fails before API or check writes', async () => {
  for (const number of [undefined, null, 0, -1, '91', 1.5]) {
    const result = await runGate({
      context: {
        repo: { owner: 'mike-north', repo: 'sh-ast' },
        eventName: 'pull_request_target',
        payload: { pull_request: { number } },
      },
    });
    assert.ok(result.failures.length > 0);
    assert.deepEqual(result.creates, []);
    assert.deepEqual(result.queries, []);
    assert.deepEqual(result.reads, []);
  }
});

test('malformed comment records cannot hide behind a valid receipt on any page', async () => {
  for (const invalid of [
    null,
    7,
    {},
    { ...completion(), body: null },
    { ...completion(), author: {} },
    { ...completion(), author: { login: null } },
  ]) {
    assertFailure(await runGate({ comments: [page('comments', [receipt(), invalid])] }));
    assertFailure(
      await runGate({
        comments: [page('comments', [receipt()], true, 'next'), page('comments', [invalid])],
      }),
    );
  }
});
