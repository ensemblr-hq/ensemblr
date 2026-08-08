import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentAdapterSession } from '../../src/main/agent-runtime/agent-adapter.ts';
import { createAgentClient } from '../../src/main/agent-runtime/agent-client.ts';
import { createSessionOpener } from '../../src/main/agent-runtime/session/session-open.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import type { ClaudeCanUseTool } from '../../src/main/claude-agent/claude-permission-bridge.ts';
import { createClaudeToolApprovalCoordinator } from '../../src/main/claude-agent/claude-tool-approval.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import type {
	ToolApprovalClosedBroadcast,
	ToolApprovalRequestedBroadcast,
} from '../../src/shared/agent-tool-approval.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const WORKSPACE_ID = 'ws-approval';
const WORKSPACE_CWD = '/tmp/ensemblr/approval/ws';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

/** A coordinator plus the broadcasts it produced, wired to a live renderer. */
function createHarness({ hasRenderer = true }: { hasRenderer?: boolean } = {}) {
	const requested: ToolApprovalRequestedBroadcast[] = [];
	const closed: ToolApprovalClosedBroadcast[] = [];
	let nextId = 0;
	const coordinator = createClaudeToolApprovalCoordinator({
		broadcastClosed: (payload) => closed.push(payload),
		broadcastRequested: (payload) => requested.push(payload),
		createRequestId: () => {
			nextId += 1;
			return `req-${nextId}`;
		},
		hasRenderer: () => hasRenderer,
	});
	return { closed, coordinator, requested };
}

/** The SDK's third `canUseTool` argument, with a fresh abort controller. */
function toolCallOptions(controller = new AbortController()) {
	return {
		controller,
		options: {
			requestId: 'sdk-req',
			signal: controller.signal,
			toolUseID: 'tool-use-1',
		},
	};
}

/** Waits for the microtask queue to drain so a raised prompt is observable. */
const flush = (): Promise<void> =>
	new Promise((resolve) => setImmediate(resolve));

/** The denial a session release hands back to a tool call it was holding. */
const SESSION_ENDED = {
	behavior: 'deny',
	message:
		'The session ended before the user answered this permission request.',
};

/** The denial a tool call gets once the app has started quitting. */
const QUITTING = {
	behavior: 'deny',
	message: 'Ensemblr is quitting, so this tool call was denied unprompted.',
};

describe('the approval coordinator raises a prompt and settles the tool call', () => {
	it('announces the tool name and a readable input preview', async () => {
		const { coordinator, requested } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		const decision = canUseTool(
			'Bash',
			{ command: 'rm -rf build', description: 'clear the build' },
			toolCallOptions().options,
		);
		await flush();

		expect(requested).toEqual([
			{
				agentSessionId: 'session-1',
				input: { command: 'rm -rf build', description: 'clear the build' },
				requestId: 'req-1',
				toolName: 'Bash',
			},
		]);

		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow' },
			requestId: 'req-1',
		});
		await expect(decision).resolves.toEqual({
			behavior: 'allow',
			updatedInput: { command: 'rm -rf build', description: 'clear the build' },
		});
	});

	it('drops non-scalar input fields rather than pushing a file across IPC', async () => {
		const { coordinator, requested } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		void canUseTool(
			'Write',
			{ edits: [{ new_string: 'b', old_string: 'a' }], file_path: '/tmp/a.ts' },
			toolCallOptions().options,
		);
		await flush();

		expect(requested[0]?.input).toEqual({ file_path: '/tmp/a.ts' });
	});

	it('forwards the SDK prompt sentence when Claude Code supplies one', async () => {
		const { coordinator, requested } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});
		const { options } = toolCallOptions();

		void canUseTool(
			'Read',
			{ file_path: '/tmp/a.ts' },
			{
				...options,
				description: 'Claude will read one file.',
				displayName: 'Read file',
				title: 'Claude wants to read a.ts',
			},
		);
		await flush();

		expect(requested[0]).toMatchObject({
			description: 'Claude will read one file.',
			displayName: 'Read file',
			title: 'Claude wants to read a.ts',
		});
	});

	it('denies with the reason the user gave', async () => {
		const { coordinator } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		const decision = canUseTool('Bash', {}, toolCallOptions().options);
		await flush();
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'deny', reason: 'Not on main.' },
			requestId: 'req-1',
		});

		await expect(decision).resolves.toEqual({
			behavior: 'deny',
			message: 'Not on main.',
		});
	});

	it('denies with a default message when the user gave no reason', async () => {
		const { coordinator } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		const decision = canUseTool('Bash', {}, toolCallOptions().options);
		await flush();
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'deny' },
			requestId: 'req-1',
		});

		await expect(decision).resolves.toEqual({
			behavior: 'deny',
			message: 'The user declined this tool call.',
		});
	});

	it('ignores an answer to a request nobody is waiting on', () => {
		const { closed, coordinator } = createHarness();

		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow' },
			requestId: 'nope',
		});

		expect(closed).toEqual([]);
	});

	it('replays open prompts so a reloaded window gets back in step', async () => {
		const { coordinator } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		void canUseTool('Bash', { command: 'ls' }, toolCallOptions().options);
		await flush();

		expect(coordinator.openRequests()).toHaveLength(1);
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow' },
			requestId: 'req-1',
		});
		expect(coordinator.openRequests()).toEqual([]);
	});
});

describe('an answer only settles the chat that raised the prompt', () => {
	it('ignores a reply whose session does not own the request id', async () => {
		const { closed, coordinator } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});
		let settled = false;

		const decision = canUseTool(
			'Bash',
			{ command: 'rm -rf build' },
			toolCallOptions().options,
		);
		void decision.then(() => {
			settled = true;
		});
		await flush();

		coordinator.settle({
			agentSessionId: 'session-2',
			decision: { kind: 'allow' },
			requestId: 'req-1',
		});
		await flush();

		expect(settled).toBe(false);
		expect(closed).toEqual([]);
		expect(coordinator.openRequests()).toHaveLength(1);
	});

	it('settles when the reply names the session that owns the request id', async () => {
		const { closed, coordinator } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		const decision = canUseTool(
			'Bash',
			{ command: 'ls' },
			toolCallOptions().options,
		);
		await flush();
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow' },
			requestId: 'req-1',
		});

		await expect(decision).resolves.toEqual({
			behavior: 'allow',
			updatedInput: { command: 'ls' },
		});
		expect(closed).toEqual([{ requestId: 'req-1' }]);
		expect(coordinator.openRequests()).toEqual([]);
	});

	it('leaves one chat unable to answer another chat blocked on the same tool', async () => {
		const { coordinator } = createHarness();
		const one = coordinator.openSession({ agentSessionId: 'session-1' });
		const two = coordinator.openSession({ agentSessionId: 'session-2' });

		const first = one.canUseTool('Bash', {}, toolCallOptions().options);
		await flush();
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow' },
			requestId: 'req-1',
		});
		await first;
		const second = two.canUseTool('Bash', {}, toolCallOptions().options);
		await flush();

		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow' },
			requestId: 'req-2',
		});
		await flush();

		expect(coordinator.openRequests()).toHaveLength(1);
		coordinator.settle({
			agentSessionId: 'session-2',
			decision: { kind: 'deny' },
			requestId: 'req-2',
		});
		await expect(second).resolves.toMatchObject({ behavior: 'deny' });
	});
});

describe('allow-for-session remembers a tool without persisting anything', () => {
	it('stops prompting for the same tool in the same session', async () => {
		const { coordinator, requested } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		const first = canUseTool(
			'Bash',
			{ command: 'ls' },
			toolCallOptions().options,
		);
		await flush();
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow-for-session' },
			requestId: 'req-1',
		});
		await first;

		const second = await canUseTool(
			'Bash',
			{ command: 'pwd' },
			toolCallOptions().options,
		);

		expect(second).toEqual({
			behavior: 'allow',
			updatedInput: { command: 'pwd' },
		});
		expect(requested).toHaveLength(1);
	});

	it('still prompts for a different tool in the same session', async () => {
		const { coordinator, requested } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		const first = canUseTool('Bash', {}, toolCallOptions().options);
		await flush();
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow-for-session' },
			requestId: 'req-1',
		});
		await first;

		void canUseTool(
			'Write',
			{ file_path: '/tmp/a' },
			toolCallOptions().options,
		);
		await flush();

		expect(requested.map((entry) => entry.toolName)).toEqual(['Bash', 'Write']);
	});

	it('never leaks the allowance into another session', async () => {
		const { coordinator, requested } = createHarness();
		const one = coordinator.openSession({ agentSessionId: 'session-1' });
		const two = coordinator.openSession({ agentSessionId: 'session-2' });

		const first = one.canUseTool('Bash', {}, toolCallOptions().options);
		await flush();
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow-for-session' },
			requestId: 'req-1',
		});
		await first;

		void two.canUseTool('Bash', {}, toolCallOptions().options);
		await flush();

		expect(requested).toHaveLength(2);
		expect(requested[1]?.agentSessionId).toBe('session-2');
	});
});

describe('parallel tool calls take the one card in turn', () => {
	it('raises the second prompt only once the first is answered', async () => {
		const { coordinator, requested } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		const first = canUseTool('Bash', {}, toolCallOptions().options);
		const second = canUseTool(
			'Write',
			{ file_path: '/tmp/a' },
			toolCallOptions().options,
		);
		await flush();

		expect(requested.map((entry) => entry.toolName)).toEqual(['Bash']);

		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow' },
			requestId: 'req-1',
		});
		await first;
		await flush();

		expect(requested.map((entry) => entry.toolName)).toEqual(['Bash', 'Write']);
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'deny' },
			requestId: 'req-2',
		});
		await expect(second).resolves.toMatchObject({ behavior: 'deny' });
	});

	it('lets a queued call skip its prompt once the tool was allowed for the session', async () => {
		const { coordinator, requested } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		const first = canUseTool(
			'Bash',
			{ command: 'ls' },
			toolCallOptions().options,
		);
		const second = canUseTool(
			'Bash',
			{ command: 'pwd' },
			toolCallOptions().options,
		);
		await flush();
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow-for-session' },
			requestId: 'req-1',
		});
		await first;

		await expect(second).resolves.toEqual({
			behavior: 'allow',
			updatedInput: { command: 'pwd' },
		});
		expect(requested).toHaveLength(1);
	});

	it('drains a queued call rather than prompting a session that already ended', async () => {
		const { coordinator, requested } = createHarness();
		const session = coordinator.openSession({ agentSessionId: 'session-1' });

		const first = session.canUseTool('Bash', {}, toolCallOptions().options);
		const second = session.canUseTool('Write', {}, toolCallOptions().options);
		await flush();
		session.release();

		await expect(first).resolves.toEqual(SESSION_ENDED);
		await expect(second).resolves.toEqual(SESSION_ENDED);
		expect(requested).toHaveLength(1);
	});
});

describe('nothing may leave a prompt pending', () => {
	it('denies and withdraws when the SDK aborts the request mid-prompt', async () => {
		const { closed, coordinator } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});
		const { controller, options } = toolCallOptions();

		const decision = canUseTool('Bash', { command: 'ls' }, options);
		await flush();
		controller.abort();

		await expect(decision).resolves.toEqual({
			behavior: 'deny',
			message:
				'The turn was interrupted before the user answered this permission request.',
		});
		expect(closed).toEqual([{ requestId: 'req-1' }]);
		expect(coordinator.openRequests()).toEqual([]);
	});

	it('denies immediately when the request arrives already aborted', async () => {
		const { coordinator, requested } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});
		const { controller, options } = toolCallOptions();
		controller.abort();

		await expect(canUseTool('Bash', {}, options)).resolves.toEqual({
			behavior: 'deny',
			message:
				'The turn was interrupted before the user answered this permission request.',
		});
		expect(requested).toEqual([]);
	});

	it('denies and withdraws every prompt the released session raised', async () => {
		const { closed, coordinator } = createHarness();
		const one = coordinator.openSession({ agentSessionId: 'session-1' });
		const two = coordinator.openSession({ agentSessionId: 'session-2' });

		const denied = one.canUseTool('Bash', {}, toolCallOptions().options);
		const survivor = two.canUseTool('Write', {}, toolCallOptions().options);
		await flush();
		one.release();

		await expect(denied).resolves.toEqual({
			behavior: 'deny',
			message:
				'The session ended before the user answered this permission request.',
		});
		expect(closed).toEqual([{ requestId: 'req-1' }]);
		expect(coordinator.openRequests()).toHaveLength(1);

		coordinator.settle({
			agentSessionId: 'session-2',
			decision: { kind: 'allow' },
			requestId: 'req-2',
		});
		await expect(survivor).resolves.toMatchObject({ behavior: 'allow' });
	});

	it('stops honouring an allow-for-session once the session is released', async () => {
		const { coordinator, requested } = createHarness();
		const session = coordinator.openSession({ agentSessionId: 'session-1' });

		const first = session.canUseTool('Bash', {}, toolCallOptions().options);
		await flush();
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow-for-session' },
			requestId: 'req-1',
		});
		await first;
		session.release();

		const late = await session.canUseTool(
			'Bash',
			{},
			toolCallOptions().options,
		);

		expect(late).toEqual(SESSION_ENDED);
		expect(requested).toHaveLength(1);
	});

	it('gives a reopened session an empty allow list', async () => {
		const { coordinator, requested } = createHarness();
		const first = coordinator.openSession({ agentSessionId: 'session-1' });

		const gated = first.canUseTool('Bash', {}, toolCallOptions().options);
		await flush();
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow-for-session' },
			requestId: 'req-1',
		});
		await gated;
		first.release();

		const reopened = coordinator.openSession({ agentSessionId: 'session-1' });
		void reopened.canUseTool('Bash', {}, toolCallOptions().options);
		await flush();

		expect(requested).toHaveLength(2);
	});
});

describe('a mode with nobody to ask never blocks Claude', () => {
	it('allows and warns once when no window is open', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		cleanups.push(() => warn.mockRestore());
		const { coordinator, requested } = createHarness({ hasRenderer: false });
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		const first = await canUseTool(
			'Bash',
			{ command: 'ls' },
			toolCallOptions().options,
		);
		await canUseTool('Write', {}, toolCallOptions().options);

		expect(first).toEqual({
			behavior: 'allow',
			updatedInput: { command: 'ls' },
		});
		expect(requested).toEqual([]);
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe('the quit path fails the seam closed', () => {
	it('denies a tool call that arrives after shutdown began, windowless or not', async () => {
		const { coordinator, requested } = createHarness({ hasRenderer: false });
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		coordinator.shutdown();

		await expect(
			canUseTool(
				'Bash',
				{ command: 'rm -rf build' },
				toolCallOptions().options,
			),
		).resolves.toEqual(QUITTING);
		expect(requested).toEqual([]);
	});

	it('stops honouring an allow-for-session once the app starts quitting', async () => {
		const { coordinator } = createHarness();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-1',
		});

		const first = canUseTool('Bash', {}, toolCallOptions().options);
		await flush();
		coordinator.settle({
			agentSessionId: 'session-1',
			decision: { kind: 'allow-for-session' },
			requestId: 'req-1',
		});
		await first;
		coordinator.shutdown();

		await expect(
			canUseTool('Bash', {}, toolCallOptions().options),
		).resolves.toEqual(QUITTING);
	});

	it('denies and withdraws every prompt still on screen when quitting begins', async () => {
		const { closed, coordinator } = createHarness();
		const one = coordinator.openSession({ agentSessionId: 'session-1' });
		const two = coordinator.openSession({ agentSessionId: 'session-2' });

		const first = one.canUseTool('Bash', {}, toolCallOptions().options);
		const second = two.canUseTool('Write', {}, toolCallOptions().options);
		await flush();
		coordinator.shutdown();

		await expect(first).resolves.toEqual(SESSION_ENDED);
		await expect(second).resolves.toEqual(SESSION_ENDED);
		expect(closed).toEqual([{ requestId: 'req-1' }, { requestId: 'req-2' }]);
		expect(coordinator.openRequests()).toEqual([]);
	});

	it('denies a session opened after shutdown rather than trusting a late window', async () => {
		const { coordinator, requested } = createHarness();

		coordinator.shutdown();
		const { canUseTool } = coordinator.openSession({
			agentSessionId: 'session-late',
		});

		await expect(
			canUseTool('Write', { file_path: '/tmp/a' }, toolCallOptions().options),
		).resolves.toEqual(QUITTING);
		expect(requested).toEqual([]);
	});
});

/** A `query()` that never yields, so the adapter session stays open. */
function createPendingQuery(): Query {
	const iterator = (async function* (): AsyncGenerator<SDKMessage, void> {
		await new Promise<void>(() => undefined);
	})();
	return Object.assign(iterator, {
		applyFlagSettings: async () => undefined,
		close: () => undefined,
		getContextUsage: async () => CONTEXT_USAGE,
		interrupt: async () => undefined,
		setModel: async () => undefined,
		setPermissionMode: async () => undefined,
	}) as unknown as Query;
}

/**
 * Opens a Claude session through the real adapter with the coordinator attached
 * at the production seam, then raises one prompt and leaves it pending.
 */
async function openSessionWithPendingPrompt(): Promise<{
	adapter: ReturnType<typeof createClaudeAgentAdapter>;
	closed: ToolApprovalClosedBroadcast[];
	decision: Promise<Awaited<ReturnType<ClaudeCanUseTool>>>;
	session: AgentAdapterSession;
}> {
	const { closed, coordinator, requested } = createHarness();
	let installed: ClaudeCanUseTool | undefined;
	const adapter = createClaudeAgentAdapter({
		canUseTool: coordinator.openSession,
		queryFn: ({ options }) => {
			installed = options?.canUseTool;
			return createPendingQuery();
		},
		resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
	});
	const session = await adapter.createSession({
		metadata: {
			args: [],
			command: 'claude',
			cwd: '/tmp/ws',
			env: {},
			// Deliberately unlike the row key below: the client's handle is its own
			// uuid, and a gate keyed by it reaches no chat tab.
			id: 'runtime-handle-1',
			label: 'Chat',
			model: null,
			piAgentDirectoryPreserved: true,
			provider: 'claude',
			sessionId: null,
			startedAt: '2026-08-07T00:00:00.000Z',
			status: 'starting',
			thinking: null,
			updatedAt: '2026-08-07T00:00:00.000Z',
		},
		request: {
			agentSessionId: 'session-1',
			permissionMode: 'approval-required',
			workspaceCwd: '/tmp/ws',
		},
	});
	if (!installed) {
		throw new Error('The adapter installed no canUseTool for the gated mode.');
	}
	const decision = installed(
		'Bash',
		{ command: 'ls' },
		toolCallOptions().options,
	);
	await flush();
	if (requested.length !== 1) {
		throw new Error('The gated tool call raised no prompt.');
	}
	return { adapter, closed, decision, session };
}

describe('the adapter releases the seam on every shutdown path', () => {
	it('resolves an outstanding prompt when the user stops the session', async () => {
		const { closed, decision, session } = await openSessionWithPendingPrompt();

		await session.abort('stopped');

		await expect(decision).resolves.toEqual(SESSION_ENDED);
		expect(closed).toEqual([{ requestId: 'req-1' }]);
	});

	it('resolves an outstanding prompt when the session closes', async () => {
		const { closed, decision, session } = await openSessionWithPendingPrompt();

		await session.close();

		await expect(decision).resolves.toEqual(SESSION_ENDED);
		expect(closed).toEqual([{ requestId: 'req-1' }]);
	});

	it('resolves an outstanding prompt when the app shuts the adapter down', async () => {
		const { adapter, closed, decision } = await openSessionWithPendingPrompt();

		await adapter.shutdown();

		await expect(decision).resolves.toEqual(SESSION_ENDED);
		expect(closed).toEqual([{ requestId: 'req-1' }]);
	});
});

/** A database with the one repository and workspace a session needs to open. */
function openTestDatabase(): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-approval-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'approval-test.db'),
	});
	cleanups.push(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-approval', 'approval', 'Approval', '/tmp/ensemblr/approval', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('${WORKSPACE_ID}', 'repo-approval', 'approval', 'Approval', '${WORKSPACE_CWD}');
`);
	return connection.database;
}

/** A Pi executable snapshot the opener accepts without probing anything. */
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
		updatedAt: '2026-08-07T00:00:00.000Z',
	};
}

/**
 * Opens a Claude session the way the app does — real database, real
 * `AgentClient`, real adapter, real coordinator — then gates one tool call and
 * returns both the announcement the renderer receives and the ids it could have
 * been keyed by.
 *
 * No `resolveAgentControlEnv` is wired, so the session has no control token; a
 * card that only worked with the control server up would fail here.
 */
async function raisePromptThroughTheOpener(): Promise<{
	broadcast: ToolApprovalRequestedBroadcast;
	chatTabAgentSessionId: string | null;
	clientSessionId: string;
	snapshotId: string;
}> {
	const database = openTestDatabase();
	const { coordinator, requested } = createHarness();
	let installed: ClaudeCanUseTool | undefined;
	const agentClient = createAgentClient({
		adapters: {
			claude: createClaudeAgentAdapter({
				canUseTool: coordinator.openSession,
				queryFn: ({ options }) => {
					installed = options?.canUseTool;
					return createPendingQuery();
				},
				resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
			}),
		},
	});
	cleanups.push(() => {
		void agentClient.shutdown();
	});

	let clientSessionId = '';
	const opener = createSessionOpener({
		activeSessions: new Map(),
		agentClient,
		eventSink: undefined,
		isPlanModeActive: () => false,
		now: () => new Date('2026-08-07T00:00:00.000Z'),
		queueNaming: () => undefined,
		resolvePermissionMode: () => 'approval-required',
		subscribeToRuntime: ({ runtimeSession }) => {
			clientSessionId = runtimeSession.id;
			return { unsubscribe: () => undefined };
		},
	});

	const snapshot = await opener.openSession({
		database,
		request: {
			executable: createReadyExecutable(),
			provider: 'claude',
			workspaceCwd: WORKSPACE_CWD,
			workspaceId: WORKSPACE_ID,
		},
	});

	if (!installed) {
		throw new Error('The adapter installed no canUseTool for the gated mode.');
	}
	void installed('Bash', { command: 'ls' }, toolCallOptions().options);
	await flush();

	const broadcast = requested[0];
	if (!broadcast) {
		throw new Error('The gated tool call raised no prompt.');
	}
	return {
		broadcast,
		chatTabAgentSessionId: snapshot.openedTabs[0]?.agentSessionId ?? null,
		clientSessionId,
		snapshotId: snapshot.id,
	};
}

describe('the prompt reaches the chat the renderer is holding open', () => {
	it('names the tool call by the agent_sessions.id the renderer keys by', async () => {
		const { broadcast, chatTabAgentSessionId, snapshotId } =
			await raisePromptThroughTheOpener();

		expect(broadcast.agentSessionId).toBe(snapshotId);
		expect(broadcast.agentSessionId).toBe(chatTabAgentSessionId);
	});

	it('leaves the client no second id the card could have been misfiled under', async () => {
		const { broadcast, clientSessionId, snapshotId } =
			await raisePromptThroughTheOpener();

		expect(clientSessionId).toBe(snapshotId);
		expect(broadcast.agentSessionId).toBe(clientSessionId);
	});
});
