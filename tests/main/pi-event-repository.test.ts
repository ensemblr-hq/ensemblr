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
			payload: { role: 'user', text: 'hi' },
			turnId: fixture.turnId,
		},
	});
	const second = appendPiEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: { role: 'agent', text: 'hello' },
			turnId: fixture.turnId,
		},
	});

	assert.equal(first.ordinal, 0);
	assert.equal(second.ordinal, 1);
	assert.equal(first.stream, 'protocol');
	assert.deepEqual(first.payload, { role: 'user', text: 'hi' });
});

test('appendPiEvents batches inserts in a single transaction', (t) => {
	const fixture = openFixture(t);

	const inserted = appendPiEvents({
		branchId: fixture.branchId,
		database: fixture.database,
		events: [
			{ eventType: 'status', payload: { status: 'starting' } },
			{
				eventType: 'message',
				payload: { role: 'agent', text: 'one' },
				turnId: fixture.turnId,
			},
			{
				eventType: 'stderr',
				payload: { line: 'warning x' },
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
			payload: { index },
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
			payload: { ok: true },
			turnId: fixture.turnId,
		},
	});
	appendPiEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			eventType: 'status',
			payload: { status: 'idle' },
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
			payload: { line: 'pi: bad json' },
			stream: 'stderr',
		},
	});

	const events = listEventsByBranch({
		branchId: fixture.branchId,
		database: fixture.database,
	});
	assert.equal(events[0]?.stream, 'stderr');
});
