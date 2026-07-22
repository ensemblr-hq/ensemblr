/// <reference types="node" />

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createFakePiAgentAdapter } from '../../src/main/pi-agent/fake-pi-agent-client.ts';
import { createPiAgentClient } from '../../src/main/pi-agent/pi-agent-client.ts';
import { createPiSessionService } from '../../src/main/pi-agent/pi-session-service.ts';
import type {
	SessionSummaryWriter,
	WriteSessionSummaryInput,
} from '../../src/main/pi-agent/session-summary-writer.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	getChatTabById,
	listOpenChatTabs,
	openChatTab,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';
import { listEventsByBranch } from '../../src/main/storage/repositories/pi-event-repository.ts';
import { getPiSessionById } from '../../src/main/storage/repositories/pi-session-repository.ts';

function openFixture(t: import('node:test').TestContext): {
	database: DatabaseSync;
	workspaceId: string;
} {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-pi-svc-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'pi-svc-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-svc', 'svc', 'Svc', '/tmp/ensemblr/svc', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-svc', 'repo-svc', 'svc', 'Svc', '/tmp/ensemblr/svc/ws');
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

function createService(
	database: DatabaseSync,
	options: {
		sessionSummaryWriter?: SessionSummaryWriter;
	} = {},
) {
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
		queueNaming: () => undefined,
		sessionSummaryWriter: options.sessionSummaryWriter,
	});
	return { fake, service };
}

async function waitForSummaryCalls(
	calls: readonly WriteSessionSummaryInput[],
	count: number,
): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (calls.length >= count) {
			return;
		}
		await delay(5);
	}
	assert.equal(calls.length, count);
}

test('openSession persists a pi_sessions row plus a main branch', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		label: 'first chat',
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	assert.equal(snapshot.workspaceId, fixture.workspaceId);
	assert.equal(snapshot.label, 'first chat');
	assert.equal(snapshot.status, 'starting');
	assert.equal(snapshot.openedTabs.length, 1);
});

test('getSession reports live status for an active session, not a frozen starting snapshot', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	assert.equal(snapshot.status, 'starting');

	await service.submitPrompt({ prompt: 'task', sessionId: snapshot.id });
	assert.equal(
		service.getSession(snapshot.id)?.status,
		'streaming',
		'status must advance past starting once the turn opens',
	);

	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	runtime.setStatus('idle');
	await delay(10);
	assert.equal(
		service.getSession(snapshot.id)?.status,
		'idle',
		'status must reflect the runtime idle event, not the cached open-time row',
	);
});

test('openSession binds an existing chat tab without opening a duplicate', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);
	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			piSessionId: null,
			title: 'Existing tab',
			workspaceId: fixture.workspaceId,
		},
	});

	const snapshot = await service.openSession({
		chatTabId: tab.id,
		executable: createReadyExecutable(),
		label: 'bound chat',
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const tabs = listOpenChatTabs({
		database: fixture.database,
		workspaceId: fixture.workspaceId,
	});

	assert.equal(snapshot.openedTabs.length, 1);
	assert.equal(tabs.length, 1);
	assert.equal(tabs[0]?.id, tab.id);
	assert.equal(tabs[0]?.piSessionId, snapshot.id);
	assert.equal(tabs[0]?.title, 'Existing tab');
});

test('setSessionName renames the active tab and marks the title user-owned', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const tabId = snapshot.openedTabs[0]?.id;
	assert.ok(tabId);

	const applied = await service.setSessionName({
		sessionId: snapshot.id,
		name: 'Refactor auth flow',
	});

	assert.deepEqual(applied, { chatTabId: tabId, title: 'Refactor auth flow' });
	const tab = getChatTabById({ database: fixture.database, id: tabId });
	assert.equal(tab?.title, 'Refactor auth flow');
	assert.equal(tab?.metadata.titleProvenance, 'user');
});

test('setSessionName resolves null for a session that is not active', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	const applied = await service.setSessionName({
		sessionId: 'missing-session',
		name: 'Whatever',
	});

	assert.equal(applied, null);
});

test('openSession persists and launches with a native Pi session id', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	const row = getPiSessionById({
		database: fixture.database,
		id: snapshot.id,
	});
	const runtime = fake.getOpenSessions()[0];
	assert.ok(row?.piSessionId);
	assert.equal(snapshot.runtimeOpen, true);
	assert.equal(runtime?.getMetadata().sessionId, row.piSessionId);
	assert.deepEqual(runtime?.getMetadata().args.slice(-2), [
		'--session-id',
		row.piSessionId,
	]);
});

test('openSession resumes a closed persisted session before submit', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const first = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const nativeSessionId = first.piSessionId;
	await service.shutdown();

	const resumed = await service.openSession({
		executable: createReadyExecutable(),
		resumeSessionId: first.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({
		prompt: 'continue work',
		sessionId: resumed.id,
	});

	const runtime = fake.getOpenSessions()[0];
	assert.equal(resumed.id, first.id);
	assert.equal(resumed.runtimeOpen, true);
	assert.equal(runtime?.getMetadata().sessionId, nativeSessionId);
	assert.equal(runtime?.getRequests()[0]?.prompt, 'continue work');
});

test('submitPrompt creates a turn and forwards to the runtime session', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
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
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({
		prompt: 'do work',
		sessionId: snapshot.id,
	});

	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	runtime.emit({
		at: '2026-06-08T00:00:00.000Z',
		payload: { kind: 'text', text: 'agent reply' },
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

test('writes the chat summary at the turn boundary, not mid-turn', async (t) => {
	const fixture = openFixture(t);
	const summaryCalls: WriteSessionSummaryInput[] = [];
	const sessionSummaryWriter: SessionSummaryWriter = {
		writeSessionSummary: async (input) => {
			summaryCalls.push(input);
			return {
				path: `${input.workspaceCwd}/.context/sessions/${input.chatTabId}.md`,
				title: 'Live summary',
				usedLlm: false,
			};
		},
	};
	const { fake, service } = createService(fixture.database, {
		sessionSummaryWriter,
	});

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({
		prompt: 'summarize after this turn',
		sessionId: snapshot.id,
	});

	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	runtime.emit({
		at: '2026-06-08T00:00:01.000Z',
		payload: { kind: 'text', text: 'agent reply' },
		role: 'agent',
		turnId: 'fake-turn',
		type: 'message',
	});

	// Deferred: a mid-turn agent message must not trigger a write, or `.context/`
	// would materialize before a first-turn scaffolder could run.
	await delay(20);
	assert.equal(summaryCalls.length, 0, 'summary must wait for the turn to end');

	// The turn boundary (status: idle) is what drains the queue.
	runtime.setStatus('idle');
	await waitForSummaryCalls(summaryCalls, 1);

	const summaryInput = summaryCalls[0];
	assert.ok(summaryInput);
	const tabId = snapshot.openedTabs[0]?.id;
	assert.equal(summaryInput.chatTabId, tabId);
	assert.equal(summaryInput.branchId, snapshot.branchId);
	const summaryMessages = summaryInput.events.filter(
		(event) => event.payload?.kind === 'message',
	);
	assert.equal(summaryMessages.length, 2);
	assert.deepEqual(
		summaryMessages.map((event) => event.payload?.kind),
		['message', 'message'],
	);
	const tab = tabId
		? getChatTabById({ database: fixture.database, id: tabId })
		: null;
	assert.deepEqual(tab?.metadata.summary, {
		path: `/tmp/ensemblr/svc/ws/.context/sessions/${tabId}.md`,
		title: 'Live summary',
		usedLlm: false,
	});
});

test('stopSession flushes the owed summary before closing', async (t) => {
	const fixture = openFixture(t);
	const summaryCalls: WriteSessionSummaryInput[] = [];
	const sessionSummaryWriter: SessionSummaryWriter = {
		writeSessionSummary: async (input) => {
			summaryCalls.push(input);
			return {
				path: `${input.workspaceCwd}/.context/sessions/${input.chatTabId}.md`,
				title: 'Closed summary',
				usedLlm: false,
			};
		},
	};
	const { fake, service } = createService(fixture.database, {
		sessionSummaryWriter,
	});

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({ prompt: 'work', sessionId: snapshot.id });

	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	// Agent responds but the turn never reaches idle before the user stops it.
	runtime.emit({
		at: '2026-06-08T00:00:01.000Z',
		payload: { kind: 'text', text: 'partial reply' },
		role: 'agent',
		turnId: 'fake-turn',
		type: 'message',
	});
	await delay(20);
	assert.equal(summaryCalls.length, 0, 'no summary before close');

	// Closing must flush the owed summary even though no idle event arrived.
	await service.stopSession({ sessionId: snapshot.id });
	await waitForSummaryCalls(summaryCalls, 1);
	assert.equal(summaryCalls.length, 1, 'exactly one summary flushed on close');
});

test('stopSession aborts the runtime and marks the turn aborted', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
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

test('stopSession leaves the session chat tab open for resume', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({ prompt: 'task', sessionId: snapshot.id });
	const tabId = snapshot.openedTabs[0]?.id;
	assert.ok(tabId, 'expected the opened session to have a chat tab');

	await service.stopSession({ sessionId: snapshot.id });

	const openTabs = listOpenChatTabs({
		database: fixture.database,
		workspaceId: fixture.workspaceId,
	});
	assert.equal(
		openTabs.length,
		1,
		'stopping a turn must not close the chat tab',
	);
	assert.equal(openTabs[0]?.id, tabId);
	assert.equal(
		getChatTabById({ database: fixture.database, id: tabId })?.piSessionId,
		snapshot.id,
	);
	assert.equal(
		getPiSessionById({ database: fixture.database, id: snapshot.id })?.status,
		'closed',
		'the runtime is gone so the persisted session reads closed',
	);
});

test('stopSession aborts without waiting for slow summary flushing', async (t) => {
	const fixture = openFixture(t);
	const sessionSummaryWriter: SessionSummaryWriter = {
		writeSessionSummary: () => new Promise(() => undefined),
	};
	const { fake, service } = createService(fixture.database, {
		sessionSummaryWriter,
	});

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({ prompt: 'task', sessionId: snapshot.id });

	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	runtime.emit({
		at: '2026-06-08T00:00:01.000Z',
		payload: { kind: 'text', text: 'partial reply' },
		role: 'agent',
		turnId: 'fake-turn',
		type: 'message',
	});

	const outcome = await Promise.race([
		service
			.stopSession({ sessionId: snapshot.id })
			.then(() => 'stopped' as const),
		delay(25).then(() => 'timed-out' as const),
	]);

	assert.equal(outcome, 'stopped');
	assert.equal(fake.getOpenSessions().length, 0);
});

test('listSessionsForWorkspace returns active and persisted sessions', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const sessions = service.listSessionsForWorkspace(fixture.workspaceId);
	assert.equal(sessions.length, 1);
	assert.equal(sessions[0]?.workspaceId, fixture.workspaceId);
});
