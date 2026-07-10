import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	createBranch,
	createPiSession,
	createTurn,
	getPiSessionById,
	listPiSessionBranches,
	listPiSessionsByWorkspace,
	listTurns,
	updatePiSession,
	updateTurn,
} from '../../src/main/storage/repositories/pi-session-repository.ts';

function openTestDatabase(t: import('node:test').TestContext): {
	database: DatabaseSync;
} {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-pi-session-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'pi-session-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-fixture', 'fixture', 'Fixture', '/tmp/ensemblr/fixture', 'main');

INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES
	('ws-real', 'repo-fixture', 'real', 'Real Workspace', '/tmp/ensemblr/fixture/real'),
	('ws-adopted', 'repo-fixture', 'adopted', 'Adopted Workspace', '/tmp/ensemblr/fixture/adopted');
`);

	return { database: connection.database };
}

test('createPiSession inserts a row and a main branch atomically', (t) => {
	const { database } = openTestDatabase(t);

	const { mainBranch, session } = createPiSession({
		database,
		input: {
			cwd: '/tmp/ensemblr/fixture/real',
			executableId: 'pi-default',
			executablePath: '/usr/local/bin/pi',
			label: 'Initial chat',
			metadata: { source: 'composer' },
			model: 'gpt-5.5',
			piSessionId: 'pi-runtime-1',
			thinkingLevel: 'high',
			workspaceId: 'ws-real',
		},
	});

	assert.equal(session.workspaceId, 'ws-real');
	assert.equal(session.piSessionId, 'pi-runtime-1');
	assert.equal(session.status, 'idle');
	assert.deepEqual(session.metadata, { source: 'composer' });
	assert.equal(mainBranch.piSessionId, session.id);
	assert.equal(mainBranch.kind, 'main');
	assert.equal(mainBranch.parentBranchId, null);

	const branches = listPiSessionBranches({
		database,
		piSessionId: session.id,
	});
	assert.equal(branches.length, 1);
	assert.equal(branches[0]?.id, mainBranch.id);
});

test('adopted workspaces can persist a session without a Pi session id', (t) => {
	const { database } = openTestDatabase(t);

	const { session } = createPiSession({
		database,
		input: {
			cwd: '/tmp/ensemblr/fixture/adopted',
			workspaceId: 'ws-adopted',
		},
	});

	assert.equal(session.piSessionId, null);
	assert.equal(session.executableId, null);
	assert.equal(session.model, null);
	assert.equal(session.thinkingLevel, null);
	assert.equal(session.label, null);
	assert.deepEqual(session.metadata, {});
});

test('listPiSessionsByWorkspace returns rows ordered by last update', async (t) => {
	const { database } = openTestDatabase(t);

	const first = createPiSession({
		database,
		input: { cwd: '/tmp/a', workspaceId: 'ws-real' },
	});
	// Small delay so the millisecond-precision `updated_at` advances reliably.
	await new Promise((resolve) => setTimeout(resolve, 5));
	const second = createPiSession({
		database,
		input: { cwd: '/tmp/b', workspaceId: 'ws-real' },
	});

	const sessions = listPiSessionsByWorkspace({
		database,
		workspaceId: 'ws-real',
	});
	assert.equal(sessions.length, 2);
	assert.equal(sessions[0]?.id, second.session.id);
	assert.equal(sessions[1]?.id, first.session.id);
});

test('updatePiSession patches status, model, thinking, pi session id', (t) => {
	const { database } = openTestDatabase(t);

	const { session } = createPiSession({
		database,
		input: { cwd: '/tmp/a', workspaceId: 'ws-real' },
	});

	const patched = updatePiSession({
		database,
		id: session.id,
		patch: {
			model: 'gpt-5.5',
			piSessionId: 'pi-runtime-99',
			status: 'streaming',
			thinkingLevel: 'medium',
		},
	});

	assert.equal(patched?.status, 'streaming');
	assert.equal(patched?.model, 'gpt-5.5');
	assert.equal(patched?.thinkingLevel, 'medium');
	assert.equal(patched?.piSessionId, 'pi-runtime-99');

	const closed = updatePiSession({
		database,
		id: session.id,
		patch: { closedAt: '2026-06-08T12:00:00.000Z', status: 'closed' },
	});
	assert.equal(closed?.status, 'closed');
	assert.equal(closed?.closedAt, '2026-06-08T12:00:00.000Z');
});

test('createBranch creates a retry branch chained to a parent and turn', (t) => {
	const { database } = openTestDatabase(t);

	const { mainBranch, session } = createPiSession({
		database,
		input: { cwd: '/tmp/a', workspaceId: 'ws-real' },
	});

	const turn = createTurn({
		database,
		input: { branchId: mainBranch.id, promptText: 'first prompt' },
	});

	const retry = createBranch({
		database,
		forkedFromTurnId: turn.id,
		kind: 'retry',
		parentBranchId: mainBranch.id,
		piSessionId: session.id,
	});

	assert.equal(retry.kind, 'retry');
	assert.equal(retry.parentBranchId, mainBranch.id);
	assert.equal(retry.forkedFromTurnId, turn.id);

	const branches = listPiSessionBranches({
		database,
		piSessionId: session.id,
	});
	assert.equal(branches.length, 2);
});

test('createTurn auto-increments ordinals per branch', (t) => {
	const { database } = openTestDatabase(t);

	const { mainBranch } = createPiSession({
		database,
		input: { cwd: '/tmp/a', workspaceId: 'ws-real' },
	});

	const first = createTurn({
		database,
		input: { branchId: mainBranch.id, promptText: 'hello' },
	});
	const second = createTurn({
		database,
		input: { branchId: mainBranch.id, promptText: 'follow up' },
	});

	assert.equal(first.ordinal, 0);
	assert.equal(second.ordinal, 1);

	const turns = listTurns({ database, branchId: mainBranch.id });
	assert.deepEqual(
		turns.map((t) => t.id),
		[first.id, second.id],
	);
});

test('updateTurn marks completion and persists turn metadata', (t) => {
	const { database } = openTestDatabase(t);

	const { mainBranch } = createPiSession({
		database,
		input: { cwd: '/tmp/a', workspaceId: 'ws-real' },
	});
	const turn = createTurn({
		database,
		input: { branchId: mainBranch.id, promptText: 'work' },
	});

	const completed = updateTurn({
		database,
		id: turn.id,
		patch: {
			completedAt: '2026-06-08T12:00:00.000Z',
			status: 'completed',
			turnMetadata: { tokensIn: 12, tokensOut: 88 },
		},
	});

	assert.equal(completed?.status, 'completed');
	assert.equal(completed?.completedAt, '2026-06-08T12:00:00.000Z');
	assert.deepEqual(completed?.turnMetadata, { tokensIn: 12, tokensOut: 88 });
});

test('getPiSessionById returns null when nothing matches', (t) => {
	const { database } = openTestDatabase(t);
	assert.equal(getPiSessionById({ database, id: 'missing' }), null);
});
