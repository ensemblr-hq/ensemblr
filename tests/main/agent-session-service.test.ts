/// <reference types="node" />

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentAdapter } from '../../src/main/agent-runtime/agent-adapter.ts';
import { createAgentClient } from '../../src/main/agent-runtime/agent-client.ts';
import {
	type AgentSessionEventSink,
	createAgentSessionService,
} from '../../src/main/agent-runtime/agent-session-service.ts';
import { createFakeAgentAdapter } from '../../src/main/agent-runtime/fake-agent-adapter.ts';
import type {
	SessionSummaryWriter,
	WriteSessionSummaryInput,
} from '../../src/main/agent-runtime/session-summary-writer.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { listEventsByBranch } from '../../src/main/storage/repositories/agent-event-repository.ts';
import { getAgentSessionById } from '../../src/main/storage/repositories/agent-session-repository.ts';
import {
	getChatTabById,
	listOpenChatTabs,
	openChatTab,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';

function openFixture(t: import('node:test').TestContext): {
	database: DatabaseSync;
	workspaceId: string;
} {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-agent-svc-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'agent-svc-test.db'),
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

// The CLI adapter's `abort()` only signals the child: the `shutdown` event
// lands later, on process exit, once `stopSession` already dropped the session
// from the active map. The fake emits it inline, so tests that care about that
// tail opt into this wrapper.
function deferAbortUntilExit(adapter: AgentAdapter): AgentAdapter {
	return {
		createSession: async (input) => {
			const session = await adapter.createSession(input);
			return {
				...session,
				abort: async (reason) => {
					setTimeout(() => {
						void session.abort(reason);
					}, 0);
				},
			};
		},
		shutdown: adapter.shutdown,
	};
}

// A runtime that refuses to die is exactly the case a stop cascade exists for,
// so the fake has to be able to reject an abort the way a wedged child would.
function rejectAbortForSession(
	adapter: AgentAdapter,
	shouldReject: (index: number) => boolean,
): AgentAdapter {
	let created = 0;
	return {
		createSession: async (input) => {
			const session = await adapter.createSession(input);
			const index = created;
			created += 1;
			if (!shouldReject(index)) {
				return session;
			}
			return {
				...session,
				abort: async () => {
					throw new Error('runtime is wedged');
				},
			};
		},
		shutdown: adapter.shutdown,
	};
}

// `refreshPlanUsage` is optional on the adapter contract, and the fake omits it
// the way a runtime with no plan reporting does. A test about the answering path
// opts one in.
function answerPlanUsage(
	adapter: AgentAdapter,
	refreshPlanUsage: () => Promise<boolean>,
): AgentAdapter {
	return {
		createSession: async (input) => ({
			...(await adapter.createSession(input)),
			refreshPlanUsage,
		}),
		shutdown: adapter.shutdown,
	};
}

function resolveAdapter(
	fake: ReturnType<typeof createFakeAgentAdapter>,
	options: {
		deferAbort?: boolean;
		refreshPlanUsage?: () => Promise<boolean>;
		rejectAbortFor?: (index: number) => boolean;
	},
): AgentAdapter {
	if (options.refreshPlanUsage) {
		return answerPlanUsage(fake.adapter, options.refreshPlanUsage);
	}
	if (options.rejectAbortFor) {
		return rejectAbortForSession(fake.adapter, options.rejectAbortFor);
	}
	return options.deferAbort ? deferAbortUntilExit(fake.adapter) : fake.adapter;
}

function createService(
	database: DatabaseSync,
	options: {
		deferAbort?: boolean;
		eventSink?: AgentSessionEventSink;
		refreshPlanUsage?: () => Promise<boolean>;
		rejectAbortFor?: (index: number) => boolean;
		resolveSpawnedChildren?: (sessionId: string) => readonly string[];
		sessionSummaryWriter?: SessionSummaryWriter;
	} = {},
) {
	const fake = createFakeAgentAdapter();
	const agentClient = createAgentClient({
		adapter: resolveAdapter(fake, options),
	});
	const service = createAgentSessionService({
		databaseService: {
			close: () => undefined,
			getConnection: () => ({ database, path: ':memory:', schemaVersion: 5 }),
			getHealth: () => ({ path: ':memory:', schemaVersion: 5, status: 'ok' }),
			open: () => ({ path: ':memory:', schemaVersion: 5, status: 'ok' }),
		},
		eventSink: options.eventSink,
		agentClient,
		queueNaming: () => undefined,
		resolveSpawnedChildren: options.resolveSpawnedChildren,
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

test('openSession persists an agent_sessions row plus a main branch', async (t) => {
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
			agentSessionId: null,
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
	assert.equal(tabs[0]?.agentSessionId, snapshot.id);
	assert.equal(tabs[0]?.title, 'Existing tab');
});

test('setSessionName renames the active tab and stamps the caller as its owner', async (t) => {
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
		name: 'Refactor auth flow',
		provenance: 'agent',
		sessionId: snapshot.id,
	});

	assert.deepEqual(applied, {
		applied: true,
		chatTabId: tabId,
		title: 'Refactor auth flow',
	});
	const tab = getChatTabById({ database: fixture.database, id: tabId });
	assert.equal(tab?.title, 'Refactor auth flow');
	assert.equal(tab?.metadata.titleProvenance, 'agent');
});

test('setSessionName leaves a title the user owns alone', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const tabId = snapshot.openedTabs[0]?.id;
	assert.ok(tabId);

	await service.setSessionName({
		name: 'Chosen by hand',
		provenance: 'user',
		sessionId: snapshot.id,
	});
	const applied = await service.setSessionName({
		name: 'Agent guess',
		provenance: 'agent',
		sessionId: snapshot.id,
	});

	assert.equal(applied?.applied, false);
	const tab = getChatTabById({ database: fixture.database, id: tabId });
	assert.equal(tab?.title, 'Chosen by hand');
	assert.equal(tab?.metadata.titleProvenance, 'user');
});

test('setSessionName resolves null for a session that is not active', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	const applied = await service.setSessionName({
		name: 'Whatever',
		provenance: 'agent',
		sessionId: 'missing-session',
	});

	assert.equal(applied, null);
});

test('appendAgentMessage persists and broadcasts an assistant message onto the timeline', async (t) => {
	const fixture = openFixture(t);
	const broadcasts: Array<{
		sessionId: string;
		text: string;
		workspaceId: string;
	}> = [];
	const { service } = createService(fixture.database, {
		eventSink: ({ event, sessionId, workspaceId }) => {
			const envelope = event.payload;
			if (envelope?.kind === 'message' && envelope.payload.kind === 'text') {
				broadcasts.push({
					sessionId,
					text: envelope.payload.text,
					workspaceId,
				});
			}
		},
	});

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	service.appendAgentMessage({
		sessionId: snapshot.id,
		text: '# Plan\n\n1. Ship it',
	});

	const messages = listEventsByBranch({
		branchId: snapshot.branchId,
		database: fixture.database,
	}).filter(
		(event) =>
			event.payload?.kind === 'message' && event.payload.role === 'agent',
	);
	assert.equal(messages.length, 1);
	const envelope = messages[0]?.payload;
	const persistedText =
		envelope?.kind === 'message' && envelope.payload.kind === 'text'
			? envelope.payload.text
			: null;
	assert.equal(persistedText, '# Plan\n\n1. Ship it');

	assert.deepEqual(broadcasts, [
		{
			sessionId: snapshot.id,
			text: '# Plan\n\n1. Ship it',
			workspaceId: fixture.workspaceId,
		},
	]);
});

test('appendAgentMessage is a no-op for an unknown session', async (t) => {
	const fixture = openFixture(t);
	let broadcastCount = 0;
	const { service } = createService(fixture.database, {
		eventSink: () => {
			broadcastCount += 1;
		},
	});

	service.appendAgentMessage({ sessionId: 'missing-session', text: 'ignored' });

	assert.equal(broadcastCount, 0);
});

test('openSession persists and launches with a runtime session id', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	const row = getAgentSessionById({
		database: fixture.database,
		id: snapshot.id,
	});
	const runtime = fake.getOpenSessions()[0];
	assert.ok(row?.runtimeSessionId);
	assert.equal(snapshot.runtimeOpen, true);
	assert.equal(runtime?.getMetadata().sessionId, row.runtimeSessionId);
	// The `--session-id` flag itself is the Pi adapter's business now; what the
	// service owes is a session id on the request it hands down.
	assert.equal(
		runtime?.getSessionRequest().runtimeSessionId,
		row.runtimeSessionId,
	);
});

test('openSession resumes a closed persisted session before submit', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const first = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const nativeSessionId = first.runtimeSessionId;
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

test('runtime events are mirrored into agent_session_events', async (t) => {
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
				source: 'transcript' as const,
				title: 'Live summary',
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
		source: 'transcript',
		title: 'Live summary',
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
				source: 'transcript' as const,
				title: 'Closed summary',
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

// A spawned sub-agent's tab carries no composer, so nobody but the orchestrator
// can end its turn. Stopping the orchestrator has to reach the whole lineage or
// the children keep working with no one left to read their reports.
test('stopSession stops the whole lineage the stopped session spawned', async (t) => {
	const fixture = openFixture(t);
	const lineage = new Map<string, readonly string[]>();
	const { fake, service } = createService(fixture.database, {
		resolveSpawnedChildren: (sessionId) => lineage.get(sessionId) ?? [],
	});

	const openWorking = async () => {
		const snapshot = await service.openSession({
			executable: createReadyExecutable(),
			workspaceCwd: '/tmp/ensemblr/svc/ws',
			workspaceId: fixture.workspaceId,
		});
		await service.submitPrompt({ prompt: 'work', sessionId: snapshot.id });
		return snapshot;
	};

	const orchestrator = await openWorking();
	const child = await openWorking();
	const grandchild = await openWorking();
	lineage.set(orchestrator.id, [child.id]);
	lineage.set(child.id, [grandchild.id]);

	await service.stopSession({ sessionId: orchestrator.id });

	assert.equal(fake.getOpenSessions().length, 0, 'every runtime is closed');
	for (const spawned of [child, grandchild]) {
		assert.equal(
			getAgentSessionById({ database: fixture.database, id: spawned.id })
				?.status,
			'closed',
		);
	}
});

// The orchestrator is the session most likely to be wedged when the user reaches
// for Stop, and it is the one whose children the cascade exists to collect. A
// root that cannot abort must still surface as a failure to the caller.
test('stopSession stops the children even when the stopped session cannot abort', async (t) => {
	const fixture = openFixture(t);
	const lineage = new Map<string, readonly string[]>();
	const { service } = createService(fixture.database, {
		rejectAbortFor: (index) => index === 0,
		resolveSpawnedChildren: (sessionId) => lineage.get(sessionId) ?? [],
	});

	const openWorking = async () => {
		const snapshot = await service.openSession({
			executable: createReadyExecutable(),
			workspaceCwd: '/tmp/ensemblr/svc/ws',
			workspaceId: fixture.workspaceId,
		});
		await service.submitPrompt({ prompt: 'work', sessionId: snapshot.id });
		return snapshot;
	};

	const orchestrator = await openWorking();
	const child = await openWorking();
	lineage.set(orchestrator.id, [child.id]);

	await assert.rejects(service.stopSession({ sessionId: orchestrator.id }));

	assert.equal(
		getAgentSessionById({ database: fixture.database, id: child.id })?.status,
		'closed',
		'a child must not be stranded by an orchestrator that would not abort',
	);
});

test('stopSession leaves conversations the stopped session never spawned alone', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database, {
		resolveSpawnedChildren: () => [],
	});

	const stopped = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const bystander = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	await service.stopSession({ sessionId: stopped.id });

	assert.equal(service.getSession(bystander.id)?.runtimeOpen, true);
});

// Lineage comes from an in-memory registry the app rebuilds across restarts, so
// the cascade cannot assume it is walking a tree.
test('stopSession terminates on a lineage that points back at itself', async (t) => {
	const fixture = openFixture(t);
	const lineage = new Map<string, readonly string[]>();
	const { service } = createService(fixture.database, {
		resolveSpawnedChildren: (sessionId) => lineage.get(sessionId) ?? [],
	});

	const first = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const second = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	lineage.set(first.id, [second.id]);
	lineage.set(second.id, [first.id]);

	await service.stopSession({ sessionId: first.id });

	assert.equal(
		getAgentSessionById({ database: fixture.database, id: second.id })?.status,
		'closed',
	);
});

test('stopSession broadcasts the shutdown that lands after the session left the active map', async (t) => {
	const fixture = openFixture(t);
	const shutdowns: Array<{ reason: string; workspaceId: string }> = [];
	const { service } = createService(fixture.database, {
		deferAbort: true,
		eventSink: ({ event, workspaceId }) => {
			const envelope = event.payload;
			if (envelope?.kind === 'shutdown') {
				shutdowns.push({ reason: envelope.reason, workspaceId });
			}
		},
	});

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({ prompt: 'task', sessionId: snapshot.id });
	await service.stopSession({ sessionId: snapshot.id });
	await delay(20);

	assert.deepEqual(
		shutdowns,
		[{ reason: 'aborted', workspaceId: fixture.workspaceId }],
		'the interrupted marker must reach the renderer without a refetch',
	);
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
		getChatTabById({ database: fixture.database, id: tabId })?.agentSessionId,
		snapshot.id,
	);
	assert.equal(
		getAgentSessionById({ database: fixture.database, id: snapshot.id })
			?.status,
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

test('setSessionSummary records the agent summary against the branch it describes', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const tabId = snapshot.openedTabs[0]?.id;
	assert.ok(tabId);

	const recorded = service.setSessionSummary({
		sessionId: snapshot.id,
		summary: '- Fixed the redirect guard',
		title: 'Login redirect fix',
	});

	assert.ok(recorded);
	const marker = getChatTabById({ database: fixture.database, id: tabId })
		?.metadata.agentSummary as Record<string, unknown> | undefined;
	assert.equal(marker?.title, 'Login redirect fix');
	assert.equal(marker?.body, '- Fixed the redirect guard');
	assert.equal(marker?.branchId, snapshot.branchId);
	assert.equal(marker?.capturedAtOrdinal, recorded?.capturedAtOrdinal);
});

test('setSessionSummary decodes HTML entities in the summary heading', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const tabId = snapshot.openedTabs[0]?.id;
	assert.ok(tabId);

	service.setSessionSummary({
		sessionId: snapshot.id,
		summary: '- Split the admin surface',
		title: 'Admin &amp; Management',
	});

	const marker = getChatTabById({ database: fixture.database, id: tabId })
		?.metadata.agentSummary as Record<string, unknown> | undefined;
	assert.equal(marker?.title, 'Admin & Management');
});

test('setSessionSummary keeps the summary heading on one line', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const tabId = snapshot.openedTabs[0]?.id;
	assert.ok(tabId);

	const readTitle = (): string => {
		const marker = getChatTabById({ database: fixture.database, id: tabId })
			?.metadata.agentSummary as Record<string, unknown> | undefined;
		return marker?.title as string;
	};

	service.setSessionSummary({
		sessionId: snapshot.id,
		summary: '- Split the admin surface',
		title: 'Admin&#10;Management',
	});
	assert.equal(readTitle(), 'Admin Management');

	service.setSessionSummary({
		sessionId: snapshot.id,
		summary: '- Split the admin surface',
		title: '  Admin\nManagement\tpanel  ',
	});
	assert.equal(readTitle(), 'Admin Management panel');
});

test('setSessionSummary resolves null for a session that has no tab', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	assert.equal(
		service.setSessionSummary({
			sessionId: 'missing-session',
			summary: 'Body.',
			title: 'Topic',
		}),
		null,
	);
});

test('the turn-boundary summary carries the agent body once it recorded one', async (t) => {
	const fixture = openFixture(t);
	const summaryCalls: WriteSessionSummaryInput[] = [];
	const sessionSummaryWriter: SessionSummaryWriter = {
		writeSessionSummary: async (input) => {
			summaryCalls.push(input);
			return {
				path: `${input.workspaceCwd}/.context/sessions/${input.chatTabId}.md`,
				source: input.agentSummary
					? ('agent' as const)
					: ('transcript' as const),
				title: input.agentSummary?.title ?? null,
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
	await service.submitPrompt({ prompt: 'do it', sessionId: snapshot.id });
	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime);
	runtime.emit({
		at: '2026-06-08T00:00:01.000Z',
		payload: { kind: 'text', text: 'agent reply' },
		role: 'agent',
		turnId: 'fake-turn',
		type: 'message',
	});
	service.setSessionSummary({
		sessionId: snapshot.id,
		summary: '- Did the thing',
		title: 'The thing',
	});

	runtime.setStatus('idle');
	await waitForSummaryCalls(summaryCalls, 1);

	assert.deepEqual(summaryCalls[0]?.agentSummary, {
		body: '- Did the thing',
		title: 'The thing',
	});
});

test('a fork from the latest turn reuses the agent summary', async (t) => {
	const fixture = openFixture(t);
	const summaryCalls: WriteSessionSummaryInput[] = [];
	const sessionSummaryWriter: SessionSummaryWriter = {
		writeSessionSummary: async (input) => {
			summaryCalls.push(input);
			return {
				path: `${input.workspaceCwd}/.context/sessions/${input.chatTabId}.md`,
				source: input.agentSummary
					? ('agent' as const)
					: ('transcript' as const),
				title: input.agentSummary?.title ?? null,
			};
		},
	};
	const { service } = createService(fixture.database, { sessionSummaryWriter });

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({ prompt: 'do it', sessionId: snapshot.id });
	const recorded = service.setSessionSummary({
		sessionId: snapshot.id,
		summary: '- Did the thing',
		title: 'The thing',
	});
	assert.ok(recorded);

	await service.writeForkSummary({
		branchId: snapshot.branchId,
		fileBaseName: 'dest-tab',
		sessionId: snapshot.id,
		upToOrdinal: recorded.capturedAtOrdinal + 1,
	});

	assert.deepEqual(summaryCalls.at(-1)?.agentSummary, {
		body: '- Did the thing',
		title: 'The thing',
	});
});

test('a fork from an earlier turn falls back to the transcript', async (t) => {
	const fixture = openFixture(t);
	const summaryCalls: WriteSessionSummaryInput[] = [];
	const sessionSummaryWriter: SessionSummaryWriter = {
		writeSessionSummary: async (input) => {
			summaryCalls.push(input);
			return {
				path: `${input.workspaceCwd}/.context/sessions/${input.chatTabId}.md`,
				source: input.agentSummary
					? ('agent' as const)
					: ('transcript' as const),
				title: input.agentSummary?.title ?? null,
			};
		},
	};
	const { service } = createService(fixture.database, { sessionSummaryWriter });

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({ prompt: 'do it', sessionId: snapshot.id });
	const recorded = service.setSessionSummary({
		sessionId: snapshot.id,
		summary: '- Did the thing',
		title: 'The thing',
	});
	assert.ok(recorded);

	// Forking a turn that predates the summary must not leak later work into it.
	await service.writeForkSummary({
		branchId: snapshot.branchId,
		fileBaseName: 'dest-tab',
		sessionId: snapshot.id,
		upToOrdinal: recorded.capturedAtOrdinal - 1,
	});

	assert.equal(summaryCalls.at(-1)?.agentSummary, null);
});

test('a streaming delta keeps its subagent link on the broadcast row', async (t) => {
	const fixture = openFixture(t);
	const parents: Array<string | undefined> = [];
	const { fake, service } = createService(fixture.database, {
		eventSink: ({ event }) => {
			const envelope = event.payload;
			if (
				envelope?.kind === 'message' &&
				envelope.payload.kind === 'text-delta'
			) {
				parents.push(envelope.parentToolCallId);
			}
		},
	});

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({ prompt: 'do work', sessionId: snapshot.id });

	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	runtime.emit({
		at: '2026-06-08T00:00:00.000Z',
		parentToolCallId: 'toolu_task_1',
		payload: { kind: 'text-delta', text: 'delegate ' },
		role: 'agent',
		turnId: 'fake-turn',
		type: 'message',
	});
	runtime.emit({
		at: '2026-06-08T00:00:01.000Z',
		payload: { kind: 'text-delta', text: 'main thread' },
		role: 'agent',
		turnId: 'fake-turn',
		type: 'message',
	});

	assert.deepEqual(parents, ['toolu_task_1', undefined]);
});

test('refreshPlanUsage reaches the live runtime and reports that it answered', async (t) => {
	const fixture = openFixture(t);
	let reads = 0;
	const { service } = createService(fixture.database, {
		refreshPlanUsage: async () => {
			reads += 1;
			return true;
		},
	});

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	assert.equal(await service.refreshPlanUsage(snapshot.id), true);
	assert.equal(reads, 1);
});

test('refreshPlanUsage passes on a runtime that would not answer', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database, {
		refreshPlanUsage: async () => false,
	});

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	assert.equal(await service.refreshPlanUsage(snapshot.id), false);
});

test('refreshPlanUsage answers false for a runtime that reports no plan usage', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	assert.equal(
		await service.refreshPlanUsage(snapshot.id),
		false,
		'an adapter that omits the capability must answer rather than throw',
	);
});

// The case a chat reopened after a restart is in: the session row survives, and
// `runtimeOpen` false is the only thing that says nothing is running behind it.
test('refreshPlanUsage answers false once no runtime is attached to the session', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database, {
		refreshPlanUsage: async () => true,
	});

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	assert.equal(snapshot.runtimeOpen, true);
	await service.stopSession({ sessionId: snapshot.id });

	assert.equal(service.getSession(snapshot.id)?.runtimeOpen, false);
	assert.equal(await service.refreshPlanUsage(snapshot.id), false);
	assert.equal(await service.refreshPlanUsage('no-such-session'), false);
});
