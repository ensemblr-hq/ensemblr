import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PiExecutableSnapshot } from '../../src/main/pi/pi-executable.ts';
import { createFakePiAgentAdapter } from '../../src/main/pi-agent/fake-pi-agent-client.ts';
import { createPiAgentClient } from '../../src/main/pi-agent/pi-agent-client.ts';
import { createPiSessionService } from '../../src/main/pi-agent/pi-session-service.ts';
import { openEnsembleDatabase } from '../../src/main/storage/database.ts';
import { listEventsByBranch } from '../../src/main/storage/repositories/pi-event-repository.ts';

function openFixture(t: import('node:test').TestContext): {
	database: DatabaseSync;
	workspaceId: string;
} {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-pi-svc-'));
	const connection = openEnsembleDatabase({
		databasePath: path.join(directory, 'pi-svc-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-svc', 'svc', 'Svc', '/tmp/ensemble/svc', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-svc', 'repo-svc', 'svc', 'Svc', '/tmp/ensemble/svc/ws');
`);
	return { database: connection.database, workspaceId: 'ws-svc' };
}

function createReadyExecutable(): PiExecutableSnapshot {
	return {
		command: '/usr/local/bin/pi',
		diagnostics: [],
		displayPath: '/usr/local/bin/pi',
		path: '/usr/local/bin/pi',
		probe: null,
		setting: null,
		source: null,
		status: 'ok',
		updatedAt: '2026-06-08T00:00:00.000Z',
	};
}

function createService(database: DatabaseSync) {
	const fake = createFakePiAgentAdapter();
	const piAgentClient = createPiAgentClient({ adapter: fake.adapter });
	const service = createPiSessionService({
		databaseService: {
			close: () => undefined,
			getConnection: () => ({ database, path: ':memory:', schemaVersion: 5 }),
			getHealth: () => ({ path: ':memory:', schemaVersion: 5, status: 'ok' }),
			open: () => ({ path: ':memory:', schemaVersion: 5, status: 'ok' }),
		},
		piAgentClient,
	});
	return { fake, service };
}

test('openSession persists a pi_sessions row plus a main branch', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		label: 'first chat',
		workspaceCwd: '/tmp/ensemble/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	assert.equal(snapshot.workspaceId, fixture.workspaceId);
	assert.equal(snapshot.label, 'first chat');
	assert.equal(snapshot.status, 'starting');
	assert.equal(snapshot.openedTabs.length, 1);
});

test('submitPrompt creates a turn and forwards to the runtime session', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemble/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const ack = await service.submitPrompt({
		prompt: 'hello pi',
		sessionId: snapshot.id,
	});

	assert.ok(ack.turnId);
	assert.ok(ack.acceptedAt);

	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	const requests = runtime.getRequests();
	assert.equal(requests.length, 1);
	assert.equal(requests[0]?.prompt, 'hello pi');
});

test('runtime events are mirrored into pi_session_events', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemble/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({
		prompt: 'do work',
		sessionId: snapshot.id,
	});

	const runtime = fake.getOpenSessions()[0]!;
	runtime.emit({
		at: '2026-06-08T00:00:00.000Z',
		payload: { text: 'agent reply' },
		role: 'agent',
		turnId: 'fake-turn',
		type: 'message',
	});

	const events = listEventsByBranch({
		branchId: snapshot.branchId,
		database: fixture.database,
	});
	assert.ok(events.some((event) => event.eventType === 'message'));
});

test('stopSession aborts the runtime and marks the turn aborted', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemble/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({
		prompt: 'task',
		sessionId: snapshot.id,
	});
	await service.stopSession({ sessionId: snapshot.id });

	const runtime = fake.getOpenSessions();
	assert.equal(runtime.length, 0, 'fake adapter should drop closed sessions');
});

test('listSessionsForWorkspace returns active and persisted sessions', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemble/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const sessions = service.listSessionsForWorkspace(fixture.workspaceId);
	assert.equal(sessions.length, 1);
	assert.equal(sessions[0]?.workspaceId, fixture.workspaceId);
});
