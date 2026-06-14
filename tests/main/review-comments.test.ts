import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	deleteReviewComment,
	deleteReviewTodo,
	insertReviewComment,
	insertReviewTodo,
	listReviewComments,
	listReviewTodos,
	updateReviewComment,
	updateReviewTodo,
} from '../../src/main/storage/repositories/review-repository.ts';

function createTestDatabase(): DatabaseSync {
	const database = new DatabaseSync(':memory:');
	database.exec(`CREATE TABLE comments (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL,
		session_id TEXT,
		checkpoint_id TEXT,
		file_path TEXT NOT NULL,
		line_number INTEGER,
		body TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'archived')),
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		metadata_json TEXT NOT NULL DEFAULT '{}'
	) STRICT;
	CREATE TABLE todos (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL,
		session_id TEXT,
		title TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'canceled')),
		position INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		metadata_json TEXT NOT NULL DEFAULT '{}'
	) STRICT;`);
	return database;
}

test('review comments support add, list, resolve, and delete', () => {
	const database = createTestDatabase();

	const comment = insertReviewComment({
		body: 'Rename this function',
		database,
		filePath: 'src/app.ts',
		lineNumber: 42,
		workspaceId: 'ws-1',
	});
	assert.equal(comment.status, 'open');
	assert.equal(comment.lineNumber, 42);

	const listed = listReviewComments({ database, workspaceId: 'ws-1' });
	assert.equal(listed.length, 1);
	assert.equal(listed[0]?.body, 'Rename this function');

	const resolved = updateReviewComment({
		database,
		id: comment.id,
		status: 'resolved',
	});
	assert.equal(resolved?.status, 'resolved');
	assert.equal(resolved?.body, 'Rename this function');

	const edited = updateReviewComment({
		body: 'Rename to fetchUser',
		database,
		id: comment.id,
	});
	assert.equal(edited?.body, 'Rename to fetchUser');
	assert.equal(edited?.status, 'resolved');

	deleteReviewComment({ database, id: comment.id });
	assert.equal(listReviewComments({ database, workspaceId: 'ws-1' }).length, 0);
});

test('review comments are scoped per workspace and hide archived', () => {
	const database = createTestDatabase();
	const kept = insertReviewComment({
		body: 'keep',
		database,
		filePath: 'a.ts',
		lineNumber: null,
		workspaceId: 'ws-1',
	});
	insertReviewComment({
		body: 'other workspace',
		database,
		filePath: 'b.ts',
		lineNumber: null,
		workspaceId: 'ws-2',
	});
	const archived = insertReviewComment({
		body: 'archive me',
		database,
		filePath: 'c.ts',
		lineNumber: 1,
		workspaceId: 'ws-1',
	});
	updateReviewComment({ database, id: archived.id, status: 'archived' });

	const listed = listReviewComments({ database, workspaceId: 'ws-1' });
	assert.deepEqual(
		listed.map((row) => row.id),
		[kept.id],
	);
});

test('review todos append positions and support status flips', () => {
	const database = createTestDatabase();

	const first = insertReviewTodo({
		database,
		title: 'Fix failing check',
		workspaceId: 'ws-1',
	});
	const second = insertReviewTodo({
		database,
		title: 'Address review comment',
		workspaceId: 'ws-1',
	});
	assert.equal(first.position, 0);
	assert.equal(second.position, 1);

	const done = updateReviewTodo({ database, id: first.id, status: 'done' });
	assert.equal(done?.status, 'done');

	const listed = listReviewTodos({ database, workspaceId: 'ws-1' });
	assert.deepEqual(
		listed.map((row) => [row.title, row.status]),
		[
			['Fix failing check', 'done'],
			['Address review comment', 'open'],
		],
	);

	deleteReviewTodo({ database, id: second.id });
	assert.equal(listReviewTodos({ database, workspaceId: 'ws-1' }).length, 1);
});

test('updates against missing rows return null', () => {
	const database = createTestDatabase();
	assert.equal(
		updateReviewComment({ database, id: 'missing', status: 'resolved' }),
		null,
	);
	assert.equal(
		updateReviewTodo({ database, id: 'missing', status: 'done' }),
		null,
	);
});
