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

/** A permissionless relay may route a PR number but cannot attest to any evidence. */
function relayContext(overrides = {}) {
  return {
    repo: { owner: 'mike-north', repo: 'sh-ast' },
    eventName: 'workflow_run',
    sha: defaultBranch,
    payload: {
      workflow_run: {
        name: 'Codex review event',
        path: '.github/workflows/codex-review-event.yml',
        event: 'pull_request_review',
        display_title: '99',
        pull_requests: [],
        head_sha: stale,
        conclusion: 'success',
        ...overrides,
      },
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

/** Missing evidence or known-head errors must complete the required check as failing. */
function assertFailure(result) {
  assert.ok(result.failures.length > 0);
  assert.equal(result.creates.length, 1);
  assert.equal(result.creates[0].head_sha, head);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].check_run_id, 7001);
  assert.equal(result.updates[0].status, 'completed');
  assert.equal(result.updates[0].conclusion, 'failure');
}

test('the required head check has its own name, distinct from the evaluator job', () => {
  assert.equal(existsSync('.github/workflows/copilot-review-gate.yml'), false);
  const gate = workflow('codex-review-gate');
  assert.equal(gate.name, 'Codex review gate');
  assert.deepEqual(Object.keys(gate.jobs), ['evaluate-codex-review']);
  assert.equal(gate.jobs['evaluate-codex-review'].name, 'Evaluate Codex review evidence');
});

test('only trusted lifecycle, comment, and review-relay completion events evaluate evidence', () => {
  assert.deepEqual(workflow('codex-review-gate').on, {
    pull_request_target: { types: ['opened', 'synchronize', 'reopened', 'ready_for_review'] },
    issue_comment: { types: ['created', 'edited', 'deleted'] },
    workflow_run: { workflows: ['Codex review event'], types: ['completed'] },
  });
});

test('the review relay has no permissions, secrets, checkout, imports, or PR-code execution', () => {
  const relay = workflow('codex-review-event');
  assert.deepEqual(Object.keys(relay).sort(), ['jobs', 'name', 'on', 'permissions', 'run-name']);
  assert.equal(relay.name, 'Codex review event');
  assert.equal(relay['run-name'], '${{ github.event.pull_request.number }}');
  assert.deepEqual(relay.on, { pull_request_review: { types: ['submitted', 'dismissed'] } });
  assert.deepEqual(relay.permissions, {});
  assert.deepEqual(relay.jobs, {
    signal: {
      'runs-on': 'ubuntu-latest',
      steps: [{ name: 'Record review-event delivery', run: ':' }],
    },
  });
});

test('minimal check-write permission never accompanies checkout, imports, or interpolated event text', () => {
  const gate = workflow('codex-review-gate');
  assert.deepEqual(gate.permissions, { 'pull-requests': 'read', checks: 'write' });
  assert.deepEqual(gate.concurrency, {
    group:
      'codex-review-gate-${{ github.event.pull_request.number || github.event.issue.number || github.event.workflow_run.display_title }}',
    'cancel-in-progress': false,
  });
  const job = gate.jobs['evaluate-codex-review'];
  assert.equal(job.if, "github.event_name != 'issue_comment' || github.event.issue.pull_request");
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job.permissions, undefined);
  assert.equal(job['continue-on-error'], undefined);
  assert.equal(job.steps.length, 1);
  assert.equal(job.steps[0].uses, 'actions/github-script@v7');
  assert.deepEqual(Object.keys(job.steps[0]).sort(), ['name', 'uses', 'with']);
  assert.deepEqual(Object.keys(job.steps[0].with), ['script']);
  assert.doesNotMatch(job.steps[0].with.script, /\$\{\{|\brequire\s*\(|\bimport\b|\beval\s*\(/);
});

test('the actual normal CI step runs this suite after Node setup without privileged CI events', () => {
  const ci = workflow('ci');
  assert.deepEqual(ci.on, { push: { branches: ['main'] }, pull_request: null });
  const steps = ci.jobs['build-check-test'].steps;
  const index = steps.findIndex(
    (step) => step.run === 'node --test tools/codex-review-gate.test.mjs',
  );
  const setup = steps.findIndex((step) => step.uses === 'actions/setup-node@v4');
  assert.ok(setup >= 0 && index > setup);
  assert.equal(steps[index].if, undefined);
});

test('the existing stacked-base validator recognizes the actual gate event', () => {
  execFileSync('ruby', ['design/validation/release-b/stacked-pr-workflows.rb']);
});

for (const login of ['chatgpt-codex-connector', 'chatgpt-codex-connector[bot]']) {
  for (const state of ['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED']) {
    test(`accepts ${login} ${state} review at the current head`, async () => {
      assertSuccess(await runGate({ reviews: [page('reviews', [review(state, head, login)])] }));
    });
  }
  test(`accepts ${login} current-head structured completion without any review object`, async () => {
    assertSuccess(
      await runGate({ comments: [page('comments', [completion(head, 'completed', login)])] }),
    );
  });
}

for (const [label, record] of [
  ['pending', review('PENDING')],
  ['dismissed', review('DISMISSED')],
  ['unknown state', review('SUBMITTED')],
  ['stale SHA', review('COMMENTED', stale)],
  ['abbreviated SHA', review('COMMENTED', head.slice(0, 10))],
  ['missing commit', { author: { login: 'chatgpt-codex-connector' }, state: 'COMMENTED' }],
  ['null commit', { ...review(), commit: null }],
  ['Copilot author', review('APPROVED', head, 'copilot-pull-request-reviewer')],
  ['human author', { ...review('APPROVED', head, 'mike-north'), body: 'chatgpt-codex-connector' }],
  ['deleted author', review('COMMENTED', head, null)],
]) {
  test(`rejects review with ${label}`, async () => {
    assertFailure(await runGate({ reviews: [page('reviews', [record])] }));
  });
}

for (const [label, record] of [
  ['stale SHA', completion(stale)],
  ['abbreviated SHA', completion(head.slice(0, 10))],
  ['missing SHA', completion(null)],
  ['pending status', completion(head, 'pending')],
  ['running status', completion(head, 'in_progress')],
  ['missing status', completion(head, null)],
  [
    'human author claiming bot identity',
    { ...completion(head, 'completed', 'mike-north'), login: 'chatgpt-codex-connector' },
  ],
  ['deleted author', completion(head, 'completed', null)],
  ['other bot author', completion(head, 'completed', 'copilot-pull-request-reviewer')],
  [
    'abbreviated receipt',
    {
      ...completion(),
      body: `<!-- codex-review-receipt:v1 -->\nReviewed commit: ${head.slice(0, 10)}`,
    },
  ],
  [
    'unstructured identity/SHA prose',
    { ...completion(), body: `chatgpt-codex-connector completed review ${head}` },
  ],
  ['malformed JSON', { ...completion(), body: '<!-- codex-review-state:v1 {invalid} -->' }],
  ['null JSON', { ...completion(), body: '<!-- codex-review-state:v1 null -->' }],
  ['unknown version', { ...completion(), body: completion().body.replace(':v1', ':v2') }],
  [
    'security review only',
    {
      ...completion(),
      body: `<!-- codex-review-state:v1 ${JSON.stringify({ security_review: { commit_sha: head, status: 'completed' } })} -->`,
    },
  ],
  [
    'conflicting metadata blocks',
    { ...completion(), body: `${completion().body}\n${completion(stale).body}` },
  ],
]) {
  test(`rejects completion comment with ${label}`, async () => {
    assertFailure(await runGate({ comments: [page('comments', [record])] }));
  });
}

test('missing review and comment evidence produces a failing head check', async () => {
  assertFailure(await runGate());
});

test('presence is not finding resolution: completed metadata may report findings', async () => {
  const record = completion();
  record.body = record.body
    .replace('"has_any_findings":false', '"has_any_findings":true')
    .replace('"has_unresolved_findings":false', '"has_unresolved_findings":true');
  assertSuccess(await runGate({ comments: [page('comments', [record])] }));
});

test('stale evidence does not suppress valid current-head evidence in the other path', async () => {
  assertSuccess(
    await runGate({
      reviews: [page('reviews', [review('COMMENTED', stale)])],
      comments: [page('comments', [completion()])],
    }),
  );
  assertSuccess(
    await runGate({
      reviews: [page('reviews', [review()])],
      comments: [page('comments', [completion(stale)])],
    }),
  );
});

for (const field of ['reviews', 'comments']) {
  test(`paginates ${field} beyond 100 unrelated records`, async () => {
    const other =
      field === 'reviews'
        ? review('COMMENTED', head, 'mike-north')
        : completion(head, 'completed', 'mike-north');
    const valid = field === 'reviews' ? review() : completion();
    const result = await runGate({
      [field]: [
        page(
          field,
          Array.from({ length: 100 }, () => other),
          true,
          'cursor-100',
        ),
        page(field, [valid]),
      ],
    });
    assertSuccess(result);
    assert.deepEqual(
      result.queries.filter((call) => call.field === field).map(({ variables }) => variables),
      [
        { owner: 'mike-north', repo: 'sh-ast', number: 91, after: null },
        { owner: 'mike-north', repo: 'sh-ast', number: 91, after: 'cursor-100' },
      ],
    );
  });
  test(`${field} API errors fail the head check even after matching earlier data`, async () => {
    const valid = field === 'reviews' ? review() : completion();
    for (const pages of [
      [new Error('API unavailable')],
      [page(field, [valid], true, 'next'), new Error('API unavailable')],
    ]) {
      assertFailure(await runGate({ [field]: pages }));
    }
  });
  test(`${field} pagination fails on missing or cyclic cursors`, async () => {
    for (const pages of [
      [page(field, [], true, null)],
      [page(field, [], true, 'same'), page(field, [], true, 'same')],
      [page(field, [], true, 'one'), page(field, [], true, 'two'), page(field, [], true, 'one')],
    ])
      assertFailure(await runGate({ [field]: pages }));
  });
  test(`${field} response schema and head identity must remain complete`, async () => {
    for (const response of [
      { repository: null },
      { repository: { pullRequest: null } },
      { repository: { pullRequest: { headRefOid: head } } },
      page(field, null),
      page(field, [], 'false'),
      page(field, [], false, null, stale),
    ])
      assertFailure(await runGate({ [field]: [response] }));
  });
}

test('comments API failure invalidates partial success from the review path', async () => {
  assertFailure(
    await runGate({
      reviews: [page('reviews', [review()])],
      comments: [new Error('API unavailable')],
    }),
  );
});

for (const action of ['created', 'edited', 'deleted']) {
  test(`issue_comment ${action} writes the required check on the API current head`, async () => {
    const result = await runGate({
      context: commentContext(action),
      comments: [page('comments', [completion()])],
    });
    assertSuccess(result);
    assert.equal(result.reads[0].pull_number, 98);
    assert.notEqual(result.creates[0].head_sha, defaultBranch);
    assert.notEqual(result.creates[0].head_sha, stale);
    assert.equal(result.queries[0].variables.number, 98);
  });
}

test('a valid-looking triggering payload is not evidence if absent from the current API records', async () => {
  const context = commentContext('deleted');
  context.payload.comment = { user: { login: 'chatgpt-codex-connector' }, body: completion().body };
  assertFailure(await runGate({ context }));
});

test('ordinary issues cannot be treated as PRs or create a required check', async () => {
  const context = commentContext();
  delete context.payload.issue.pull_request;
  const result = await runGate({ context });
  assert.deepEqual(result.creates, []);
  assert.deepEqual(result.reads, []);
  assert.deepEqual(result.queries, []);
});

test('review relay delivery re-reads PR head and evidence without trusting fork/default event SHAs', async () => {
  const result = await runGate({ reviews: [page('reviews', [review()])], context: relayContext() });
  assertSuccess(result);
  assert.deepEqual(result.reads, [
    { owner: 'mike-north', repo: 'sh-ast', pull_number: 99 },
    { owner: 'mike-north', repo: 'sh-ast', pull_number: 99 },
  ]);
  assert.equal(result.queries[0].variables.number, 99);
  assert.equal(result.queries[0].variables.repo, 'sh-ast');
});

test('relay routing is independent of fork PR association arrays, artifacts, and head metadata', async () => {
  const result = await runGate({
    comments: [page('comments', [completion()])],
    context: relayContext({
      display_title: '98',
      pull_requests: [{ number: 700, head: { sha: stale } }],
      artifacts_url: 'https://untrusted.invalid/evidence.zip',
      head_repository: { full_name: 'other/fork' },
    }),
  });
  assertSuccess(result);
  assert.equal(result.reads[0].pull_number, 98);
  assert.equal(result.creates[0].head_sha, head);
});

test('relay success and claimed bot completion in payload never substitute for live evidence', async () => {
  const context = relayContext({
    conclusion: 'success',
    head_sha: head,
    review: review(),
    comment: completion(),
    author: { login: 'chatgpt-codex-connector' },
  });
  assertFailure(await runGate({ context }));
});

test('a failed relay conclusion does not veto valid current API evidence', async () => {
  assertSuccess(
    await runGate({
      context: relayContext({ conclusion: 'failure' }),
      reviews: [page('reviews', [review()])],
    }),
  );
});

test('unexpected relay identity or nondecimal PR routing fails before API access', async () => {
  const bad = [
    { name: 'Other workflow' },
    { path: '.github/workflows/ci.yml' },
    { event: 'pull_request' },
    ...[
      undefined,
      null,
      '',
      'PR #99',
      '99; echo unsafe',
      '099',
      '0',
      '-1',
      '1.5',
      '9007199254740992',
    ].map((display_title) => ({ display_title })),
  ];
  for (const overrides of bad) {
    const result = await runGate({ context: relayContext(overrides) });
    assert.ok(result.failures.length > 0);
    assert.deepEqual(result.reads, []);
    assert.deepEqual(result.queries, []);
    assert.deepEqual(result.creates, []);
  }
});

test('the privileged evaluator refuses direct PR-merge review events', async () => {
  const result = await runGate({
    context: {
      repo: { owner: 'mike-north', repo: 'sh-ast' },
      eventName: 'pull_request_review',
      payload: { pull_request: { number: 99 } },
    },
  });
  assert.ok(result.failures.length > 0);
  assert.deepEqual(result.reads, []);
  assert.deepEqual(result.creates, []);
});

test('a head change before success completes the old-head check as failure', async () => {
  const result = await runGate({ reviews: [page('reviews', [review()])], finalHead: stale });
  assertFailure(result);
  assert.equal(result.trace.at(-2), 'pulls.get');
  assert.equal(result.trace.at(-1), 'checks.update');
});

test('head lookup and check-write errors never produce successful conclusions', async () => {
  for (const options of [
    { initialHead: new Error('head lookup failed') },
    { finalHead: new Error('head lookup failed') },
    { createError: new Error('check create failed') },
    { updateError: new Error('check update failed') },
  ]) {
    const result = await runGate({ ...options, reviews: [page('reviews', [review()])] });
    assert.ok(result.failures.length > 0);
    assert.equal(
      result.published.some((update) => update.conclusion === 'success'),
      false,
    );
  }
});

test('invalid API head identity cannot create a check on a fallback SHA', async () => {
  for (const initialHead of [null, 'main', '1234567', '']) {
    const result = await runGate({ initialHead });
    assert.ok(result.failures.length > 0);
    assert.deepEqual(result.creates, []);
  }
});

test('missing or invalid event PR identity fails before any API or check write', async () => {
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
