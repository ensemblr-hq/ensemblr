import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { openEnsembleDatabase } from '../../src/main/storage/database.ts';
import {
	appendPiEvent,
	appendPiEvents,
	listEventsByBranch,
	listEventsByTurn,
} from '../../src/main/storage/repositories/pi-event-repository.ts';
import {
	createPiSession,
	createTurn,
} from '../../src/main/storage/repositories/pi-session-repository.ts';

interface Fixture {
	branchId: string;
	database: DatabaseSync;
	turnId: string;
}

function openFixture(t: import('node:test').TestContext): Fixture {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-pi-event-'));
	const connection = openEnsembleDatabase({
		databasePath: path.join(directory, 'pi-event-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-evt', 'evt', 'Evt', '/tmp/ensemble/evt', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-evt', 'repo-evt', 'evt', 'Evt', '/tmp/ensemble/evt/ws');
`);

	const { mainBranch } = createPiSession({
		database: connection.database,
		input: { cwd: '/tmp/ensemble/evt/ws', workspaceId: 'ws-evt' },
	});
	const turn = createTurn({
		database: connection.database,
		input: { branchId: mainBranch.id, promptText: 'hello' },
	});

	return {
		branchId: mainBranch.id,
		database: connection.database,
		turnId: turn.id,
	};
}

test('appendPiEvent allocates ordinals starting at zero', (t) => {
	const fixture = openFixture(t);

	const first = appendPiEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: {
				kind: 'message',
				payload: { kind: 'text', text: 'hi' },
				role: 'user',
			},
			turnId: fixture.turnId,
		},
	});
	const second = appendPiEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: {
				kind: 'message',
				payload: { kind: 'text', text: 'hello' },
				role: 'agent',
			},
			turnId: fixture.turnId,
		},
	});

	assert.equal(first.ordinal, 0);
	assert.equal(second.ordinal, 1);
	assert.equal(first.stream, 'protocol');
	assert.deepEqual(first.payload, {
		kind: 'message',
		payload: { kind: 'text', text: 'hi' },
		role: 'user',
	});
});

test('appendPiEvent persists the supplied createdAt verbatim', (t) => {
	const fixture = openFixture(t);

	const withTimestamp = appendPiEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			createdAt: '2026-06-08T12:34:56.789Z',
			eventType: 'message',
			payload: {
				kind: 'message',
				payload: { kind: 'text', text: 'x' },
				role: 'agent',
			},
			turnId: fixture.turnId,
		},
	});
	assert.equal(withTimestamp.createdAt, '2026-06-08T12:34:56.789Z');

	// Omitting createdAt falls back to the DB clock (a non-empty ISO string).
	const withoutTimestamp = appendPiEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: {
				kind: 'message',
				payload: { kind: 'text', text: 'y' },
				role: 'agent',
			},
			turnId: fixture.turnId,
		},
	});
	assert.match(withoutTimestamp.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('appendPiEvents batches inserts in a single transaction', (t) => {
	const fixture = openFixture(t);

	const inserted = appendPiEvents({
		branchId: fixture.branchId,
		database: fixture.database,
		events: [
			{
				eventType: 'status',
				payload: { kind: 'status', previous: 'idle', status: 'starting' },
			},
			{
				eventType: 'message',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'one' },
					role: 'agent',
				},
				turnId: fixture.turnId,
			},
			{
				eventType: 'stderr',
				payload: {
					kind: 'error',
					error: { message: 'warning x' },
				},
				stream: 'stderr',
			},
		],
	});

	assert.deepEqual(
		inserted.map((event) => event.ordinal),
		[0, 1, 2],
	);
	assert.equal(inserted[2]?.stream, 'stderr');

	const persisted = listEventsByBranch({
		branchId: fixture.branchId,
		database: fixture.database,
	});
	assert.equal(persisted.length, 3);
});

test('listEventsByBranch supports fromOrdinal and limit', (t) => {
	const fixture = openFixture(t);

	appendPiEvents({
		branchId: fixture.branchId,
		database: fixture.database,
		events: Array.from({ length: 5 }, (_, index) => ({
			eventType: 'message',
			payload: {
				kind: 'message' as const,
				payload: { kind: 'text' as const, text: `msg-${index}` },
				role: 'agent' as const,
			},
		})),
	});

	const slice = listEventsByBranch({
		branchId: fixture.branchId,
		database: fixture.database,
		fromOrdinal: 2,
		limit: 2,
	});
	assert.deepEqual(
		slice.map((event) => event.ordinal),
		[2, 3],
	);
});

test('listEventsByTurn filters by turn id', (t) => {
	const fixture = openFixture(t);

	appendPiEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: {
				kind: 'message',
				payload: { kind: 'text', text: 'ok' },
				role: 'agent',
			},
			turnId: fixture.turnId,
		},
	});
	appendPiEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			eventType: 'status',
			payload: { kind: 'status', previous: 'starting', status: 'idle' },
		},
	});

	const turnEvents = listEventsByTurn({
		database: fixture.database,
		turnId: fixture.turnId,
	});
	assert.equal(turnEvents.length, 1);
	assert.equal(turnEvents[0]?.eventType, 'message');
});

test('stderr events are stored on a separate stream and never marked protocol', (t) => {
	const fixture = openFixture(t);

	appendPiEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			eventType: 'stderr-line',
			payload: { kind: 'error', error: { message: 'pi: bad json' } },
			stream: 'stderr',
		},
	});

	const events = listEventsByBranch({
		branchId: fixture.branchId,
		database: fixture.database,
	});
	assert.equal(events[0]?.stream, 'stderr');
});
