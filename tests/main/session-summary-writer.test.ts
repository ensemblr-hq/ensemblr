import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
	PiAgentClient,
	PiAgentSession,
} from '../../src/main/pi-agent/pi-agent-client.ts';
import type {
	PiAgentEventListener,
	PiAgentSessionMetadata,
	PiAgentSubmitRequest,
	PiAgentSubscription,
} from '../../src/main/pi-agent/pi-agent-types.ts';
import { createSessionSummaryWriter } from '../../src/main/pi-agent/session-summary-writer.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import type { PiSessionEventWire } from '../../src/shared/ipc/contracts/pi-session.ts';

function makeFakeExecutable(): PiExecutableSnapshot {
	return {
		command: '/fake/pi',
		diagnostics: [],
		displayPath: '/fake/pi',
		path: '/fake/pi',
		probe: null,
		setting: null,
		source: 'built-in-default',
		status: 'ok',
		updatedAt: '2026-01-01T00:00:00.000Z',
	} satisfies PiExecutableSnapshot;
}

interface ThrowingClientHandle {
	client: PiAgentClient;
	getCreateCalls: () => number;
}

function makeThrowingClient(): ThrowingClientHandle {
	let createCalls = 0;
	const client: PiAgentClient = {
		createSession: async () => {
			createCalls += 1;
			throw new Error('boom');
		},
		listSessions: () => [],
		shutdown: async () => undefined,
	};
	return { client, getCreateCalls: () => createCalls };
}

function makeWorkspaceDir(t: import('node:test').TestContext): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-summary-'));
	t.after(() => rmSync(directory, { force: true, recursive: true }));
	return directory;
}

function makeUserEvent(text: string, turnId = 't-1'): PiSessionEventWire {
	return {
		branchId: 'b-1',
		createdAt: '2026-01-01T00:00:00.000Z',
		eventType: 'message',
		id: `evt-user-${turnId}`,
		ordinal: 0,
		payload: {
			kind: 'message',
			payload: { kind: 'prompt', prompt: text },
			role: 'user',
		},
		stream: 'protocol',
		turnId,
	};
}

function makeAgentEvent(text: string, turnId = 't-1'): PiSessionEventWire {
	return {
		branchId: 'b-1',
		createdAt: '2026-01-01T00:00:01.000Z',
		eventType: 'message',
		id: `evt-agent-${turnId}`,
		ordinal: 1,
		payload: {
			kind: 'message',
			payload: {
				kind: 'message',
				parts: [{ kind: 'text', text }],
				role: 'assistant',
			},
			role: 'agent',
		},
		stream: 'protocol',
		turnId,
	};
}

test('writes a stub when piSessionId is null', async (t) => {
	const workspaceCwd = makeWorkspaceDir(t);
	const writer = createSessionSummaryWriter();

	const result = await writer.writeSessionSummary({
		branchId: null,
		chatTabId: 'tab-empty',
		closedAt: '2026-01-01T00:00:00.000Z',
		events: [],
		piSessionId: null,
		workspaceCwd,
	});

	assert.equal(result.usedLlm, false);
	assert.equal(result.title, null);
	assert.equal(
		result.path,
		path.join(workspaceCwd, '.context', 'sessions', 'tab-empty.md'),
	);
	const contents = readFileSync(result.path, 'utf8');
	assert.match(contents, /chatTabId: "tab-empty"/);
	assert.match(contents, /piSessionId: null/);
	assert.match(contents, /summaryModel: null/);
	assert.match(contents, /messageCount: 0/);
	assert.match(contents, /turnCount: 0/);
	assert.match(contents, /Empty tab/);
});

test('writes a stub when events array is empty even with a piSessionId', async (t) => {
	const workspaceCwd = makeWorkspaceDir(t);
	const writer = createSessionSummaryWriter();

	const result = await writer.writeSessionSummary({
		branchId: 'branch-1',
		chatTabId: 'tab-empty-events',
		closedAt: '2026-01-01T00:00:00.000Z',
		events: [],
		piSessionId: 'pi-session-1',
		workspaceCwd,
	});

	assert.equal(result.usedLlm, false);
	assert.equal(result.title, null);
	const contents = readFileSync(result.path, 'utf8');
	assert.match(contents, /Empty tab/);
});

test('falls back to deterministic transcript when no Pi client is supplied', async (t) => {
	const workspaceCwd = makeWorkspaceDir(t);
	const writer = createSessionSummaryWriter();

	const result = await writer.writeSessionSummary({
		branchId: 'branch-1',
		chatTabId: 'tab-no-llm',
		closedAt: '2026-01-02T00:00:00.000Z',
		events: [
			makeUserEvent('Help me refactor the auth module', 't-1'),
			makeAgentEvent('Sure — extracting providers into a service.', 't-1'),
		],
		piSessionId: 'pi-session-1',
		workspaceCwd,
	});

	assert.equal(result.usedLlm, false);
	assert.equal(result.title, 'Help me refactor the auth module');
	const contents = readFileSync(result.path, 'utf8');
	assert.match(contents, /chatTabId: "tab-no-llm"/);
	assert.match(contents, /piSessionId: "pi-session-1"/);
	assert.match(contents, /branchId: "branch-1"/);
	assert.match(contents, /summaryModel: null/);
	assert.match(contents, /messageCount: 2/);
	assert.match(contents, /turnCount: 1/);
	assert.match(contents, /# Help me refactor the auth module/);
	assert.match(contents, /\[user\]: Help me refactor the auth module/);
	assert.match(
		contents,
		/\[agent\]: Sure — extracting providers into a service\./,
	);
});

test('falls back deterministically when the ephemeral Pi session throws', async (t) => {
	const workspaceCwd = makeWorkspaceDir(t);
	const throwingClient = makeThrowingClient();
	const writer = createSessionSummaryWriter({
		piAgentClient: throwingClient.client,
		resolveExecutable: async () => makeFakeExecutable(),
	});

	const result = await writer.writeSessionSummary({
		branchId: 'branch-1',
		chatTabId: 'tab-llm-fail',
		closedAt: '2026-01-03T00:00:00.000Z',
		events: [
			makeUserEvent('Investigate flaky test', 't-1'),
			makeAgentEvent('Looking into it now', 't-1'),
		],
		piSessionId: 'pi-session-2',
		workspaceCwd,
	});

	assert.equal(result.usedLlm, false);
	assert.equal(result.title, 'Investigate flaky test');
	assert.equal(throwingClient.getCreateCalls(), 1);
	const contents = readFileSync(result.path, 'utf8');
	assert.match(contents, /# Investigate flaky test/);
});

test('produces an LLM summary when the ephemeral session emits agent messages', async (t) => {
	const workspaceCwd = makeWorkspaceDir(t);
	let submittedPrompt: string | null = null;

	const fakeClient = makeFakeAgentClient({
		onSubmit: (request) => {
			submittedPrompt = request.prompt;
		},
		response: 'Refactor auth providers\n\n- Extract `AuthService`\n- Add tests',
	});

	const writer = createSessionSummaryWriter({
		piAgentClient: fakeClient.client,
		resolveExecutable: async () => makeFakeExecutable(),
	});

	const result = await writer.writeSessionSummary({
		branchId: 'branch-1',
		chatTabId: 'tab-llm-ok',
		closedAt: '2026-01-04T00:00:00.000Z',
		events: [
			makeUserEvent('Refactor auth providers', 't-1'),
			makeAgentEvent('Working on it', 't-1'),
		],
		piSessionId: 'pi-session-3',
		workspaceCwd,
	});

	assert.equal(result.usedLlm, true);
	assert.equal(result.title, 'Refactor auth providers');
	const promptValue = submittedPrompt as string | null;
	assert.ok(
		typeof promptValue === 'string' && promptValue.includes('TRANSCRIPT:'),
	);
	const contents = readFileSync(result.path, 'utf8');
	assert.match(contents, /summaryModel: null/);
	assert.match(contents, /# Refactor auth providers/);
	assert.match(contents, /- Extract `AuthService`/);
});

interface FakeAgentClientOptions {
	onSubmit?: (request: PiAgentSubmitRequest) => void;
	response: string;
}

function makeFakeAgentClient(options: FakeAgentClientOptions): {
	client: PiAgentClient;
} {
	const sessionId = 'session-stub';
	const metadata: PiAgentSessionMetadata = {
		args: ['--mode', 'rpc'],
		command: '/fake/pi',
		cwd: '/fake/cwd',
		env: {},
		id: sessionId,
		label: 'ensemble-session-summary',
		model: null,
		piAgentDirectoryPreserved: true,
		sessionId: null,
		startedAt: '2026-01-04T00:00:00.000Z',
		status: 'starting',
		thinking: null,
		updatedAt: '2026-01-04T00:00:00.000Z',
	};

	const session: PiAgentSession = {
		abort: async () => undefined,
		close: async () => undefined,
		getMetadata: () => metadata,
		id: sessionId,
		subscribe: (listener: PiAgentEventListener): PiAgentSubscription => {
			queueMicrotask(() => {
				listener({
					at: '2026-01-04T00:00:01.000Z',
					payload: {
						kind: 'message',
						parts: [{ kind: 'text', text: options.response }],
						role: 'assistant',
					},
					role: 'agent',
					turnId: 'turn-1',
					type: 'message',
				});
				listener({
					at: '2026-01-04T00:00:02.000Z',
					previous: 'streaming',
					status: 'idle',
					type: 'status',
				});
			});
			return { unsubscribe: () => undefined };
		},
		submit: async (request) => {
			options.onSubmit?.(request);
			return {
				acceptedAt: '2026-01-04T00:00:00.500Z',
				turnId: 'turn-1',
			};
		},
	};

	const client: PiAgentClient = {
		createSession: async () => session,
		listSessions: () => [session],
		shutdown: async () => undefined,
	};
	return { client };
}
