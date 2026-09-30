/// <reference types="node" />

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type {
	AgentControlEnvIdentity,
	AgentControlEnvResolver,
} from '../../src/main/agent-control/ports.ts';
import * as sessionLineage from '../../src/main/agent-control/session-lineage.ts';
import type {
	AgentAdapter,
	AgentAdapterSession,
} from '../../src/main/agent-runtime/agent-adapter.ts';
import { createAgentClient } from '../../src/main/agent-runtime/agent-client.ts';
import { WORKSPACE_REMOVED_STOP_REASON } from '../../src/main/agent-runtime/agent-session-lifecycle.ts';
import {
	type AgentSessionEventSink,
	createAgentSessionService,
} from '../../src/main/agent-runtime/agent-session-service.ts';
import {
	type AgentEvent,
	AgentSubmitError,
} from '../../src/main/agent-runtime/agent-types.ts';
import { createFakeAgentAdapter } from '../../src/main/agent-runtime/fake-agent-adapter.ts';
import {
	createSessionNaming,
	type SessionNamingInput,
} from '../../src/main/agent-runtime/naming/session-naming.ts';
import type {
	SessionSummaryWriter,
	WriteSessionSummaryInput,
} from '../../src/main/agent-runtime/session-summary-writer.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	type AgentEventRow,
	listEventsByBranch,
} from '../../src/main/storage/repositories/agent-event-repository.ts';
import {
	getAgentSessionBranchById,
	getAgentSessionById,
	listTurns,
	setBranchMetadata,
} from '../../src/main/storage/repositories/agent-session-repository.ts';
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

// Neither CLI teardown resolves with the `shutdown` event in hand: `abort()`
// only signals the child, and `close()` stops waiting once its kill deadline
// passes, so on a wedged child the event lands later — on process exit, after
// `stopSession` already dropped the session from the active map. The fake emits
// it inline, so tests that care about that tail opt into this wrapper.
function deferShutdownUntilExit(adapter: AgentAdapter): AgentAdapter {
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
				close: async () => {
					setTimeout(() => {
						void session.close();
					}, 0);
				},
			};
		},
		shutdown: adapter.shutdown,
	};
}

// A runtime can reject a prompt before acceptance, as Pi does when it is busy.
function deferFirstRejectedSubmit(adapter: AgentAdapter): {
	adapter: AgentAdapter;
	release: () => void;
} {
	let first = true;
	let releaseFirst: (() => void) | null = null;
	return {
		adapter: {
			createSession: async (input) => {
				const session = await adapter.createSession(input);
				return {
					...session,
					submit: async (request) => {
						if (first) {
							first = false;
							await new Promise<void>((resolve) => {
								releaseFirst = resolve;
							});
							throw new Error('Pi RPC prompt rejected before acceptance.');
						}
						return session.submit(request);
					},
				};
			},
			shutdown: adapter.shutdown,
		},
		release: () => releaseFirst?.(),
	};
}

// A runtime can reject a prompt before acceptance, as Pi does when it is busy.
function rejectSubmitForSession(
	adapter: AgentAdapter,
	shouldReject: (index: number) => boolean,
	errorMessage: string,
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
				submit: async () => {
					throw new Error(errorMessage);
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
		deferShutdown?: boolean;
		refreshPlanUsage?: () => Promise<boolean>;
		rejectAbortFor?: (index: number) => boolean;
		rejectSubmitFor?: (index: number) => boolean;
	},
): AgentAdapter {
	if (options.refreshPlanUsage) {
		return answerPlanUsage(fake.adapter, options.refreshPlanUsage);
	}
	if (options.rejectAbortFor) {
		return rejectAbortForSession(fake.adapter, options.rejectAbortFor);
	}
	if (options.rejectSubmitFor) {
		return rejectSubmitForSession(
			fake.adapter,
			options.rejectSubmitFor,
			'Pi RPC prompt rejected before acceptance.',
		);
	}
	return options.deferShutdown
		? deferShutdownUntilExit(fake.adapter)
		: fake.adapter;
}

function createDeferredCloseAdapter(base: AgentAdapter): {
	adapter: AgentAdapter;
	closeStarted: Promise<void>;
	releaseClose: () => void;
} {
	let firstClose = true;
	let releaseClose: (() => void) | null = null;
	let resolveCloseStarted: (() => void) | null = null;
	const closeStarted = new Promise<void>((resolve) => {
		resolveCloseStarted = resolve;
	});
	const adapter: AgentAdapter = {
		createSession: async (input) => {
			const session = await base.createSession(input);
			const wrapped: AgentAdapterSession = {
				...session,
				close: async () => {
					if (firstClose) {
						firstClose = false;
						resolveCloseStarted?.();
						await new Promise<void>((resolve) => {
							releaseClose = resolve;
						});
					}
					await session.close();
				},
			};
			return wrapped;
		},
		shutdown: base.shutdown,
	};
	return {
		adapter,
		closeStarted,
		releaseClose: () => releaseClose?.(),
	};
}

function createDeferredSecondCreateAdapter(
	base: AgentAdapter,
	failSecondClose = false,
): {
	adapter: AgentAdapter;
	createStarted: Promise<void>;
	releaseCreate: () => void;
} {
	let createCount = 0;
	let releaseCreate: (() => void) | null = null;
	let resolveCreateStarted: (() => void) | null = null;
	const createStarted = new Promise<void>((resolve) => {
		resolveCreateStarted = resolve;
	});
	const adapter: AgentAdapter = {
		createSession: async (input) => {
			createCount += 1;
			if (createCount === 2) {
				resolveCreateStarted?.();
				await new Promise<void>((resolve) => {
					releaseCreate = resolve;
				});
			}
			const session = await base.createSession(input);
			if (!failSecondClose || createCount !== 2) {
				return session;
			}
			let firstClose = true;
			return {
				...session,
				close: async () => {
					if (firstClose) {
						firstClose = false;
						throw new Error('replacement child did not exit');
					}
					await session.close();
				},
			};
		},
		shutdown: base.shutdown,
	};
	return {
		adapter,
		createStarted,
		releaseCreate: () => releaseCreate?.(),
	};
}

function createDeferredReplacementPairAdapter(base: AgentAdapter): {
	adapter: AgentAdapter;
	firstCreateStarted: Promise<void>;
	releaseFirstCreate: () => void;
	firstCleanupFailed: Promise<void>;
	secondCreateStarted: Promise<void>;
	releaseSecondCreate: () => void;
} {
	let createCount = 0;
	let releaseFirstCreate: (() => void) | null = null;
	let releaseSecondCreate: (() => void) | null = null;
	let resolveFirstCreateStarted: (() => void) | null = null;
	let resolveSecondCreateStarted: (() => void) | null = null;
	let resolveFirstCleanupFailed: (() => void) | null = null;
	const firstCreateStarted = new Promise<void>((resolve) => {
		resolveFirstCreateStarted = resolve;
	});
	const firstCleanupFailed = new Promise<void>((resolve) => {
		resolveFirstCleanupFailed = resolve;
	});
	const secondCreateStarted = new Promise<void>((resolve) => {
		resolveSecondCreateStarted = resolve;
	});
	const adapter: AgentAdapter = {
		createSession: async (input) => {
			const currentCreate = ++createCount;
			if (currentCreate === 3) {
				resolveFirstCreateStarted?.();
				await new Promise<void>((resolve) => {
					releaseFirstCreate = resolve;
				});
			}
			if (currentCreate === 4) {
				resolveSecondCreateStarted?.();
				await new Promise<void>((resolve) => {
					releaseSecondCreate = resolve;
				});
			}
			const session = await base.createSession(input);
			if (currentCreate !== 3) {
				return session;
			}
			let firstClose = true;
			return {
				...session,
				close: async () => {
					if (firstClose) {
						firstClose = false;
						resolveFirstCleanupFailed?.();
						throw new Error('replacement child did not exit');
					}
					await session.close();
				},
			};
		},
		shutdown: base.shutdown,
	};
	return {
		adapter,
		firstCreateStarted,
		releaseFirstCreate: () => releaseFirstCreate?.(),
		firstCleanupFailed,
		secondCreateStarted,
		releaseSecondCreate: () => releaseSecondCreate?.(),
	};
}

function createService(
	database: DatabaseSync,
	options: {
		adapter?: AgentAdapter;
		deferShutdown?: boolean;
		eventSink?: AgentSessionEventSink;
		queueNaming?: (input: SessionNamingInput) => void;
		refreshPlanUsage?: () => Promise<boolean>;
		rejectAbortFor?: (index: number) => boolean;
		rejectSubmitFor?: (index: number) => boolean;
		resolveAgentControlEnv?: AgentControlEnvResolver;
		resolveSpawnedChildren?: (sessionId: string) => readonly string[];
		sessionSummaryWriter?: SessionSummaryWriter;
	} = {},
) {
	const fake = createFakeAgentAdapter();
	const agentClient = createAgentClient({
		adapter: options.adapter ?? resolveAdapter(fake, options),
	});
	const service = createAgentSessionService({
		databaseService: {
			close: () => undefined,
			getConnection: () => ({ database, path: ':memory:', schemaVersion: 5 }),
			getHealth: () => ({ path: ':memory:', schemaVersion: 5, status: 'ok' }),
			vacuum: () => undefined,
			open: () => ({ path: ':memory:', schemaVersion: 5, status: 'ok' }),
		},
		eventSink: options.eventSink,
		agentClient,
		queueNaming: options.queueNaming ?? (() => undefined),
		resolveAgentControlEnv: options.resolveAgentControlEnv,
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
	assert.equal(snapshot.contextUsage, null);
	assert.deepEqual(snapshot.currentTools, []);
});

test('openSession persists root-child-leaf lineage and rejects a third edge before runtime creation', async (t) => {
	const fixture = openFixture(t);
	const identities: AgentControlEnvIdentity[] = [];
	const { fake, service } = createService(fixture.database, {
		resolveAgentControlEnv: (identity) => {
			identities.push(identity);
			return {};
		},
	});
	const open = (parentSessionId?: string) =>
		service.openSession({
			executable: createReadyExecutable(),
			...(parentSessionId ? { parentSessionId } : {}),
			workspaceCwd: '/tmp/ensemblr/svc/ws',
			workspaceId: fixture.workspaceId,
		});
	const root = await open();
	const child = await open(root.id);
	const leaf = await open(child.id);

	assert.deepEqual(
		identities.map((identity) => identity.lineage),
		[
			{ depth: 0, parentSessionId: null, rootSessionId: root.id },
			{ depth: 1, parentSessionId: root.id, rootSessionId: root.id },
			{ depth: 2, parentSessionId: child.id, rootSessionId: root.id },
		],
	);
	await assert.rejects(open(leaf.id), /Cannot establish agent session lineage/);
	assert.equal(fake.getOpenSessions().length, 3);
	assert.equal(service.listSessionsForWorkspace(fixture.workspaceId).length, 3);
});

test('harness descendants retain durable lineage and Ensemblr delegation on resume', async (t) => {
	const fixture = openFixture(t);
	const identities: AgentControlEnvIdentity[] = [];
	const first = createService(fixture.database, {
		resolveAgentControlEnv: (identity) => {
			identities.push(identity);
			return {};
		},
	});
	const manager = await first.service.openSession({
		executable: createReadyExecutable(),
		parentSessionId: `ws:${fixture.workspaceId}`,
		parentSpecies: 'harness',
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const leaf = await first.service.openSession({
		executable: createReadyExecutable(),
		parentSessionId: manager.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	assert.deepEqual(
		identities.map((identity) => identity.lineage),
		[
			{
				depth: 1,
				parentSessionId: `ws:${fixture.workspaceId}`,
				rootSessionId: `ws:${fixture.workspaceId}`,
			},
			{
				depth: 2,
				parentSessionId: manager.id,
				rootSessionId: `ws:${fixture.workspaceId}`,
			},
		],
	);
	assert.equal(identities[0]?.delegation, 'ensemblr');
	assert.equal(identities[1]?.delegation, 'ensemblr');
	await first.service.shutdown();

	identities.length = 0;
	const resumed = createService(fixture.database, {
		resolveAgentControlEnv: (identity) => {
			identities.push(identity);
			return {};
		},
	});
	await resumed.service.openSession({
		executable: createReadyExecutable(),
		resumeSessionId: leaf.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	assert.deepEqual(identities[0]?.lineage, {
		depth: 2,
		parentSessionId: manager.id,
		rootSessionId: `ws:${fixture.workspaceId}`,
	});
	assert.equal(identities[0]?.delegation, 'ensemblr');
});

test('resume restores persisted lineage before creating a replacement runtime', async (t) => {
	const fixture = openFixture(t);
	const first = createService(fixture.database);
	const root = await first.service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const child = await first.service.openSession({
		executable: createReadyExecutable(),
		parentSessionId: root.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await first.service.shutdown();

	const identities: AgentControlEnvIdentity[] = [];
	const resumed = createService(fixture.database, {
		resolveAgentControlEnv: (identity) => {
			identities.push(identity);
			return {};
		},
	});
	await resumed.service.openSession({
		executable: createReadyExecutable(),
		resumeSessionId: child.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	assert.deepEqual(identities[0]?.lineage, {
		depth: 1,
		parentSessionId: root.id,
		rootSessionId: root.id,
	});
});

test('durable recursive stop reaches descendants without stopping a sibling', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database, {
		resolveSpawnedChildren: (sessionId) =>
			sessionLineage.listImmediateAgentSessionChildren({
				database: fixture.database,
				parentSessionId: sessionId,
			}),
	});
	const open = (parentSessionId?: string) =>
		service.openSession({
			executable: createReadyExecutable(),
			...(parentSessionId ? { parentSessionId } : {}),
			workspaceCwd: '/tmp/ensemblr/svc/ws',
			workspaceId: fixture.workspaceId,
		});
	const root = await open();
	const child = await open(root.id);
	const sibling = await open(root.id);
	const leaf = await open(child.id);

	await service.stopSession({ reason: 'user', sessionId: child.id });

	assert.equal(service.getSession(child.id)?.runtimeOpen, false);
	assert.equal(service.getSession(leaf.id)?.runtimeOpen, false);
	assert.equal(service.getSession(root.id)?.runtimeOpen, true);
	assert.equal(service.getSession(sibling.id)?.runtimeOpen, true);
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

// The agent-control wait loop polls this per target per tick, so the reading is
// parked on the live session as the event arrives rather than scanned back out
// of the transcript.
test('getContextUsage reports the newest reading the runtime sent', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	assert.equal(
		service.getContextUsage(snapshot.id),
		null,
		'a session that has reported nothing yet has no reading',
	);

	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	runtime.emit({
		at: new Date().toISOString(),
		type: 'context-usage',
		usage: { contextWindow: 200_000, percent: 20, tokens: 40_000 },
	});
	await delay(10);
	runtime.emit({
		at: new Date().toISOString(),
		type: 'context-usage',
		usage: { contextWindow: 200_000, percent: 55, tokens: 110_000 },
	});
	await delay(10);

	assert.deepEqual(service.getContextUsage(snapshot.id), {
		contextWindow: 200_000,
		percent: 55,
		tokens: 110_000,
	});
});

test('getSession projects live context and unresolved normalized tool calls', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);
	const opened = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	runtime.setStatus('streaming');
	runtime.emit({
		at: new Date().toISOString(),
		type: 'context-usage',
		usage: { contextWindow: 200_000, percent: 35, tokens: 70_000 },
	});
	runtime.emit({
		at: new Date().toISOString(),
		type: 'context-usage',
		usage: { contextWindow: -1, percent: 101, tokens: -1 },
	});
	runtime.emit({
		at: new Date().toISOString(),
		payload: {
			input: { path: 'src/main.ts' },
			kind: 'tool-call',
			name: 'read',
			toolCallId: 'call-1',
		},
		role: 'agent',
		turnId: 'runtime-turn',
		type: 'message',
	});
	await delay(10);

	const snapshot = service.getSession(opened.id);
	assert.deepEqual(snapshot?.contextUsage, {
		reading: 'live',
		usage: { contextWindow: 200_000, percent: 35, tokens: 70_000 },
	});
	assert.deepEqual(snapshot?.currentTools, [
		{
			input: { path: 'src/main.ts' },
			name: 'read',
			toolCallId: 'call-1',
		},
	]);

	runtime.emit({
		at: new Date().toISOString(),
		payload: {
			isError: false,
			kind: 'tool-result',
			output: 'done',
			toolCallId: 'call-1',
		},
		role: 'tool',
		turnId: 'runtime-turn',
		type: 'message',
	});
	runtime.setStatus('streaming');
	for (const payload of [
		{
			input: { path: 'src/main.ts' },
			kind: 'tool-call' as const,
			name: 'read',
			toolCallId: 'call-1',
		},
		{
			kind: 'message' as const,
			parts: [
				{
					input: { path: 'src/main.ts' },
					kind: 'tool-call' as const,
					name: 'read',
					toolCallId: 'call-1',
				},
			],
			role: 'assistant' as const,
		},
	]) {
		runtime.emit({
			at: new Date().toISOString(),
			payload,
			role: 'agent',
			turnId: 'runtime-turn',
			type: 'message',
		});
	}
	await delay(10);
	assert.deepEqual(service.getSession(opened.id)?.currentTools, []);

	runtime.setStatus('idle');
	runtime.emit({
		at: new Date().toISOString(),
		payload: {
			input: { path: 'stale.ts' },
			kind: 'tool-call',
			name: 'read',
			toolCallId: 'call-1',
		},
		role: 'agent',
		turnId: 'old-runtime-turn',
		type: 'message',
	});
	await delay(10);
	assert.deepEqual(service.getSession(opened.id)?.currentTools, []);

	runtime.setStatus('streaming');
	runtime.emit({
		at: new Date().toISOString(),
		payload: {
			input: { path: 'new.ts' },
			kind: 'tool-call',
			name: 'read',
			toolCallId: 'call-1',
		},
		role: 'agent',
		turnId: 'new-runtime-turn',
		type: 'message',
	});
	await delay(10);
	assert.equal(service.getSession(opened.id)?.currentTools?.[0]?.name, 'read');
});

test('archived snapshots use the latest valid persisted context reading', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);
	const opened = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	runtime.emit({
		at: new Date().toISOString(),
		type: 'context-usage',
		usage: { contextWindow: 200_000, percent: 25, tokens: 50_000 },
	});
	runtime.emit({
		at: new Date().toISOString(),
		type: 'context-usage',
		usage: { contextWindow: -1, percent: 101, tokens: -1 },
	});
	runtime.emit({
		at: new Date().toISOString(),
		reason: 'completed',
		type: 'shutdown',
	});
	await delay(10);

	assert.deepEqual(service.getSession(opened.id)?.contextUsage, {
		reading: 'last-recorded',
		usage: { contextWindow: 200_000, percent: 25, tokens: 50_000 },
	});
	assert.deepEqual(service.getSession(opened.id)?.currentTools, []);
});

test('persisted context lookup skips hidden checkpoint ordinals', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);
	const opened = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	for (const percent of [10, 80]) {
		runtime.emit({
			at: new Date().toISOString(),
			type: 'context-usage',
			usage: { contextWindow: 200_000, percent, tokens: percent * 2_000 },
		});
	}
	runtime.emit({
		at: new Date().toISOString(),
		reason: 'completed',
		type: 'shutdown',
	});
	await delay(10);
	const events = listEventsByBranch({
		branchId: opened.branchId,
		database: fixture.database,
	});
	const newestUsage = events.findLast(
		(event) => event.payload?.kind === 'context-usage',
	);
	assert.ok(newestUsage, 'expected a persisted usage event');
	const branch = getAgentSessionBranchById({
		database: fixture.database,
		id: opened.branchId,
	});
	assert.ok(branch, 'expected a main branch');
	setBranchMetadata({
		database: fixture.database,
		id: branch.id,
		metadata: {
			...branch.metadata,
			hiddenEventRanges: [
				{
					afterOrdinal: newestUsage.ordinal - 1,
					throughOrdinal: newestUsage.ordinal,
				},
			],
		},
	});

	assert.deepEqual(service.getSession(opened.id)?.contextUsage, {
		reading: 'last-recorded',
		usage: { contextWindow: 200_000, percent: 10, tokens: 20_000 },
	});
});

test('workspace snapshots include activity for unselected live sessions only', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);
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
	const secondRuntime = fake.getOpenSessions()[1];
	assert.ok(secondRuntime, 'expected the second live runtime');
	secondRuntime.emit({
		at: new Date().toISOString(),
		payload: {
			input: { command: 'npm test' },
			kind: 'tool-call',
			name: 'bash',
			toolCallId: 'call-2',
		},
		role: 'agent',
		turnId: 'runtime-turn',
		type: 'message',
	});
	await delay(10);

	const sessions = service.listSessionsForWorkspace(fixture.workspaceId);
	assert.deepEqual(
		sessions.find((session) => session.id === first.id)?.currentTools,
		[],
	);
	assert.equal(
		sessions.find((session) => session.id === second.id)?.currentTools?.[0]
			?.toolCallId,
		'call-2',
	);
});

// Usage is a property of the running session rather than of the transcript it
// leaves behind, so a closed one reports nothing rather than a stale reading.
test('getContextUsage reports null once the session has shut down', async (t) => {
	const fixture = openFixture(t);
	const { fake, service } = createService(fixture.database);

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	runtime.emit({
		at: new Date().toISOString(),
		type: 'context-usage',
		usage: { contextWindow: 200_000, percent: 55, tokens: 110_000 },
	});
	await delay(10);
	assert.ok(service.getContextUsage(snapshot.id));

	runtime.emit({
		at: new Date().toISOString(),
		reason: 'completed',
		type: 'shutdown',
	});
	await delay(10);

	assert.equal(service.getContextUsage(snapshot.id), null);
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

test('a concurrent plain resume reports that the session is already opening', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const deferred = createDeferredSecondCreateAdapter(fake.adapter);
	const { service } = createService(fixture.database, {
		adapter: deferred.adapter,
	});
	const first = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.stopSession({ sessionId: first.id });

	const firstResume = service.openSession({
		executable: createReadyExecutable(),
		resumeSessionId: first.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await deferred.createStarted;

	await assert.rejects(
		service.openSession({
			executable: createReadyExecutable(),
			resumeSessionId: first.id,
			workspaceCwd: '/tmp/ensemblr/svc/ws',
			workspaceId: fixture.workspaceId,
		}),
		{
			code: 'session-not-open',
			message: `Agent session ${first.id} is already opening.`,
		},
	);

	deferred.releaseCreate();
	await firstResume;
});

test('stop cancels a deferred replacement before it can launch a duplicate runtime', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const deferred = createDeferredCloseAdapter(fake.adapter);
	const { service } = createService(fixture.database, {
		adapter: deferred.adapter,
	});
	const first = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	const replacement = service.openSession({
		executable: createReadyExecutable(),
		linkedDirectories: ['/tmp/notes'],
		resumeSessionId: first.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await deferred.closeStarted;
	const stop = service.stopSession({ sessionId: first.id });
	await delay(5);
	assert.equal(fake.getOpenSessions().length, 1);
	deferred.releaseClose();

	await stop;
	await assert.rejects(replacement, {
		code: 'linked-directories-cancelled',
	});
	assert.equal(fake.getOpenSessions().length, 0);
	assert.equal(
		getAgentSessionById({ database: fixture.database, id: first.id })?.status,
		'closed',
	);
});

test('shutdown cancels a deferred replacement without launching a replacement', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const deferred = createDeferredCloseAdapter(fake.adapter);
	const { service } = createService(fixture.database, {
		adapter: deferred.adapter,
	});
	const first = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	const replacement = service.openSession({
		executable: createReadyExecutable(),
		linkedDirectories: ['/tmp/notes'],
		resumeSessionId: first.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await deferred.closeStarted;
	const shutdown = service.shutdown();
	await delay(5);
	assert.equal(fake.getOpenSessions().length, 1);
	deferred.releaseClose();

	await shutdown;
	await assert.rejects(replacement, {
		code: 'linked-directories-cancelled',
	});
	assert.equal(fake.getOpenSessions().length, 0);
});

test('replacement preserves the native runtime history id', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const deferred = createDeferredCloseAdapter(fake.adapter);
	const { service } = createService(fixture.database, {
		adapter: deferred.adapter,
	});
	const first = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const firstRuntime = fake.getOpenSessions()[0];
	assert.ok(firstRuntime);

	const replacement = service.openSession({
		executable: createReadyExecutable(),
		linkedDirectories: ['/tmp/notes'],
		resumeSessionId: first.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await deferred.closeStarted;
	deferred.releaseClose();
	await replacement;

	const secondRuntime = fake.getOpenSessions()[0];
	assert.ok(secondRuntime);
	assert.equal(
		secondRuntime.getSessionRequest().runtimeSessionId,
		firstRuntime.getSessionRequest().runtimeSessionId,
	);
});

test('shutdown cancels deferred replacement creation before it becomes active', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const deferred = createDeferredSecondCreateAdapter(fake.adapter);
	const { service } = createService(fixture.database, {
		adapter: deferred.adapter,
	});
	const first = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	const replacement = service.openSession({
		executable: createReadyExecutable(),
		linkedDirectories: ['/tmp/notes'],
		resumeSessionId: first.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await deferred.createStarted;
	const shutdown = service.shutdown();
	deferred.releaseCreate();

	await shutdown;
	await assert.rejects(replacement, {
		code: 'linked-directories-cancelled',
	});
	assert.equal(fake.getOpenSessions().length, 0);
});

test('stop retries a canceled replacement runtime whose cleanup close fails', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const deferred = createDeferredSecondCreateAdapter(fake.adapter, true);
	const { service } = createService(fixture.database, {
		adapter: deferred.adapter,
	});
	const first = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	const replacement = service.openSession({
		executable: createReadyExecutable(),
		linkedDirectories: ['/tmp/notes'],
		resumeSessionId: first.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await deferred.createStarted;
	const stop = service.stopSession({ sessionId: first.id });
	deferred.releaseCreate();

	await stop;
	await assert.rejects(replacement, {
		message: 'replacement child did not exit',
	});
	assert.equal(fake.getOpenSessions().length, 0);
	assert.equal(
		getAgentSessionById({ database: fixture.database, id: first.id })?.status,
		'closed',
	);
});

test('shutdown retries a canceled replacement runtime whose cleanup close fails', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const deferred = createDeferredSecondCreateAdapter(fake.adapter, true);
	const { service } = createService(fixture.database, {
		adapter: deferred.adapter,
	});
	const first = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	const replacement = service.openSession({
		executable: createReadyExecutable(),
		linkedDirectories: ['/tmp/notes'],
		resumeSessionId: first.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await deferred.createStarted;
	const shutdown = service.shutdown();
	deferred.releaseCreate();

	await shutdown;
	await assert.rejects(replacement, {
		message: 'replacement child did not exit',
	});
	assert.equal(fake.getOpenSessions().length, 0);
	assert.equal(
		getAgentSessionById({ database: fixture.database, id: first.id })?.status,
		'closed',
	);
});

test('shutdown waits for every canceled replacement before retrying cleanup', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const deferred = createDeferredReplacementPairAdapter(fake.adapter);
	const { service } = createService(fixture.database, {
		adapter: deferred.adapter,
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

	const firstReplacement = service.openSession({
		executable: createReadyExecutable(),
		linkedDirectories: ['/tmp/notes'],
		resumeSessionId: first.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await deferred.firstCreateStarted;
	const secondReplacement = service.openSession({
		executable: createReadyExecutable(),
		linkedDirectories: ['/tmp/docs'],
		resumeSessionId: second.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await deferred.secondCreateStarted;

	const firstFailure = assert.rejects(firstReplacement, {
		message: 'replacement child did not exit',
	});
	const secondFailure = assert.rejects(secondReplacement, {
		code: 'linked-directories-cancelled',
	});
	let shutdownSettled = false;
	const shutdown = service.shutdown().finally(() => {
		shutdownSettled = true;
	});
	deferred.releaseFirstCreate();
	await deferred.firstCleanupFailed;
	assert.equal(shutdownSettled, false);
	assert.equal(fake.getOpenSessions().length, 1);

	deferred.releaseSecondCreate();
	await shutdown;
	await Promise.all([firstFailure, secondFailure]);
	assert.equal(fake.getOpenSessions().length, 0);
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

test('rejected prompt finishes its turn and restores an idle session', async (t) => {
	const fixture = openFixture(t);
	const { service } = createService(fixture.database, {
		rejectSubmitFor: () => true,
	});
	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	await assert.rejects(
		service.submitPrompt({ prompt: 'rejected', sessionId: snapshot.id }),
		/Pi RPC prompt rejected/,
	);

	const session = getAgentSessionById({
		database: fixture.database,
		id: snapshot.id,
	});
	assert.equal(session?.status, 'idle');
	const turns = listTurns({
		branchId: snapshot.branchId,
		database: fixture.database,
	});
	assert.equal(turns.length, 1);
	assert.equal(turns[0]?.status, 'errored');
	assert.ok(turns[0]?.completedAt);
});

test('ambiguous prompt timeout quarantines the runtime and closes the session', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const service = createService(fixture.database, {
		adapter: {
			createSession: async (input) => {
				const session = await fake.adapter.createSession(input);
				const controller = fake.getOpenSessions()[0];
				if (!controller) {
					throw new Error('Fake session controller was not created.');
				}
				return {
					...session,
					submit: async () => {
						controller.emit({
							at: new Date().toISOString(),
							type: 'context-usage',
							usage: {
								contextWindow: 200_000,
								percent: 20,
								tokens: 40_000,
							},
						});
						throw new AgentSubmitError(
							'Prompt delivery could not be confirmed; the Pi session was quarantined.',
							'unconfirmed',
						);
					},
				};
			},
			shutdown: fake.adapter.shutdown,
		},
	}).service;
	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	await assert.rejects(
		service.submitPrompt({
			prompt: 'possibly delivered',
			sessionId: snapshot.id,
		}),
		/quarantined/,
	);
	assert.equal(
		getAgentSessionById({ database: fixture.database, id: snapshot.id })
			?.status,
		'closed',
	);
	const turns = listTurns({
		branchId: snapshot.branchId,
		database: fixture.database,
	});
	assert.equal(turns[0]?.status, 'errored');
	assert.ok(turns[0]?.completedAt);
	assert.equal(fake.getOpenSessions().length, 0);
});

test('quarantine deletes a runtime when close resolves without shutdown', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const runtimes: object[] = [];
	let emitLateEvent: ((event: AgentEvent) => void) | undefined;
	const service = createService(fixture.database, {
		adapter: {
			createSession: async (input) => {
				const session = await fake.adapter.createSession(input);
				const controller = fake.getOpenSessions()[0];
				if (!controller) {
					throw new Error('Fake session controller was not created.');
				}
				emitLateEvent = (event) => controller.emit(event);
				runtimes.push(session);
				return {
					...session,
					close: async () => undefined,
					submit: async () => {
						controller.emit({
							at: new Date().toISOString(),
							type: 'context-usage',
							usage: {
								contextWindow: 200_000,
								percent: 20,
								tokens: 40_000,
							},
						});
						throw new AgentSubmitError(
							'Prompt delivery could not be confirmed; the Pi session was quarantined.',
							'unconfirmed',
						);
					},
				};
			},
			shutdown: fake.adapter.shutdown,
		},
	}).service;
	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	await assert.rejects(
		service.submitPrompt({
			prompt: 'possibly delivered',
			sessionId: snapshot.id,
		}),
		/quarantined/,
	);
	assert.equal(service.getSession(snapshot.id)?.runtimeOpen, false);
	emitLateEvent?.({
		at: new Date().toISOString(),
		previous: 'starting',
		status: 'streaming',
		type: 'status',
	});
	assert.equal(service.getSession(snapshot.id)?.status, 'closed');

	const reopened = await service.openSession({
		executable: createReadyExecutable(),
		resumeSessionId: snapshot.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	assert.equal(reopened.runtimeOpen, true);
	assert.equal(service.getSession(snapshot.id)?.runtimeOpen, true);
	assert.notEqual(runtimes[0], runtimes[1]);
});

test('retired runtime events cannot close a replacement session', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const listeners: Array<(event: AgentEvent) => void> = [];
	const runtimes: object[] = [];
	const service = createService(fixture.database, {
		adapter: {
			createSession: async (input) => {
				const session = await fake.adapter.createSession(input);
				runtimes.push(session);
				return {
					...session,
					close: async () => undefined,
					subscribe: (listener) => {
						listeners.push(listener);
						return { unsubscribe: () => undefined };
					},
				};
			},
			shutdown: fake.adapter.shutdown,
		},
	}).service;
	const first = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const replacement = await service.openSession({
		executable: createReadyExecutable(),
		resumeSessionId: first.id,
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	const statusBeforeRetiredEvents = service.getSession(first.id)?.status;

	listeners[0]?.({
		at: new Date().toISOString(),
		previous: 'starting',
		status: 'idle',
		type: 'status',
	});
	listeners[0]?.({
		at: new Date().toISOString(),
		reason: 'completed',
		type: 'shutdown',
	});

	assert.equal(service.getSession(first.id)?.status, statusBeforeRetiredEvents);
	assert.equal(service.getSession(first.id)?.runtimeOpen, true);
	assert.equal(replacement.runtimeOpen, true);
	assert.notEqual(runtimes[0], runtimes[1]);
});

test('a newer turn is not overwritten by an older rejected submit', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakeAgentAdapter();
	const deferred = deferFirstRejectedSubmit(fake.adapter);
	const service = createService(fixture.database, {
		adapter: deferred.adapter,
	}).service;
	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});

	const firstSubmit = service.submitPrompt({
		prompt: 'first',
		sessionId: snapshot.id,
	});
	await new Promise<void>((resolve) => setImmediate(resolve));
	const secondSubmit = service.submitPrompt({
		prompt: 'second',
		sessionId: snapshot.id,
	});
	await secondSubmit;
	deferred.release();
	await assert.rejects(firstSubmit, /prompt rejected/);

	const turns = listTurns({
		branchId: snapshot.branchId,
		database: fixture.database,
	});
	assert.equal(turns[0]?.status, 'errored');
	assert.equal(turns[1]?.status, 'submitted');
	assert.equal(
		getAgentSessionById({ database: fixture.database, id: snapshot.id })
			?.status,
		'streaming',
	);
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
		deferShutdown: true,
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

// A delta run is held for one flush window before it is broadcast, so a test
// waits for the run to reach the sink instead of assuming when it will. The
// settle delay only backs a negative check, that nothing further is sent.
const DELTA_WINDOW_SETTLE_MS = 80;
const DELTA_WAIT_TIMEOUT_MS = 3000;

async function waitUntil(condition: () => boolean): Promise<void> {
	const deadline = Date.now() + DELTA_WAIT_TIMEOUT_MS;
	while (!condition()) {
		assert.ok(Date.now() < deadline, 'timed out waiting for a delta run');
		await delay(5);
	}
}

function streamingDelta(
	text: string,
	overrides: {
		kind?: 'reasoning-delta' | 'text-delta';
		parentToolCallId?: string;
	} = {},
): AgentEvent {
	return {
		at: '2026-06-08T00:00:00.000Z',
		...(overrides.parentToolCallId
			? { parentToolCallId: overrides.parentToolCallId }
			: {}),
		payload: { kind: overrides.kind ?? 'text-delta', text },
		role: 'agent',
		turnId: 'fake-turn',
		type: 'message',
	};
}

function sealedText(text: string): AgentEvent {
	return {
		at: '2026-06-08T00:00:02.000Z',
		payload: { kind: 'text', text },
		role: 'agent',
		turnId: 'fake-turn',
		type: 'message',
	};
}

function labelBroadcast(event: AgentEventRow): string {
	const envelope = event.payload;
	if (
		envelope?.kind === 'message' &&
		(envelope.payload.kind === 'text-delta' ||
			envelope.payload.kind === 'reasoning-delta')
	) {
		return `${envelope.payload.kind}:${envelope.payload.text}`;
	}
	return event.eventType;
}

async function openStreamingSession(
	t: import('node:test').TestContext,
	options: {
		eventSink?: (event: AgentEventRow) => void;
		queueNaming?: (input: SessionNamingInput) => void;
	} = {},
) {
	const fixture = openFixture(t);
	const broadcasts: AgentEventRow[] = [];
	const { fake, service } = createService(fixture.database, {
		eventSink: ({ event }) => {
			broadcasts.push(event);
			options.eventSink?.(event);
		},
		queueNaming: options.queueNaming,
	});
	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({ prompt: 'stream', sessionId: snapshot.id });
	await delay(10);
	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	return {
		broadcasts,
		database: fixture.database,
		fake,
		runtime,
		service,
		snapshot,
	};
}

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
	await waitUntil(() => parents.length === 2);

	assert.deepEqual(parents, ['toolu_task_1', undefined]);
});

test('fifty synchronous text deltas reach the sink as one broadcast', async (t) => {
	const { broadcasts, runtime } = await openStreamingSession(t);
	const before = broadcasts.length;
	const words = Array.from({ length: 50 }, (_, index) => `w${index} `);

	for (const word of words) {
		runtime.emit(streamingDelta(word));
	}
	assert.equal(broadcasts.length, before, 'held until the flush window closes');
	await waitUntil(() => broadcasts.length > before);
	await delay(DELTA_WINDOW_SETTLE_MS);

	assert.deepEqual(broadcasts.slice(before).map(labelBroadcast), [
		`text-delta:${words.join('')}`,
	]);
});

test('a persisted event is broadcast right after the deltas it flushed', async (t) => {
	const { broadcasts, runtime } = await openStreamingSession(t);
	const before = broadcasts.length;

	runtime.emit(streamingDelta('Hel'));
	runtime.emit(streamingDelta('lo'));
	runtime.emit(sealedText('Hello'));

	const [run, sealed, ...rest] = broadcasts.slice(before);
	assert.equal(run && labelBroadcast(run), 'text-delta:Hello');
	assert.equal(sealed && labelBroadcast(sealed), 'message');
	assert.ok(run && sealed && run.ordinal < sealed.ordinal);
	await delay(DELTA_WINDOW_SETTLE_MS);
	assert.equal(rest.length, 0);
	assert.equal(
		broadcasts.length,
		before + 2,
		'the flushed run is not sent twice',
	);
});

test('a status change flushes the buffered deltas before it is broadcast', async (t) => {
	const { broadcasts, runtime } = await openStreamingSession(t);
	const before = broadcasts.length;

	runtime.emit(streamingDelta('almost done'));
	runtime.setStatus('idle');

	assert.deepEqual(broadcasts.slice(before, before + 2).map(labelBroadcast), [
		'text-delta:almost done',
		'status',
	]);
});

test('deltas of another kind or thread start their own run, in order', async (t) => {
	const { broadcasts, runtime } = await openStreamingSession(t);
	const before = broadcasts.length;

	runtime.emit(streamingDelta('a'));
	runtime.emit(streamingDelta('b'));
	runtime.emit(streamingDelta('r', { kind: 'reasoning-delta' }));
	runtime.emit(streamingDelta('c', { parentToolCallId: 'toolu_task_1' }));
	runtime.emit(streamingDelta('d'));
	await waitUntil(() => broadcasts.length >= before + 4);
	await delay(DELTA_WINDOW_SETTLE_MS);

	const runs = broadcasts.slice(before);
	assert.deepEqual(runs.map(labelBroadcast), [
		'text-delta:ab',
		'reasoning-delta:r',
		'text-delta:c',
		'text-delta:d',
	]);
	const ordinals = runs.map((run) => run.ordinal);
	assert.deepEqual(
		ordinals,
		[...ordinals].sort((left, right) => left - right),
		'runs keep the order they opened in',
	);
	assert.deepEqual(
		runs.map((run) => run.id.split(':').at(-1)),
		['1', '2', '3', '4'],
		'one ordinal is reserved per run, not per token',
	);
});

test('a steer tags later deltas with the new turn instead of the interrupted one', async (t) => {
	const { broadcasts, runtime, service, snapshot } =
		await openStreamingSession(t);
	const before = broadcasts.length;

	runtime.emit(streamingDelta('one '));
	await service.submitPrompt({
		prompt: 'change course',
		sessionId: snapshot.id,
		streamingBehavior: 'steer',
	});
	runtime.emit(streamingDelta('two'));
	const deltaRuns = () =>
		broadcasts
			.slice(before)
			.filter((event) => labelBroadcast(event).startsWith('text-delta:'));
	await waitUntil(() => deltaRuns().length >= 2);

	const runs = deltaRuns();
	assert.deepEqual(runs.map(labelBroadcast), [
		'text-delta:one ',
		'text-delta:two',
	]);
	assert.ok(runs[0]?.turnId && runs[1]?.turnId);
	assert.notEqual(runs[0]?.turnId, runs[1]?.turnId);
});

test('each session streams into its own run', async (t) => {
	const fixture = openFixture(t);
	const broadcasts: Array<{ label: string; sessionId: string }> = [];
	const { fake, service } = createService(fixture.database, {
		eventSink: ({ event, sessionId }) => {
			broadcasts.push({ label: labelBroadcast(event), sessionId });
		},
	});
	const open = () =>
		service.openSession({
			executable: createReadyExecutable(),
			workspaceCwd: '/tmp/ensemblr/svc/ws',
			workspaceId: fixture.workspaceId,
		});
	const first = await open();
	const second = await open();
	await service.submitPrompt({ prompt: 'one', sessionId: first.id });
	await service.submitPrompt({ prompt: 'two', sessionId: second.id });
	await delay(10);
	const [firstRuntime, secondRuntime] = fake.getOpenSessions();
	assert.ok(
		firstRuntime && secondRuntime,
		'expected two open runtime sessions',
	);

	firstRuntime.emit(streamingDelta('a1 '));
	secondRuntime.emit(streamingDelta('b1 '));
	firstRuntime.emit(streamingDelta('a2'));
	secondRuntime.emit(streamingDelta('b2'));
	const deltasOf = (sessionId: string) =>
		broadcasts
			.filter((entry) => entry.sessionId === sessionId)
			.map((entry) => entry.label)
			.filter((label) => label.startsWith('text-delta:'));
	await waitUntil(
		() => deltasOf(first.id).length > 0 && deltasOf(second.id).length > 0,
	);
	await delay(DELTA_WINDOW_SETTLE_MS);

	assert.deepEqual(deltasOf(first.id), ['text-delta:a1 a2']);
	assert.deepEqual(deltasOf(second.id), ['text-delta:b1 b2']);
});

test('a sink that throws on a delta run does not stop later broadcasts', async (t) => {
	t.mock.method(console, 'warn', () => undefined);
	let failDeltas = true;
	const { broadcasts, runtime } = await openStreamingSession(t, {
		eventSink: (event) => {
			if (failDeltas && labelBroadcast(event).startsWith('text-delta:')) {
				throw new Error('renderer gone');
			}
		},
	});
	const before = broadcasts.length;

	runtime.emit(streamingDelta('lost'));
	await waitUntil(() => broadcasts.length > before);
	failDeltas = false;
	runtime.emit(streamingDelta('kept'));
	runtime.emit(sealedText('kept'));

	assert.deepEqual(broadcasts.slice(before).map(labelBroadcast), [
		'text-delta:lost',
		'text-delta:kept',
		'message',
	]);
});

// Rows also reach the timeline from outside the runtime event stream: a plan the
// app submits for the agent, a workspace rename, a tab name the agent chooses, and
// the title derived from the first prompt. None of them passes through the
// runtime handler, so a delta run must step past them from storage rather than
// from the last event the handler saw, or it sorts below a row that arrived
// before it.
async function deltaRunOrdinal(
	broadcasts: readonly AgentEventRow[],
	runtime: { emit: (event: AgentEvent) => void },
	text: string,
): Promise<number> {
	const isRun = (event: AgentEventRow) =>
		labelBroadcast(event) === `text-delta:${text}`;
	runtime.emit(streamingDelta(text));
	await waitUntil(() => broadcasts.some(isRun));
	const run = broadcasts.find(isRun);
	assert.ok(run, 'expected the delta run to reach the sink');
	return run.ordinal;
}

function isChatTitleRow(event: AgentEventRow): boolean {
	const envelope = event.payload;
	return (
		envelope?.kind === 'metadata' && envelope.metadata.chatTitle !== undefined
	);
}

test('a delta after a plan appended outside the runtime stream sorts above it', async (t) => {
	const { broadcasts, runtime, service, snapshot } =
		await openStreamingSession(t);
	runtime.emit(sealedText('drafting'));

	service.appendAgentMessage({ sessionId: snapshot.id, text: '# Plan' });
	const plan = broadcasts.at(-1);
	assert.ok(plan && labelBroadcast(plan) === 'message');
	const ordinal = await deltaRunOrdinal(broadcasts, runtime, 'after the plan');

	assert.ok(
		ordinal > plan.ordinal,
		`delta ordinal ${ordinal} must sort above the plan row ${plan.ordinal}`,
	);
});

test('a delta after a workspace rename sorts above the rename row', async (t) => {
	const { broadcasts, runtime, service, snapshot } =
		await openStreamingSession(t);
	runtime.emit(sealedText('drafting'));

	service.appendWorkspaceRenamed(snapshot.id);
	const renamed = broadcasts.at(-1);
	assert.ok(renamed && labelBroadcast(renamed) === 'metadata');
	const ordinal = await deltaRunOrdinal(broadcasts, runtime, 'after rename');

	assert.ok(
		ordinal > renamed.ordinal,
		`delta ordinal ${ordinal} must sort above the rename row ${renamed.ordinal}`,
	);
});

test('a delta after the agent names the tab sorts above the title row', async (t) => {
	const { broadcasts, runtime, service, snapshot } =
		await openStreamingSession(t);
	runtime.emit(sealedText('drafting'));

	await service.setSessionName({
		name: 'Refactor auth flow',
		provenance: 'agent',
		sessionId: snapshot.id,
	});
	const title = broadcasts.at(-1);
	assert.ok(title && isChatTitleRow(title));
	const ordinal = await deltaRunOrdinal(broadcasts, runtime, 'after the name');

	assert.ok(
		ordinal > title.ordinal,
		`delta ordinal ${ordinal} must sort above the title row ${title.ordinal}`,
	);
});

test('a delta after the derived first-prompt title sorts above the title row', async (t) => {
	const { broadcasts, runtime } = await openStreamingSession(t, {
		queueNaming: createSessionNaming(),
	});

	runtime.setStatus('idle');
	await waitUntil(() => broadcasts.some(isChatTitleRow));
	const title = broadcasts.find(isChatTitleRow);
	assert.ok(title);
	const ordinal = await deltaRunOrdinal(broadcasts, runtime, 'next turn');

	assert.ok(
		ordinal > title.ordinal,
		`delta ordinal ${ordinal} must sort above the title row ${title.ordinal}`,
	);
});

test('runs opened after one append keep their own ordinals, in order', async (t) => {
	const { broadcasts, runtime, service, snapshot } =
		await openStreamingSession(t);
	runtime.emit(sealedText('drafting'));
	service.appendAgentMessage({ sessionId: snapshot.id, text: '# Plan' });
	const before = broadcasts.length;

	runtime.emit(streamingDelta('a'));
	runtime.emit(streamingDelta('r', { kind: 'reasoning-delta' }));
	runtime.emit(streamingDelta('b'));
	await waitUntil(() => broadcasts.length >= before + 3);
	await delay(DELTA_WINDOW_SETTLE_MS);

	const runs = broadcasts.slice(before);
	assert.deepEqual(runs.map(labelBroadcast), [
		'text-delta:a',
		'reasoning-delta:r',
		'text-delta:b',
	]);
	const ordinals = runs.map((run) => run.ordinal);
	assert.deepEqual(
		ordinals,
		[...ordinals].sort((left, right) => left - right),
	);
	assert.equal(new Set(runs.map((run) => run.id)).size, runs.length);
	assert.equal(new Set(ordinals).size, runs.length);
});

test('a delta run still broadcasts when the branch ordinal cannot be read', async (t) => {
	const warn = t.mock.method(console, 'warn', () => undefined);
	const { broadcasts, database, runtime } = await openStreamingSession(t);
	const prepare = database.prepare.bind(database);
	t.mock.method(database, 'prepare', (sql: string) => {
		if (sql.includes('AS max')) {
			throw new Error('disk I/O error');
		}
		return prepare(sql);
	});

	await deltaRunOrdinal(broadcasts, runtime, 'still streaming');

	const warnings = warn.mock.calls.map((call) => String(call.arguments[0]));
	assert.ok(
		warnings.some((message) => message.includes('newest event ordinal')),
		'the failed read is reported',
	);
});

test('a run still buffered when its session is stopped reaches the workspace before the shutdown', async (t) => {
	const fixture = openFixture(t);
	const broadcasts: Array<{ label: string; workspaceId: string }> = [];
	const { fake, service } = createService(fixture.database, {
		deferShutdown: true,
		eventSink: ({ event, workspaceId }) => {
			broadcasts.push({ label: labelBroadcast(event), workspaceId });
		},
	});
	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({ prompt: 'stream', sessionId: snapshot.id });
	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');

	runtime.emit(streamingDelta('cut off mid-sentence'));
	await service.stopSession({ sessionId: snapshot.id });
	await waitUntil(
		() =>
			broadcasts.some((entry) => entry.label === 'shutdown') &&
			broadcasts.some((entry) => entry.label.startsWith('text-delta:')),
	);

	const tail = broadcasts.filter(
		(entry) =>
			entry.label === 'shutdown' || entry.label.startsWith('text-delta:'),
	);
	assert.deepEqual(tail, [
		{
			label: 'text-delta:cut off mid-sentence',
			workspaceId: fixture.workspaceId,
		},
		{ label: 'shutdown', workspaceId: fixture.workspaceId },
	]);
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

// Archiving or deleting a workspace stops every session it holds, idle ones
// included. An idle session has no turn to interrupt, so reporting the stop as
// an abort writes "You stopped this turn" into a chat the user never ran, and
// rewrites the last completed turn as aborted. The stop reason below is the one
// the teardown records, but it is incidental: the branch is taken off the
// session's own status, so a stop with any reason behaves the same way.
test('stopSession closes an idle session instead of reporting a stopped turn', async (t) => {
	const fixture = openFixture(t);
	const shutdowns: string[] = [];
	const { fake, service } = createService(fixture.database, {
		deferShutdown: true,
		eventSink: ({ event }) => {
			const envelope = event.payload;
			if (envelope?.kind === 'shutdown') {
				shutdowns.push(envelope.reason);
			}
		},
	});

	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: '/tmp/ensemblr/svc/ws',
		workspaceId: fixture.workspaceId,
	});
	await service.submitPrompt({ prompt: 'task', sessionId: snapshot.id });
	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	runtime.setStatus('idle');
	await delay(10);

	await service.stopSession({
		reason: WORKSPACE_REMOVED_STOP_REASON,
		sessionId: snapshot.id,
	});
	await delay(20);

	assert.deepEqual(
		shutdowns,
		['manual'],
		'an idle session must not report an aborted turn',
	);
	const turns = listTurns({
		branchId: snapshot.branchId,
		database: fixture.database,
	});
	assert.equal(turns.length, 1, 'expected the submitted turn');
	assert.equal(
		turns[0]?.status,
		'completed',
		'a turn the runtime already finished settles as completed, not aborted',
	);
	assert.ok(
		turns[0]?.completedAt,
		'a settled turn carries the instant it settled',
	);
});

test('stopSession still reports an aborted turn while one is streaming', async (t) => {
	const fixture = openFixture(t);
	const shutdowns: string[] = [];
	const { service } = createService(fixture.database, {
		deferShutdown: true,
		eventSink: ({ event }) => {
			const envelope = event.payload;
			if (envelope?.kind === 'shutdown') {
				shutdowns.push(envelope.reason);
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

	assert.deepEqual(shutdowns, ['aborted']);
	const turns = listTurns({
		branchId: snapshot.branchId,
		database: fixture.database,
	});
	assert.equal(turns[0]?.status, 'aborted');
	assert.ok(turns[0]?.completedAt, 'an aborted turn carries its end instant');
});
