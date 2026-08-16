import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import {
	createLinearStore,
	type LinearIssueUpsert,
	type LinearStore,
} from '../../src/main/linear/linear-store.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';

const NOW = new Date('2026-06-11T00:00:00.000Z');
const ACCOUNT = 'account-1';
const OTHER_ACCOUNT = 'account-2';

/**
 * Inserts the account rows every cached row points at. The cache is scoped by
 * account and the foreign keys are enforced, so a fixture without them cannot
 * write a single issue.
 */
function seedAccounts(database: DatabaseSync): void {
	const statement = database.prepare(
		`INSERT INTO linear_accounts (id, organization_id, organization_name, user_id)
		 VALUES (?, ?, ?, ?)`,
	);
	statement.run(ACCOUNT, 'org-1', 'Example Org', 'viewer-1');
	statement.run(OTHER_ACCOUNT, 'org-2', 'Client Co', 'viewer-2');
}

function createFixture(t: TestContext): {
	database: DatabaseSync;
	store: LinearStore;
} {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-linear-store-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'linear-store-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	seedAccounts(connection.database);

	return {
		database: connection.database,
		store: createLinearStore({
			database: connection.database,
			now: () => NOW,
		}),
	};
}

function createIssue(
	overrides: Partial<LinearIssueUpsert> = {},
): LinearIssueUpsert {
	return {
		archivedAt: null,
		assigneeId: 'user-1',
		data: { labels: ['bug'] },
		description: 'Fix the OAuth callback flow.',
		dueDate: null,
		id: 'issue-1',
		identifier: 'ENG-143',
		priority: 1,
		projectId: 'project-1',
		remoteUpdatedAt: '2026-06-10T12:00:00.000Z',
		stateId: 'state-1',
		teamId: 'team-1',
		title: 'Linear OAuth PKCE and Token Lifecycle',
		url: 'https://linear.app/acme/issue/ENG-143',
		...overrides,
	};
}

test('upsertIssues: inserts and reads back a full issue record', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues(ACCOUNT, [createIssue()]);
	const issue = store.getIssue('issue-1');

	assert.ok(issue);
	assert.strictEqual(issue.identifier, 'ENG-143');
	assert.strictEqual(issue.priority, 1);
	assert.deepStrictEqual(issue.data, { labels: ['bug'] });
	assert.strictEqual(issue.syncedAt, NOW.toISOString());
});

test('upsertIssues: re-upserting the same id is idempotent and refreshes fields', (t) => {
	const { database, store } = createFixture(t);

	store.upsertIssues(ACCOUNT, [createIssue()]);
	store.upsertIssues(ACCOUNT, [
		createIssue({ stateId: 'state-2', title: 'Updated title' }),
	]);

	const rows = database.prepare('SELECT id FROM linear_issues').all();
	assert.strictEqual(rows.length, 1);

	const issue = store.getIssue('issue-1');
	assert.strictEqual(issue?.title, 'Updated title');
	assert.strictEqual(issue?.stateId, 'state-2');
});

test('getIssueByIdentifier: resolves cached issues by human identifier', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues(ACCOUNT, [createIssue()]);

	assert.strictEqual(
		store.getIssueByIdentifier(ACCOUNT, 'ENG-143')?.id,
		'issue-1',
	);
	assert.strictEqual(store.getIssueByIdentifier(ACCOUNT, 'ENG-999'), null);
});

test('listIssues: filters by team, query, and archive state', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues(ACCOUNT, [
		createIssue(),
		createIssue({
			id: 'issue-2',
			identifier: 'ENG-150',
			teamId: 'team-2',
			title: 'Terminal dock polish',
		}),
		createIssue({
			archivedAt: '2026-06-01T00:00:00.000Z',
			id: 'issue-3',
			identifier: 'ENG-101',
			title: 'Archived issue',
		}),
	]);

	assert.deepStrictEqual(
		store.listIssues().map((issue) => issue.id),
		['issue-1', 'issue-2'],
	);
	assert.deepStrictEqual(
		store.listIssues({ teamId: 'team-2' }).map((issue) => issue.id),
		['issue-2'],
	);
	assert.deepStrictEqual(
		store.listIssues({ query: 'oauth' }).map((issue) => issue.id),
		['issue-1'],
	);
	assert.deepStrictEqual(
		store.listIssues({ query: 'ENG-150' }).map((issue) => issue.id),
		['issue-2'],
	);
	assert.strictEqual(store.listIssues({ includeArchived: true }).length, 3);
});

test('listIssues: escapes SQL LIKE wildcards in the query', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues(ACCOUNT, [
		createIssue({ id: 'issue-2', identifier: 'ENG-150', title: '100% done' }),
		createIssue(),
	]);

	assert.deepStrictEqual(
		store.listIssues({ query: '100%' }).map((issue) => issue.id),
		['issue-2'],
	);
});

test('upsertResources: stores metadata by kind and lists team-scoped entries', (t) => {
	const { store } = createFixture(t);

	store.upsertResources(ACCOUNT, [
		{ data: {}, id: 'team-1', kind: 'team', name: 'Theseus', teamId: null },
		{ data: {}, id: 'state-1', kind: 'state', name: 'Todo', teamId: 'team-1' },
		{
			data: {},
			id: 'state-2',
			kind: 'state',
			name: 'Done',
			teamId: 'team-2',
		},
		{ data: {}, id: 'state-3', kind: 'state', name: 'Global', teamId: null },
	]);

	assert.deepStrictEqual(
		store.listResources('team').map((resource) => resource.id),
		['team-1'],
	);
	assert.deepStrictEqual(
		store
			.listResources('state', { teamId: 'team-1' })
			.map((resource) => resource.id),
		['state-3', 'state-1'],
	);
});

test('upsertComments: replaces comment content idempotently and orders by creation', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues(ACCOUNT, [createIssue()]);
	store.upsertComments(ACCOUNT, 'issue-1', [
		{
			authorName: 'Bob',
			body: 'Second',
			data: {},
			id: 'comment-2',
			issueId: 'issue-1',
			remoteCreatedAt: '2026-06-10T11:00:00.000Z',
		},
		{
			authorName: 'Alice',
			body: 'First',
			data: {},
			id: 'comment-1',
			issueId: 'issue-1',
			remoteCreatedAt: '2026-06-10T10:00:00.000Z',
		},
	]);
	store.upsertComments(ACCOUNT, 'issue-1', [
		{
			authorName: 'Alice',
			body: 'First (edited)',
			data: {},
			id: 'comment-1',
			issueId: 'issue-1',
			remoteCreatedAt: '2026-06-10T10:00:00.000Z',
		},
	]);

	const comments = store.listComments('issue-1');
	assert.deepStrictEqual(
		comments.map((comment) => comment.body),
		['First (edited)', 'Second'],
	);
});

test('deleteIssue: removes the issue and its cached comments', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues(ACCOUNT, [createIssue()]);
	store.upsertComments(ACCOUNT, 'issue-1', [
		{
			authorName: 'Alice',
			body: 'First',
			data: {},
			id: 'comment-1',
			issueId: 'issue-1',
			remoteCreatedAt: null,
		},
	]);

	store.deleteIssue('issue-1');

	assert.strictEqual(store.getIssue('issue-1'), null);
	assert.deepStrictEqual(store.listComments('issue-1'), []);
});

test('setSyncState: round-trips cursor and error bookkeeping', (t) => {
	const { store } = createFixture(t);

	assert.strictEqual(store.getSyncState(ACCOUNT, 'issues'), null);

	store.setSyncState({
		accountId: ACCOUNT,
		cursor: 'cursor-1',
		errorCode: null,
		scope: 'issues',
		status: 'syncing',
		syncedAt: NOW.toISOString(),
	});
	store.setSyncState({
		accountId: ACCOUNT,
		cursor: null,
		errorCode: 'rate-limited',
		scope: 'issues',
		status: 'error',
		syncedAt: NOW.toISOString(),
	});

	assert.deepStrictEqual(store.getSyncState(ACCOUNT, 'issues'), {
		accountId: ACCOUNT,
		cursor: null,
		errorCode: 'rate-limited',
		scope: 'issues',
		status: 'error',
		syncedAt: NOW.toISOString(),
	});
});

// `ENG-1` is unique inside a Linear organization but not between two of them, so
// an identifier lookup that ignored the account would answer with whichever row
// SQLite reached first.
test('getIssueByIdentifier: keeps the same identifier apart across accounts', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues(ACCOUNT, [createIssue()]);
	store.upsertIssues(OTHER_ACCOUNT, [
		createIssue({ id: 'issue-other', title: 'Same key, other org' }),
	]);

	assert.strictEqual(
		store.getIssueByIdentifier(ACCOUNT, 'ENG-143')?.id,
		'issue-1',
	);
	assert.strictEqual(
		store.getIssueByIdentifier(OTHER_ACCOUNT, 'ENG-143')?.id,
		'issue-other',
	);
});

test('listIssues: merges every account by default and narrows on request', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues(ACCOUNT, [createIssue()]);
	store.upsertIssues(OTHER_ACCOUNT, [
		createIssue({ id: 'issue-other', identifier: 'CLI-1' }),
	]);

	assert.strictEqual(store.listIssues().length, 2);
	assert.deepStrictEqual(
		store.listIssues({ accountId: OTHER_ACCOUNT }).map((issue) => issue.id),
		['issue-other'],
	);
});

test('listResources: narrows metadata to one account', (t) => {
	const { store } = createFixture(t);

	store.upsertResources(ACCOUNT, [
		{ data: {}, id: 'team-1', kind: 'team', name: 'Theseus', teamId: null },
	]);
	store.upsertResources(OTHER_ACCOUNT, [
		{ data: {}, id: 'team-9', kind: 'team', name: 'Client', teamId: null },
	]);

	assert.strictEqual(store.listResources('team').length, 2);
	assert.deepStrictEqual(
		store
			.listResources('team', { accountId: OTHER_ACCOUNT })
			.map((resource) => resource.id),
		['team-9'],
	);
});

// Disconnecting an account has to take its cached rows with it, or the browse
// list keeps serving issues from an organization the user just signed out of.
test('deleting an account cascades to its cached issues and sync state', (t) => {
	const { database, store } = createFixture(t);

	store.upsertIssues(ACCOUNT, [createIssue()]);
	store.upsertIssues(OTHER_ACCOUNT, [createIssue({ id: 'issue-other' })]);
	store.setSyncState({
		accountId: ACCOUNT,
		cursor: null,
		errorCode: null,
		scope: 'issues',
		status: 'idle',
		syncedAt: NOW.toISOString(),
	});

	database.prepare('DELETE FROM linear_accounts WHERE id = ?').run(ACCOUNT);

	assert.strictEqual(store.getIssue('issue-1'), null);
	assert.ok(store.getIssue('issue-other'));
	assert.strictEqual(store.getSyncState(ACCOUNT, 'issues'), null);
});

test('setSyncState: keeps each account’s bookkeeping separate', (t) => {
	const { store } = createFixture(t);

	store.setSyncState({
		accountId: ACCOUNT,
		cursor: 'cursor-a',
		errorCode: null,
		scope: 'issues',
		status: 'idle',
		syncedAt: NOW.toISOString(),
	});
	store.setSyncState({
		accountId: OTHER_ACCOUNT,
		cursor: 'cursor-b',
		errorCode: 'rate-limited',
		scope: 'issues',
		status: 'error',
		syncedAt: NOW.toISOString(),
	});

	assert.strictEqual(store.getSyncState(ACCOUNT, 'issues')?.cursor, 'cursor-a');
	assert.strictEqual(
		store.getSyncState(OTHER_ACCOUNT, 'issues')?.status,
		'error',
	);
});
