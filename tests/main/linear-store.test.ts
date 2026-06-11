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
import { openEnsembleDatabase } from '../../src/main/storage/database.ts';

const NOW = new Date('2026-06-11T00:00:00.000Z');

function createFixture(t: TestContext): {
	database: DatabaseSync;
	store: LinearStore;
} {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-linear-store-'));
	const connection = openEnsembleDatabase({
		databasePath: path.join(directory, 'linear-store-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

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
		identifier: 'THE-143',
		priority: 1,
		projectId: 'project-1',
		remoteUpdatedAt: '2026-06-10T12:00:00.000Z',
		stateId: 'state-1',
		teamId: 'team-1',
		title: 'Linear OAuth PKCE and Token Lifecycle',
		url: 'https://linear.app/acme/issue/THE-143',
		...overrides,
	};
}

test('upsertIssues: inserts and reads back a full issue record', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues([createIssue()]);
	const issue = store.getIssue('issue-1');

	assert.ok(issue);
	assert.strictEqual(issue.identifier, 'THE-143');
	assert.strictEqual(issue.priority, 1);
	assert.deepStrictEqual(issue.data, { labels: ['bug'] });
	assert.strictEqual(issue.syncedAt, NOW.toISOString());
});

test('upsertIssues: re-upserting the same id is idempotent and refreshes fields', (t) => {
	const { database, store } = createFixture(t);

	store.upsertIssues([createIssue()]);
	store.upsertIssues([
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

	store.upsertIssues([createIssue()]);

	assert.strictEqual(store.getIssueByIdentifier('THE-143')?.id, 'issue-1');
	assert.strictEqual(store.getIssueByIdentifier('THE-999'), null);
});

test('listIssues: filters by team, query, and archive state', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues([
		createIssue(),
		createIssue({
			id: 'issue-2',
			identifier: 'THE-150',
			teamId: 'team-2',
			title: 'Terminal dock polish',
		}),
		createIssue({
			archivedAt: '2026-06-01T00:00:00.000Z',
			id: 'issue-3',
			identifier: 'THE-101',
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
		store.listIssues({ query: 'THE-150' }).map((issue) => issue.id),
		['issue-2'],
	);
	assert.strictEqual(store.listIssues({ includeArchived: true }).length, 3);
});

test('listIssues: escapes SQL LIKE wildcards in the query', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues([
		createIssue({ id: 'issue-2', identifier: 'THE-150', title: '100% done' }),
		createIssue(),
	]);

	assert.deepStrictEqual(
		store.listIssues({ query: '100%' }).map((issue) => issue.id),
		['issue-2'],
	);
});

test('upsertResources: stores metadata by kind and lists team-scoped entries', (t) => {
	const { store } = createFixture(t);

	store.upsertResources([
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
		store.listResources('state', 'team-1').map((resource) => resource.id),
		['state-3', 'state-1'],
	);
});

test('upsertComments: replaces comment content idempotently and orders by creation', (t) => {
	const { store } = createFixture(t);

	store.upsertIssues([createIssue()]);
	store.upsertComments('issue-1', [
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
	store.upsertComments('issue-1', [
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

	store.upsertIssues([createIssue()]);
	store.upsertComments('issue-1', [
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

	assert.strictEqual(store.getSyncState('issues'), null);

	store.setSyncState({
		cursor: 'cursor-1',
		errorCode: null,
		scope: 'issues',
		status: 'syncing',
		syncedAt: NOW.toISOString(),
	});
	store.setSyncState({
		cursor: null,
		errorCode: 'rate-limited',
		scope: 'issues',
		status: 'error',
		syncedAt: NOW.toISOString(),
	});

	assert.deepStrictEqual(store.getSyncState('issues'), {
		cursor: null,
		errorCode: 'rate-limited',
		scope: 'issues',
		status: 'error',
		syncedAt: NOW.toISOString(),
	});
});
