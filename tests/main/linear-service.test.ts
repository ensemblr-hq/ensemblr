import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	type LinearClient,
	type LinearIssueData,
	type LinearPage,
	type LinearResourceData,
	LinearServiceError,
} from '../../src/main/linear/linear-client.ts';
import { createLinearService } from '../../src/main/linear/linear-service.ts';
import {
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import type { LinearAccountSnapshot } from '../../src/shared/ipc/contracts/linear.ts';

const NOW = new Date('2026-06-11T00:00:00.000Z');
const ACCOUNT = 'account-1';
const OTHER_ACCOUNT = 'account-2';

/**
 * The account snapshots the service lists. Ids are what the cache rows and the
 * per-account clients are keyed by, so a fixture needs matching rows in SQLite.
 */
function accountSnapshot(
	id: string,
	organizationName: string,
): LinearAccountSnapshot {
	return {
		expiresAt: null,
		id,
		lastErrorCode: null,
		organizationId: `org-${id}`,
		organizationName,
		organizationUrlKey: organizationName.toLowerCase(),
		scopes: ['read', 'write'],
		state: 'connected',
		updatedAt: NOW.toISOString(),
		userEmail: 'alice@example.com',
		userId: `viewer-${id}`,
		userName: 'Alice',
	};
}

function createDatabaseServiceFixture(t: TestContext): EnsemblrDatabaseService {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-linear-svc-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'linear-svc-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	const insertAccount = connection.database.prepare(
		`INSERT INTO linear_accounts (id, organization_id, organization_name, user_id)
		 VALUES (?, ?, ?, ?)`,
	);
	insertAccount.run(ACCOUNT, `org-${ACCOUNT}`, 'Example Org', 'viewer-1');
	insertAccount.run(
		OTHER_ACCOUNT,
		`org-${OTHER_ACCOUNT}`,
		'Client Co',
		'viewer-2',
	);

	return {
		close: () => {},
		getConnection: () => connection,
		getHealth: () => ({
			path: connection.path,
			schemaVersion: connection.schemaVersion,
			status: 'ok',
		}),
		open: () => ({
			path: connection.path,
			schemaVersion: connection.schemaVersion,
			status: 'ok',
		}),
	};
}

function createIssueData(
	overrides: Partial<LinearIssueData> = {},
): LinearIssueData {
	return {
		archivedAt: null,
		assignee: { id: 'user-1', name: 'Alice' },
		cycle: { id: 'cycle-1', name: 'Cycle 12' },
		description: 'Fix OAuth.',
		dueDate: null,
		labels: [{ color: '#f00', id: 'label-1', name: 'bug' }],
		id: 'issue-1',
		identifier: 'ENG-143',
		priority: 1,
		project: { id: 'project-1', name: 'Ensemblr' },
		state: { color: '#888', id: 'state-1', name: 'Todo', type: 'unstarted' },
		team: { id: 'team-1', key: 'THE', name: 'Theseus' },
		title: 'Linear OAuth',
		updatedAt: '2026-06-10T12:00:00.000Z',
		url: 'https://linear.app/acme/issue/ENG-143',
		...overrides,
	};
}

function page<T>(nodes: T[], endCursor: string | null = null): LinearPage<T> {
	return { endCursor, hasNextPage: endCursor !== null, nodes };
}

interface FakeClientOptions {
	issuePages?: LinearPage<LinearIssueData>[];
	listIssuesError?: LinearServiceError;
	searchResults?: LinearIssueData[];
	metadata?: Partial<
		Record<
			'cycle' | 'label' | 'project' | 'state' | 'team' | 'user',
			LinearResourceData[]
		>
	>;
}

function createFakeClient(options: FakeClientOptions = {}) {
	const calls: string[] = [];
	const issuePages = options.issuePages ?? [page([createIssueData()])];
	let issuePageIndex = 0;

	const client: LinearClient = {
		createComment: async ({ body }) => {
			calls.push('createComment');
			return {
				authorName: 'Alice',
				body,
				createdAt: NOW.toISOString(),
				id: 'comment-9',
			};
		},
		createIssue: async (input) => {
			calls.push('createIssue');
			return createIssueData({
				id: 'issue-new',
				identifier: 'ENG-200',
				title: input.title,
			});
		},
		getIssue: async (id) => {
			calls.push(`getIssue:${id}`);
			return {
				comments: page([
					{
						authorName: 'Bob',
						body: 'A comment',
						createdAt: '2026-06-10T10:00:00.000Z',
						id: 'comment-1',
					},
				]),
				issue: createIssueData({ id }),
			};
		},
		listIssues: async ({ after } = {}) => {
			calls.push(`listIssues:${after ?? ''}`);
			if (options.listIssuesError) {
				throw options.listIssuesError;
			}
			const result =
				issuePages[Math.min(issuePageIndex, issuePages.length - 1)];
			issuePageIndex += 1;
			if (!result) {
				throw new Error('No fake issue page configured.');
			}
			return result;
		},
		listMetadata: async (kind) => {
			calls.push(`listMetadata:${kind}`);
			return page(options.metadata?.[kind] ?? []);
		},
		searchIssues: async (term) => {
			calls.push(`searchIssues:${term}`);
			return page(options.searchResults ?? [createIssueData()]);
		},
		updateIssue: async (id, input) => {
			calls.push('updateIssue');
			return createIssueData({
				id,
				...(input.stateId
					? {
							state: {
								color: null,
								id: input.stateId,
								name: 'Done',
								type: 'completed',
							},
						}
					: {}),
				...(input.title ? { title: input.title } : {}),
			});
		},
	};

	return { calls, client };
}

function createServiceFixture(t: TestContext, options: FakeClientOptions = {}) {
	const databaseService = createDatabaseServiceFixture(t);
	const fake = createFakeClient(options);
	const service = createLinearService({
		clientFactory: () => fake.client,
		databaseService,
		listAccounts: async () => [accountSnapshot(ACCOUNT, 'Example Org')],
		now: () => NOW,
	});

	return { ...fake, databaseService, service };
}

test('listIssues: syncs from the client on a cold cache and serves cached rows', async (t) => {
	const { calls, service } = createServiceFixture(t);

	const result = await service.listIssues();

	assert.strictEqual(result.status, 'ok');
	assert.ok(result.status === 'ok');
	assert.strictEqual(result.source, 'remote');
	assert.strictEqual(result.issues.length, 1);
	assert.strictEqual(result.issues[0]?.identifier, 'ENG-143');
	assert.strictEqual(result.issues[0]?.teamKey, 'THE');
	assert.strictEqual(result.issues[0]?.stateName, 'Todo');
	assert.strictEqual(result.issues[0]?.cycleName, 'Cycle 12');
	assert.deepStrictEqual(result.issues[0]?.labels, [
		{ color: '#f00', id: 'label-1', name: 'bug' },
	]);
	assert.ok(calls.includes('listIssues:'));

	// Second call inside the freshness window serves the cache only.
	const second = await service.listIssues();
	assert.ok(second.status === 'ok');
	assert.strictEqual(second.source, 'cache');
	assert.strictEqual(
		calls.filter((call) => call.startsWith('listIssues')).length,
		1,
	);
});

test('listIssues: follows pagination cursors across pages', async (t) => {
	const { calls, service } = createServiceFixture(t, {
		issuePages: [
			page([createIssueData()], 'cursor-1'),
			page([createIssueData({ id: 'issue-2', identifier: 'ENG-144' })]),
		],
	});

	const result = await service.listIssues();

	assert.ok(result.status === 'ok');
	assert.strictEqual(result.issues.length, 2);
	assert.deepStrictEqual(
		calls.filter((call) => call.startsWith('listIssues')),
		['listIssues:', 'listIssues:cursor-1'],
	);
});

/**
 * A service sharing another fixture's database, whose client always fails and
 * whose clock has advanced past the freshness window.
 */
function createFailingService(
	databaseService: EnsemblrDatabaseService,
	minutesLater = 10,
) {
	const fake = createFakeClient({
		listIssuesError: new LinearServiceError(
			'rate-limited',
			'Rate limit reached.',
			{ retryAfterSeconds: 30 },
		),
	});

	return {
		...fake,
		service: createLinearService({
			clientFactory: () => fake.client,
			databaseService,
			listAccounts: async () => [accountSnapshot(ACCOUNT, 'Example Org')],
			now: () => new Date(NOW.getTime() + minutesLater * 60 * 1000),
		}),
	};
}

test('listIssues: degrades to cached rows when the remote sync fails', async (t) => {
	const { databaseService, service } = createServiceFixture(t);
	await service.listIssues();

	const failing = createFailingService(databaseService);
	const result = await failing.service.listIssues({ refresh: true });

	// A failed sync narrows the answer rather than replacing it: the account's
	// own failure travels alongside the rows the cache still holds.
	assert.ok(result.status === 'ok');
	assert.strictEqual(result.accountFailures.length, 1);
	assert.strictEqual(result.accountFailures[0]?.failure.code, 'rate-limited');
	assert.strictEqual(result.accountFailures[0]?.failure.retryAfterSeconds, 30);
	assert.strictEqual(result.accountFailures[0]?.accountId, ACCOUNT);
	assert.strictEqual(result.issues.length, 1);
});

test('listIssues: serves a stale cache at once and refreshes behind it', async (t) => {
	const { databaseService, service } = createServiceFixture(t);
	await service.listIssues();

	const later = createLinearService({
		clientFactory: () => createFakeClient().client,
		databaseService,
		listAccounts: async () => [accountSnapshot(ACCOUNT, 'Example Org')],
		now: () => new Date(NOW.getTime() + 10 * 60 * 1000),
	});
	const result = await later.listIssues();

	assert.ok(result.status === 'ok');
	assert.strictEqual(result.source, 'cache');
	assert.strictEqual(result.syncing, true);
	assert.strictEqual(result.issues.length, 1);
});

test('listIssues: a failed sync is held back and keeps reporting itself', async (t) => {
	const { databaseService, service } = createServiceFixture(t);
	await service.listIssues();

	const failing = createFailingService(databaseService);
	await failing.service.listIssues({ refresh: true });
	const attemptsAfterFailure = failing.calls.filter((call) =>
		call.startsWith('listIssues'),
	).length;
	const next = await failing.service.listIssues();

	assert.ok(next.status === 'ok');
	assert.strictEqual(next.issues.length, 1);
	assert.strictEqual(next.accountFailures[0]?.failure.code, 'rate-limited');
	assert.strictEqual(
		failing.calls.filter((call) => call.startsWith('listIssues')).length,
		attemptsAfterFailure,
	);
});

test('listIssues: a search keeps the hits Linear matched on description', async (t) => {
	const { calls, service } = createServiceFixture(t, {
		searchResults: [
			createIssueData({
				description: 'The OAuth redirect drops the state parameter.',
				id: 'issue-7',
				identifier: 'ENG-207',
				title: 'Connection settings',
			}),
		],
	});

	// Linear's search matches descriptions, so re-reading its answer through a
	// narrower predicate would throw away the rows it just cached.
	const result = await service.listIssues({ query: 'redirect' });

	assert.ok(result.status === 'ok');
	assert.ok(calls.includes('searchIssues:redirect'));
	assert.deepStrictEqual(
		result.issues.map((issue) => issue.identifier),
		['ENG-207'],
	);
});

test('listIssues: a padded search term is trimmed for the cache read too', async (t) => {
	const { calls, service } = createServiceFixture(t);

	// The remote query is trimmed, so reading the cache back with the padded
	// text would filter out everything the search just found.
	const result = await service.listIssues({ query: '  OAuth  ' });

	assert.ok(result.status === 'ok');
	assert.ok(calls.includes('searchIssues:OAuth'));
	assert.strictEqual(result.issues.length, 1);
});

test('listIssues: a repeated search inside the window costs no second query', async (t) => {
	const { calls, service } = createServiceFixture(t);

	await service.listIssues({ query: 'oauth' });
	const second = await service.listIssues({ query: 'oauth' });

	assert.ok(second.status === 'ok');
	assert.strictEqual(second.source, 'cache');
	assert.strictEqual(
		calls.filter((call) => call.startsWith('searchIssues')).length,
		1,
	);
});

test('listIssues: a search leaves no sync-state row behind to accumulate', async (t) => {
	const { databaseService, service } = createServiceFixture(t);

	await service.listIssues({ query: 'oauth' });
	await service.listIssues({ query: 'auth' });

	const database = databaseService.getConnection()?.database;
	assert.ok(database);
	const rows = database
		.prepare('SELECT scope FROM linear_sync_state')
		.all() as unknown as Array<{ scope: string }>;

	// A search scope is keyed by the text someone typed, so persisting it would
	// grow a row per term ever searched and nothing would ever remove one.
	assert.deepStrictEqual(
		rows.map((row) => row.scope),
		[],
	);
});

test('listIssues: transient search scopes are evicted rather than kept forever', async (t) => {
	const { calls, service } = createServiceFixture(t);
	const queriesFor = (term: string) =>
		calls.filter((call) => call === `searchIssues:${term}`).length;

	await service.listIssues({ query: 'first-term' });
	assert.strictEqual(queriesFor('first-term'), 1);

	for (let index = 0; index < 80; index += 1) {
		await service.listIssues({ query: `filler-${index}` });
	}

	// Past the coordinator's cap the oldest scope is dropped, so its freshness is
	// forgotten and the term is queried again instead of remembered for the life
	// of the process.
	await service.listIssues({ query: 'first-term' });

	assert.strictEqual(queriesFor('first-term'), 2);
});

test('listIssues: an account a cooldown holds back keeps reporting its failure', async (t) => {
	let clock = NOW;
	const { service } = createTwoAccountFixture(t, {
		firstClient: { listIssues: async () => page([]) },
		now: () => clock,
		otherClient: {
			listIssues: async () => {
				throw new LinearServiceError('rate-limited', 'Slow down.', {
					retryAfterSeconds: 3600,
				});
			},
		},
	});

	const first = await service.listIssues();
	assert.ok(first.status === 'ok');
	assert.strictEqual(first.accountFailures[0]?.accountId, OTHER_ACCOUNT);

	// Ten minutes on the healthy account is stale again, but the rate-limited one
	// is still inside the hour Linear asked for and so is not synced this round.
	// Reporting only what this round raised would drop its failure entirely.
	clock = new Date(NOW.getTime() + 10 * 60 * 1000);
	const second = await service.listIssues();

	assert.ok(second.status === 'ok');
	assert.strictEqual(second.issues.length, 0);
	assert.strictEqual(second.accountFailures.length, 1);
	assert.strictEqual(second.accountFailures[0]?.accountId, OTHER_ACCOUNT);
	assert.strictEqual(second.accountFailures[0]?.failure.code, 'rate-limited');
});

test('listIssues: a failure cooldown expires and the next read retries', async (t) => {
	const databaseService = createDatabaseServiceFixture(t);
	const fake = createFakeClient({
		listIssuesError: new LinearServiceError('network', 'Offline.'),
	});
	let clock = NOW;
	const service = createLinearService({
		clientFactory: () => fake.client,
		databaseService,
		failureCooldownMs: 60_000,
		listAccounts: async () => [accountSnapshot(ACCOUNT, 'Example Org')],
		now: () => clock,
	});
	const attempts = () =>
		fake.calls.filter((call) => call.startsWith('listIssues')).length;

	await service.listIssues();
	assert.strictEqual(attempts(), 1);

	clock = new Date(NOW.getTime() + 30 * 1000);
	await service.listIssues();
	assert.strictEqual(attempts(), 1);

	clock = new Date(NOW.getTime() + 90 * 1000);
	await service.listIssues();
	assert.strictEqual(attempts(), 2);
});

test('listIssues: filters cached rows by query', async (t) => {
	const { service } = createServiceFixture(t, {
		issuePages: [
			page([
				createIssueData(),
				createIssueData({
					description: 'Tighten the dock resize handles.',
					id: 'issue-2',
					identifier: 'ENG-150',
					title: 'Terminal polish',
				}),
			]),
		],
	});

	await service.listIssues();
	const result = await service.listIssues({ query: 'oauth' });

	assert.ok(result.status === 'ok');
	assert.deepStrictEqual(
		result.issues.map((issue) => issue.id),
		['issue-1'],
	);
});

test('getIssue: serves the remote payload and caches comments', async (t) => {
	const { service } = createServiceFixture(t);

	const result = await service.getIssue({ id: 'issue-1' });

	assert.ok(result.status === 'ok');
	assert.strictEqual(result.source, 'remote');
	assert.strictEqual(result.issue.identifier, 'ENG-143');
	assert.strictEqual(result.comments.length, 1);
	assert.strictEqual(result.comments[0]?.authorName, 'Bob');

	const cached = await service.getIssue({ id: 'issue-1' });
	assert.ok(cached.status === 'ok');
	assert.strictEqual(cached.source, 'cache');
	assert.strictEqual(cached.comments.length, 1);
});

test('getIssue: fetches the thread for an issue the list sync cached', async (t) => {
	const { calls, service } = createServiceFixture(t);

	// The browse list writes the issue row without ever reading its comments, so
	// a freshly listed issue must not be mistaken for one whose thread is loaded.
	await service.listIssues();
	const result = await service.getIssue({ id: 'issue-1' });

	assert.ok(result.status === 'ok');
	assert.strictEqual(result.source, 'remote');
	assert.strictEqual(result.comments.length, 1);
	assert.ok(calls.includes('getIssue:issue-1'));
});

test('getIssue: a mutation does not blank the thread it never read', async (t) => {
	const { calls, service } = createServiceFixture(t);

	await service.updateIssue({ id: 'issue-1', input: { title: 'Renamed' } });
	const result = await service.getIssue({ id: 'issue-1' });

	assert.ok(result.status === 'ok');
	assert.strictEqual(result.comments.length, 1);
	assert.ok(calls.includes('getIssue:issue-1'));
});

test('getIssue: one read is shared by concurrent callers', async (t) => {
	const { calls, service } = createServiceFixture(t);

	const [first, second] = await Promise.all([
		service.getIssue({ id: 'issue-1' }),
		service.getIssue({ id: 'issue-1' }),
	]);

	assert.ok(first?.status === 'ok');
	assert.ok(second?.status === 'ok');
	assert.strictEqual(
		calls.filter((call) => call === 'getIssue:issue-1').length,
		1,
	);
});

test('getIssue: returns a typed failure for unknown issues', async (t) => {
	const databaseService = createDatabaseServiceFixture(t);
	const { client } = createFakeClient();
	const service = createLinearService({
		clientFactory: () => ({
			...client,
			getIssue: async () => {
				throw new LinearServiceError('not-found', 'Issue missing.');
			},
		}),
		databaseService,
		listAccounts: async () => [accountSnapshot(ACCOUNT, 'Example Org')],
		now: () => NOW,
	});

	const result = await service.getIssue({ id: 'missing' });

	assert.ok(result.status === 'error');
	assert.strictEqual(result.failure.code, 'not-found');
});

test('getMetadata: syncs every resource kind and groups by kind', async (t) => {
	const { calls, service } = createServiceFixture(t, {
		metadata: {
			state: [
				{
					data: { color: '#0f0', type: 'completed' },
					id: 'state-2',
					name: 'Done',
					teamId: 'team-1',
				},
			],
			team: [
				{ data: { key: 'THE' }, id: 'team-1', name: 'Theseus', teamId: null },
			],
		},
	});

	const result = await service.getMetadata();

	assert.ok(result.status === 'ok');
	assert.strictEqual(result.metadata.teams.length, 1);
	assert.strictEqual(result.metadata.teams[0]?.key, 'THE');
	assert.strictEqual(result.metadata.states[0]?.type, 'completed');
	assert.strictEqual(result.metadata.syncedAt, NOW.toISOString());
	for (const kind of ['team', 'project', 'state', 'label', 'cycle', 'user']) {
		assert.ok(calls.includes(`listMetadata:${kind}`));
	}
});

test('createIssue/updateIssue/createComment: mutate remotely and refresh the cache', async (t) => {
	const { service } = createServiceFixture(t);

	const created = await service.createIssue({
		teamId: 'team-1',
		title: 'New issue',
	});
	assert.ok(created.status === 'ok');
	assert.strictEqual(created.issue.identifier, 'ENG-200');

	const updated = await service.updateIssue({
		id: 'issue-new',
		input: { stateId: 'state-2' },
	});
	assert.ok(updated.status === 'ok');
	assert.strictEqual(updated.issue.stateName, 'Done');

	const comment = await service.createComment({
		body: 'Looks good',
		issueId: 'issue-new',
	});
	assert.ok(comment.status === 'ok');
	assert.strictEqual(comment.comment.body, 'Looks good');

	const detail = await service.getIssue({ id: 'issue-new' });
	assert.ok(detail.status === 'ok');
});

test('cache contains no token-shaped secrets after a full sync', async (t) => {
	const { databaseService, service } = createServiceFixture(t);
	await service.listIssues();
	await service.getMetadata();

	const database = databaseService.getConnection()?.database;
	assert.ok(database);

	for (const table of [
		'linear_issues',
		'linear_resources',
		'linear_comments',
		'linear_sync_state',
	]) {
		const rows = database.prepare(`SELECT * FROM ${table}`).all() as Array<
			Record<string, unknown>
		>;
		for (const row of rows) {
			const serialized = JSON.stringify(row);
			assert.ok(!/access[-_]?token|refresh[-_]?token/i.test(serialized));
		}
	}
});

test('mutations surface permission failures without touching the cache', async (t) => {
	const databaseService = createDatabaseServiceFixture(t);
	const { client } = createFakeClient();
	const service = createLinearService({
		clientFactory: () => ({
			...client,
			createIssue: async () => {
				throw new LinearServiceError('permission-denied', 'No access.');
			},
		}),
		databaseService,
		listAccounts: async () => [accountSnapshot(ACCOUNT, 'Example Org')],
		now: () => NOW,
	});

	const result = await service.createIssue({ teamId: 'team-1', title: 'X' });

	assert.ok(result.status === 'error');
	assert.strictEqual(result.failure.code, 'permission-denied');

	const database = databaseService.getConnection()?.database;
	assert.ok(database);
	assert.strictEqual(
		database.prepare('SELECT id FROM linear_issues').all().length,
		0,
	);
});

/**
 * Builds a service over two connected accounts, each with its own fake client,
 * so resolution and per-account failure isolation can be exercised. The
 * single-account fixture above cannot reach either: with one account connected
 * every ambiguity collapses and every merged read has nothing to merge.
 */
function createTwoAccountFixture(
	t: TestContext,
	options: {
		firstClient?: Partial<LinearClient>;
		now?: () => Date;
		otherClient?: Partial<LinearClient>;
	} = {},
) {
	const databaseService = createDatabaseServiceFixture(t);
	const first = createFakeClient();
	const second = createFakeClient();
	const clients: Record<string, LinearClient> = {
		[ACCOUNT]: { ...first.client, ...options.firstClient },
		[OTHER_ACCOUNT]: { ...second.client, ...options.otherClient },
	};
	const service = createLinearService({
		clientFactory: (accountId) => clients[accountId] ?? first.client,
		databaseService,
		listAccounts: async () => [
			accountSnapshot(ACCOUNT, 'Example Org'),
			accountSnapshot(OTHER_ACCOUNT, 'Client Co'),
		],
		now: options.now ?? (() => NOW),
	});

	return { databaseService, first, second, service };
}

/** Writes one cached issue row directly, to set up a resolution scenario. */
function seedIssue(
	databaseService: EnsemblrDatabaseService,
	accountId: string,
	id: string,
	identifier: string,
): void {
	const database = databaseService.getConnection()?.database;
	assert.ok(database);
	database
		.prepare(
			`INSERT INTO linear_issues
			 (id, account_id, identifier, title, team_id, remote_updated_at, synced_at)
			 VALUES (?, ?, ?, ?, 'team-1', ?, ?)`,
		)
		.run(
			id,
			accountId,
			identifier,
			'Seeded',
			NOW.toISOString(),
			NOW.toISOString(),
		);
}

test('getIssue: refuses an identifier that matches in two accounts rather than guessing', async (t) => {
	const { databaseService, service } = createTwoAccountFixture(t);
	seedIssue(databaseService, ACCOUNT, 'issue-a', 'ENG-1');
	seedIssue(databaseService, OTHER_ACCOUNT, 'issue-b', 'ENG-1');

	const result = await service.getIssue({ id: 'ENG-1' });

	assert.ok(result.status === 'error');
	assert.strictEqual(result.failure.code, 'invalid-request');
	assert.match(result.failure.message, /Example Org/);
	assert.match(result.failure.message, /Client Co/);
});

test('getIssue: the entity wins over the caller fallback, so a workspace cannot mask it', async (t) => {
	const { databaseService, service } = createTwoAccountFixture(t);
	seedIssue(databaseService, OTHER_ACCOUNT, 'issue-b', 'ENG-9');

	const result = await service.getIssue({
		fallbackAccountId: ACCOUNT,
		id: 'ENG-9',
	});

	assert.ok(result.status === 'ok');
	assert.strictEqual(result.issue.accountId, OTHER_ACCOUNT);
});

test('getIssue: a fallback still resolves an entity no account claims', async (t) => {
	const { service } = createTwoAccountFixture(t);

	const result = await service.getIssue({
		fallbackAccountId: OTHER_ACCOUNT,
		id: 'issue-unknown',
	});

	assert.ok(result.status === 'ok');
	assert.strictEqual(result.issue.accountId, OTHER_ACCOUNT);
});

test('getIssue: refuses when neither the entity nor a fallback names an account', async (t) => {
	const { service } = createTwoAccountFixture(t);

	const result = await service.getIssue({ id: 'issue-unknown' });

	assert.ok(result.status === 'error');
	assert.strictEqual(result.failure.code, 'invalid-request');
	assert.match(result.failure.message, /Name an accountId/);
});

test('listIssues: one account failing narrows the merged list instead of blanking it', async (t) => {
	const { service } = createTwoAccountFixture(t, {
		otherClient: {
			listIssues: async () => {
				throw new LinearServiceError('rate-limited', 'Slow down.');
			},
		},
	});

	const result = await service.listIssues();

	assert.ok(result.status === 'ok');
	assert.strictEqual(result.issues.length, 1);
	assert.strictEqual(result.issues[0]?.accountId, ACCOUNT);
	assert.strictEqual(result.accountFailures.length, 1);
	assert.strictEqual(result.accountFailures[0]?.accountId, OTHER_ACCOUNT);
	assert.strictEqual(result.accountFailures[0]?.organizationName, 'Client Co');
});
