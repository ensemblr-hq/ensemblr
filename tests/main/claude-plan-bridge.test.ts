import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentControlOrigin } from '../../src/main/agent-control/ports.ts';
import type { AgentSessionMetadata } from '../../src/main/agent-runtime/agent-types.ts';
import {
	type CreateClaudeAgentAdapterOptions,
	createClaudeAgentAdapter,
	createClaudePlanBridge,
} from '../../src/main/claude-agent/index.ts';

const TOKEN = 'tok-claude-1';

const ORIGIN: AgentControlOrigin = {
	depth: 0,
	parentSessionId: null,
	sessionId: 'sess-1',
	species: 'claude',
	token: TOKEN,
	workspaceCwd: '/tmp/ws-1',
	workspaceId: 'ws-1',
};

const SUBMISSION = {
	plan: '# Ship it\n\nStep one.',
	title: 'Ship it',
	toolCallId: 'toolu_9',
};

/** Builds the bridge over a registry that knows exactly one token. */
const setup = (options: { submitFails?: boolean } = {}) => {
	const submitPlan = vi.fn(
		options.submitFails
			? () => Promise.reject(new Error('disk full'))
			: () => Promise.resolve({ planPath: null, summary: 'saved' }),
	);
	const bridge = createClaudePlanBridge({
		resolveOrigin: (token) => (token === TOKEN ? ORIGIN : null),
		submitPlan,
	});
	return { bridge, submitPlan };
};

beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('the Claude plan bridge', () => {
	it('files the plan against the origin behind the session token', () => {
		const { bridge, submitPlan } = setup();

		bridge({
			agentSessionId: 'agent-session-1',
			controlToken: TOKEN,
			submission: SUBMISSION,
		});

		expect(submitPlan).toHaveBeenCalledWith({
			args: { plan: SUBMISSION.plan, title: SUBMISSION.title },
			origin: ORIGIN,
		});
	});

	it('skips a submission whose token resolves to no origin', () => {
		const { bridge, submitPlan } = setup();

		bridge({
			agentSessionId: 'agent-session-1',
			controlToken: 'tok-stale',
			submission: SUBMISSION,
		});

		expect(submitPlan).not.toHaveBeenCalled();
	});

	it('skips a session that never reached the control server', () => {
		const { bridge, submitPlan } = setup();

		bridge({
			agentSessionId: 'agent-session-1',
			controlToken: null,
			submission: SUBMISSION,
		});

		expect(submitPlan).not.toHaveBeenCalled();
	});

	it('survives a failed submission instead of rejecting into the event pump', async () => {
		const { bridge } = setup({ submitFails: true });

		expect(() =>
			bridge({
				agentSessionId: 'agent-session-1',
				controlToken: TOKEN,
				submission: SUBMISSION,
			}),
		).not.toThrow();
		await Promise.resolve();
		await Promise.resolve();
	});
});

/** Metadata the client would have seeded before handing the adapter a session. */
const metadataFor = (id: string): AgentSessionMetadata => ({
	args: [],
	command: '',
	cwd: '/tmp/ws-1',
	env: {},
	id,
	label: 'claude-session',
	model: null,
	piAgentDirectoryPreserved: true,
	provider: 'claude',
	sessionId: null,
	startedAt: '2026-08-06T12:00:00.000Z',
	status: 'starting',
	thinking: null,
	updatedAt: '2026-08-06T12:00:00.000Z',
});

/**
 * A `Query` stand-in that replays a fixed message list and no-ops every control
 * method, so the adapter can be driven without the Agent SDK spawning `claude`.
 */
const fakeQueryFn = (
	messages: readonly unknown[],
): CreateClaudeAgentAdapterOptions['queryFn'] => {
	async function* replay() {
		for (const message of messages) {
			yield message;
		}
	}
	return (() =>
		Object.assign(replay(), {
			applyFlagSettings: async () => undefined,
			close: () => undefined,
			getContextUsage: async () => null,
			interrupt: async () => undefined,
			mcpServerStatus: async () => [],
			setModel: async () => undefined,
			setPermissionMode: async () => undefined,
			supportedCommands: async () => [],
			supportedModels: async () => [],
		})) as unknown as CreateClaudeAgentAdapterOptions['queryFn'];
};

const INIT_MESSAGE = {
	model: 'claude-opus-5',
	session_id: 'sdk-session-1',
	subtype: 'init',
	type: 'system',
};

const EXIT_PLAN_MESSAGE = {
	message: {
		content: [
			{
				id: SUBMISSION.toolCallId,
				input: { plan: SUBMISSION.plan },
				name: 'ExitPlanMode',
				type: 'tool_use',
			},
		],
	},
	parent_tool_use_id: null,
	type: 'assistant',
};

const READ_MESSAGE = {
	message: {
		content: [
			{
				id: 'toolu_3',
				input: { path: 'a.ts' },
				name: 'Read',
				type: 'tool_use',
			},
		],
	},
	parent_tool_use_id: null,
	type: 'assistant',
};

/** Opens an adapter session over the replayed messages and drains its pump. */
const runAdapter = async (
	messages: readonly unknown[],
	token: string | null,
) => {
	const submitPlan = vi.fn(() =>
		Promise.resolve({ planPath: null, summary: 'saved' }),
	);
	const adapter = createClaudeAgentAdapter({
		onPlanSubmitted: createClaudePlanBridge({
			resolveOrigin: (candidate) => (candidate === TOKEN ? ORIGIN : null),
			submitPlan,
		}),
		queryFn: fakeQueryFn(messages),
		resolveBaseEnv: () => ({}),
	});

	await adapter.createSession({
		metadata: metadataFor('runtime-1'),
		request: {
			agentSessionId: 'agent-session-1',
			controlMcp: token ? { token, url: 'http://127.0.0.1:4321' } : null,
			provider: 'claude',
			workspaceCwd: '/tmp/ws-1',
		},
	});
	for (let tick = 0; tick < 10; tick += 1) {
		await Promise.resolve();
	}

	return { submitPlan };
};

describe('the Claude adapter reporting a native plan submission', () => {
	it('routes ExitPlanMode into the review path with the session token', async () => {
		const { submitPlan } = await runAdapter(
			[INIT_MESSAGE, EXIT_PLAN_MESSAGE],
			TOKEN,
		);

		expect(submitPlan).toHaveBeenCalledWith({
			args: { plan: SUBMISSION.plan, title: SUBMISSION.title },
			origin: ORIGIN,
		});
	});

	it('files one plan per call, not one per event the seal fans out', async () => {
		const { submitPlan } = await runAdapter(
			[INIT_MESSAGE, EXIT_PLAN_MESSAGE],
			TOKEN,
		);

		expect(submitPlan).toHaveBeenCalledTimes(1);
	});

	it('leaves an ordinary tool call alone', async () => {
		const { submitPlan } = await runAdapter(
			[INIT_MESSAGE, READ_MESSAGE],
			TOKEN,
		);

		expect(submitPlan).not.toHaveBeenCalled();
	});

	it('drops the plan when the session holds no control token', async () => {
		const { submitPlan } = await runAdapter(
			[INIT_MESSAGE, EXIT_PLAN_MESSAGE],
			null,
		);

		expect(submitPlan).not.toHaveBeenCalled();
	});
});
