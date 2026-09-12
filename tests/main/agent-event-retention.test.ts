import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { appendAgentEvent } from '../../src/main/storage/repositories/agent-event-repository.ts';
import { pruneAgentEventHistory } from '../../src/main/storage/repositories/agent-event-retention.ts';
import {
	createAgentSession,
	updateAgentSession,
} from '../../src/main/storage/repositories/agent-session-repository.ts';

const directories: string[] = [];

interface Fixture {
	branchId: string;
	database: DatabaseSync;
	sessionId: string;
}

function openFixture(suffix: string): Fixture {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-retention-'));
	directories.push(directory);
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, `${suffix}.db`),
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-ret', 'ret', 'Ret', '/tmp/ensemblr/ret', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-ret', 'repo-ret', 'ret', 'Ret', '/tmp/ensemblr/ret/ws');
`);
	const { mainBranch, session } = createAgentSession({
		database: connection.database,
		input: { cwd: '/tmp/ensemblr/ret/ws', workspaceId: 'ws-ret' },
	});
	return {
		branchId: mainBranch.id,
		database: connection.database,
		sessionId: session.id,
	};
}

function appendEvents(fixture: Fixture, count: number): void {
	for (let index = 0; index < count; index += 1) {
		appendAgentEvent({
			database: fixture.database,
			input: {
				branchId: fixture.branchId,
				eventType: 'message',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: `event ${index}` },
					role: 'agent',
				},
			},
		});
	}
}

function countEvents(fixture: Fixture): number {
	const row = fixture.database
		.prepare('SELECT COUNT(*) AS count FROM agent_session_events')
		.get() as { count: number };
	return row.count;
}

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe('pruneAgentEventHistory', () => {
	it('keeps only the newest events of a branch', () => {
		const fixture = openFixture('tail');
		appendEvents(fixture, 120);

		const result = pruneAgentEventHistory({
			database: fixture.database,
			maxEventsPerBranch: 50,
		});

		expect(result.agentByTail).toBe(70);
		expect(countEvents(fixture)).toBe(50);
		const oldest = fixture.database
			.prepare('SELECT MIN(ordinal) AS min FROM agent_session_events')
			.get() as { min: number };
		expect(oldest.min).toBe(70);
	});

	it('leaves a branch inside the cap untouched', () => {
		const fixture = openFixture('under-cap');
		appendEvents(fixture, 10);

		const result = pruneAgentEventHistory({
			database: fixture.database,
			maxEventsPerBranch: 500,
		});

		expect(result.agentByTail).toBe(0);
		expect(countEvents(fixture)).toBe(10);
	});

	it('drops every event of a session closed beyond the retention window', () => {
		const fixture = openFixture('age');
		appendEvents(fixture, 5);
		updateAgentSession({
			database: fixture.database,
			id: fixture.sessionId,
			patch: { closedAt: '2026-01-01T00:00:00.000Z', status: 'closed' },
		});

		const result = pruneAgentEventHistory({
			database: fixture.database,
			now: new Date('2026-03-01T00:00:00.000Z'),
			retentionDays: 30,
		});

		expect(result.agentByAge).toBe(5);
		expect(countEvents(fixture)).toBe(0);
	});

	it('keeps a session closed inside the retention window', () => {
		const fixture = openFixture('recent-close');
		appendEvents(fixture, 5);
		updateAgentSession({
			database: fixture.database,
			id: fixture.sessionId,
			patch: { closedAt: '2026-02-25T00:00:00.000Z', status: 'closed' },
		});

		const result = pruneAgentEventHistory({
			database: fixture.database,
			now: new Date('2026-03-01T00:00:00.000Z'),
			retentionDays: 30,
		});

		expect(result.agentByAge).toBe(0);
		expect(countEvents(fixture)).toBe(5);
	});

	it('prunes Concierge transcripts by the same two rules', () => {
		const fixture = openFixture('concierge');
		fixture.database.exec(`
INSERT INTO concierge_sessions (id, cwd, closed_at) VALUES ('cs-old', '/tmp', '2026-01-01T00:00:00.000Z');
INSERT INTO concierge_sessions (id, cwd) VALUES ('cs-live', '/tmp');
`);
		const insert = fixture.database.prepare(
			'INSERT INTO concierge_session_events (id, session_id, ordinal, event_type) VALUES (?, ?, ?, ?)',
		);
		for (let index = 0; index < 4; index += 1) {
			insert.run(`old-${index}`, 'cs-old', index, 'message');
		}
		for (let index = 0; index < 12; index += 1) {
			insert.run(`live-${index}`, 'cs-live', index, 'message');
		}

		const result = pruneAgentEventHistory({
			database: fixture.database,
			maxEventsPerBranch: 5,
			now: new Date('2026-03-01T00:00:00.000Z'),
		});

		expect(result.conciergeByAge).toBe(4);
		expect(result.conciergeByTail).toBe(7);
		const remaining = fixture.database
			.prepare('SELECT COUNT(*) AS count FROM concierge_session_events')
			.get() as { count: number };
		expect(remaining.count).toBe(5);
	});
});
