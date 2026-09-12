import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	appendAgentEvent,
	appendAgentEvents,
	listBranchEventTail,
	listEventsByBranch,
	listEventsByTurn,
} from '../../src/main/storage/repositories/agent-event-repository.ts';
import {
	createAgentSession,
	createTurn,
} from '../../src/main/storage/repositories/agent-session-repository.ts';

interface Fixture {
	branchId: string;
	database: DatabaseSync;
	turnId: string;
}

function openFixture(t: import('node:test').TestContext): Fixture {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-agent-event-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'agent-event-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-evt', 'evt', 'Evt', '/tmp/ensemblr/evt', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-evt', 'repo-evt', 'evt', 'Evt', '/tmp/ensemblr/evt/ws');
`);

	const { mainBranch } = createAgentSession({
		database: connection.database,
		input: { cwd: '/tmp/ensemblr/evt/ws', workspaceId: 'ws-evt' },
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

test('appendAgentEvent allocates ordinals starting at zero', (t) => {
	const fixture = openFixture(t);

	const first = appendAgentEvent({
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
	const second = appendAgentEvent({
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

test('appendAgentEvent persists the supplied createdAt verbatim', (t) => {
	const fixture = openFixture(t);

	const withTimestamp = appendAgentEvent({
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
	const withoutTimestamp = appendAgentEvent({
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

test('appendAgentEvents batches inserts in a single transaction', (t) => {
	const fixture = openFixture(t);

	const inserted = appendAgentEvents({
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

	appendAgentEvents({
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

	appendAgentEvent({
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
	appendAgentEvent({
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

	appendAgentEvent({
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

test('a subagent link round-trips through payload_json', (t) => {
	const fixture = openFixture(t);

	appendAgentEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: {
				kind: 'message',
				parentToolCallId: 'toolu_task_1',
				payload: { kind: 'text', text: 'delegate prose' },
				role: 'agent',
			},
			turnId: fixture.turnId,
		},
	});

	const [stored] = listEventsByBranch({
		branchId: fixture.branchId,
		database: fixture.database,
	});
	assert.deepEqual(stored?.payload, {
		kind: 'message',
		parentToolCallId: 'toolu_task_1',
		payload: { kind: 'text', text: 'delegate prose' },
		role: 'agent',
	});
});

test('a row written without a subagent link reads back without the key', (t) => {
	const fixture = openFixture(t);

	appendAgentEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: {
				kind: 'message',
				payload: { kind: 'text', text: 'main thread prose' },
				role: 'agent',
			},
			turnId: fixture.turnId,
		},
	});

	const [stored] = listEventsByBranch({
		branchId: fixture.branchId,
		database: fixture.database,
	});
	assert.equal(
		stored !== undefined &&
			Object.hasOwn(stored.payload ?? {}, 'parentToolCallId'),
		false,
	);
});

/**
 * Counts the SQL a call issues by handing the repository a proxy that forwards
 * to the real connection. Statement caching is per connection, so the proxy has
 * to be the same object across the calls being measured.
 */
function countingDatabase(database: DatabaseSync): {
	exec: string[];
	prepare: string[];
	proxy: DatabaseSync;
} {
	const exec: string[] = [];
	const prepare: string[] = [];
	const proxy = new Proxy(database, {
		get(target, property, receiver) {
			if (property === 'prepare') {
				return (sql: string) => {
					prepare.push(sql);
					return target.prepare(sql);
				};
			}
			if (property === 'exec') {
				return (sql: string) => {
					exec.push(sql);
					return target.exec(sql);
				};
			}
			return Reflect.get(target, property, receiver);
		},
	}) as DatabaseSync;

	return { exec, prepare, proxy };
}

test('appendAgentEvent issues one statement per event and compiles it once', (t) => {
	const fixture = openFixture(t);
	const counted = countingDatabase(fixture.database);

	for (let index = 0; index < 3; index += 1) {
		appendAgentEvent({
			database: counted.proxy,
			input: {
				branchId: fixture.branchId,
				eventType: 'message',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: `msg-${index}` },
					role: 'agent',
				},
			},
		});
	}

	assert.deepEqual(counted.exec, []);
	assert.equal(counted.prepare.length, 1);
	assert.match(counted.prepare[0] ?? '', /^INSERT INTO agent_session_events/);
	assert.deepEqual(
		listEventsByBranch({
			branchId: fixture.branchId,
			database: fixture.database,
		}).map((event) => event.ordinal),
		[0, 1, 2],
	);
});

test('appendAgentEvent caps an oversized payload and reports the loss', (t) => {
	const fixture = openFixture(t);

	const row = appendAgentEvent({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: {
				kind: 'message',
				payload: {
					isError: false,
					kind: 'tool-result',
					output: 'x'.repeat(2_000_000),
					toolCallId: 'call-1',
				},
				role: 'tool',
			},
		},
	});

	const stored = fixture.database
		.prepare('SELECT LENGTH(payload_json) AS length FROM agent_session_events')
		.get() as { length: number };

	assert.equal(stored.length < 300_000, true);
	if (row.payload?.kind !== 'message') {
		throw new Error('expected a message envelope');
	}
	if (row.payload.payload.kind !== 'tool-result') {
		throw new Error('expected a tool-result payload');
	}
	assert.equal(
		(row.payload.payload.truncatedBytes ?? 0) > 1_000_000,
		true,
		'the broadcast row carries what was persisted, truncation included',
	);
});

test('listBranchEventTail returns the newest window, not the oldest', (t) => {
	const fixture = openFixture(t);
	appendAgentEvents({
		branchId: fixture.branchId,
		database: fixture.database,
		events: Array.from({ length: 10 }, (_, index) => ({
			eventType: 'message',
			payload: {
				kind: 'message' as const,
				payload: { kind: 'text' as const, text: `msg-${index}` },
				role: 'agent' as const,
			},
		})),
	});

	const tail = listBranchEventTail({
		branchId: fixture.branchId,
		database: fixture.database,
		limit: 3,
	});
	const older = listBranchEventTail({
		beforeOrdinal: tail.events[0]?.ordinal,
		branchId: fixture.branchId,
		database: fixture.database,
		limit: 3,
	});
	const whole = listBranchEventTail({
		branchId: fixture.branchId,
		database: fixture.database,
		limit: 50,
	});

	assert.deepEqual(
		tail.events.map((event) => event.ordinal),
		[7, 8, 9],
	);
	assert.equal(tail.hasOlder, true);
	assert.deepEqual(
		older.events.map((event) => event.ordinal),
		[4, 5, 6],
	);
	assert.equal(whole.events.length, 10);
	assert.equal(whole.hasOlder, false);
});
