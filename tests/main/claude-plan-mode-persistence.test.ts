import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';

import type {
	AgentAdapterSession,
	AgentSessionMetadata,
} from '../../src/main/agent-runtime/index.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import { resolvePermissionSettings } from '../../src/main/claude-agent/claude-permission-bridge.ts';
import type { PermissionMode } from '../../src/shared/permissions.ts';

const SESSION_ID = 'agent-session-plan-persistence';
const WORKSPACE_CWD = '/tmp/ensemblr/plan-persistence/ws';
const PLAN = '# A plan\n\nDo the thing.';
const MUTATING_TOOLS = [
	'Bash',
	'BashOutput',
	'Edit',
	'KillShell',
	'NotebookEdit',
	'Write',
];

const EXIT_PLAN_MESSAGE = {
	message: {
		content: [
			{
				id: 'toolu_plan',
				input: { plan: PLAN },
				name: 'ExitPlanMode',
				type: 'tool_use',
			},
		],
	},
	parent_tool_use_id: null,
	type: 'assistant',
} as unknown as SDKMessage;

/** Session metadata shaped the way the opener hands it to an adapter. */
function createMetadata(): AgentSessionMetadata {
	return {
		args: [],
		command: 'claude',
		cwd: WORKSPACE_CWD,
		env: {},
		id: SESSION_ID,
		label: 'Plan persistence',
		model: null,
		piAgentDirectoryPreserved: true,
		provider: 'claude',
		sessionId: null,
		startedAt: '2026-01-01T00:00:00.000Z',
		status: 'starting',
		thinking: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
	};
}

/**
 * A query that replays the given messages and then parks, so the session stays
 * open for the assertions. Every mode change it is asked to make is recorded.
 */
function createReplayQuery(messages: readonly SDKMessage[]): {
	permissionModes: string[];
	query: Query;
	setPermissionMode: ReturnType<typeof vi.fn>;
} {
	const permissionModes: string[] = [];
	const setPermissionMode = vi.fn(async (mode: string) => {
		permissionModes.push(mode);
	});
	const iterator = (async function* (): AsyncGenerator<SDKMessage, void> {
		for (const message of messages) {
			yield message;
		}
		await new Promise<void>(() => undefined);
	})();
	const query = Object.assign(iterator, {
		applyFlagSettings: async () => undefined,
		close: () => undefined,
		interrupt: async () => undefined,
		setModel: async () => undefined,
		setPermissionMode,
	}) as unknown as Query;
	return { permissionModes, query, setPermissionMode };
}

/** Opens a Claude session over a replay query, with the plan hook wired. */
async function openSession({
	messages = [],
	mode = 'workspace-trusted',
	planMode,
	withPlanHook = true,
}: {
	messages?: readonly SDKMessage[];
	mode?: PermissionMode;
	planMode?: boolean;
	withPlanHook?: boolean;
}): Promise<{
	permissionModes: string[];
	planSubmissions: number;
	session: AgentAdapterSession;
	setPermissionMode: ReturnType<typeof vi.fn>;
}> {
	const replay = createReplayQuery(messages);
	let planSubmissions = 0;
	const adapter = createClaudeAgentAdapter({
		...(withPlanHook
			? {
					onPlanSubmitted: () => {
						planSubmissions += 1;
					},
				}
			: {}),
		queryFn: (() => replay.query) as never,
		resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
	});
	const session = await adapter.createSession({
		metadata: createMetadata(),
		request: {
			agentSessionId: SESSION_ID,
			permissionMode: mode,
			workspaceCwd: WORKSPACE_CWD,
			...(planMode === undefined ? {} : { planMode }),
		},
	});
	session.subscribe(() => undefined);
	await Promise.resolve();
	await Promise.resolve();
	return {
		permissionModes: replay.permissionModes,
		get planSubmissions() {
			return planSubmissions;
		},
		session,
		setPermissionMode: replay.setPermissionMode,
	};
}

describe('resolvePermissionSettings falls back to the workspace mode, not a fixed default', () => {
	it('returns each mode s own baseline when the toggle is off', () => {
		expect(
			resolvePermissionSettings({ mode: 'workspace-trusted', planMode: false }),
		).toEqual({
			allowDangerouslySkipPermissions: true,
			permissionMode: 'bypassPermissions',
		});
		expect(
			resolvePermissionSettings({ mode: 'read-only', planMode: false }),
		).toEqual({
			disallowedTools: MUTATING_TOOLS,
			permissionMode: 'plan',
		});
		expect(
			resolvePermissionSettings({
				mode: 'approval-required',
				planMode: false,
			}),
		).toEqual({ permissionMode: 'default' });
	});

	it('plans under every workspace mode when the toggle is on', () => {
		for (const mode of [
			'workspace-trusted',
			'read-only',
			'approval-required',
		] as const) {
			expect(
				resolvePermissionSettings({ mode, planMode: true }).permissionMode,
			).toBe('plan');
		}
	});

	it('keeps read-only s deny list while it plans, so the gate survives', () => {
		expect(
			resolvePermissionSettings({ mode: 'read-only', planMode: true }),
		).toEqual({ disallowedTools: MUTATING_TOOLS, permissionMode: 'plan' });
	});
});

describe('Plan Mode survives Claude s own ExitPlanMode', () => {
	it('re-asserts plan mode on the turn after a plan was submitted', async () => {
		const { permissionModes, session } = await openSession({
			messages: [EXIT_PLAN_MESSAGE],
			planMode: true,
		});

		await session.submit({ planMode: true, prompt: 'refine it' });

		expect(permissionModes).toEqual(['plan']);
	});

	it('sees the plan submission it is reacting to', async () => {
		const opened = await openSession({
			messages: [EXIT_PLAN_MESSAGE],
			planMode: true,
		});

		expect(opened.planSubmissions).toBe(1);
	});

	it('returns a trusted workspace to bypass when the user approves', async () => {
		const { permissionModes, session } = await openSession({
			messages: [EXIT_PLAN_MESSAGE],
			mode: 'workspace-trusted',
			planMode: true,
		});

		await session.submit({ planMode: false, prompt: 'implement it' });

		expect(permissionModes).toEqual(['bypassPermissions']);
	});

	it('returns a read-only workspace to its own gate, never to default', async () => {
		const { permissionModes, session } = await openSession({
			messages: [EXIT_PLAN_MESSAGE],
			mode: 'read-only',
			planMode: true,
		});

		await session.submit({ planMode: false, prompt: 'implement it' });

		expect(permissionModes).toEqual(['plan']);
	});

	it('leaves an unchanged mode alone, so an ordinary turn costs nothing', async () => {
		const { setPermissionMode, session } = await openSession({
			planMode: false,
		});

		await session.submit({ planMode: false, prompt: 'hello' });
		await session.submit({ planMode: false, prompt: 'again' });

		expect(setPermissionMode).not.toHaveBeenCalled();
	});

	it('says nothing when the caller states no opinion', async () => {
		const { setPermissionMode, session } = await openSession({
			planMode: true,
		});

		await session.submit({ prompt: 'hello' });

		expect(setPermissionMode).not.toHaveBeenCalled();
	});

	it('skips the switch for a mid-turn steer, which is already committed', async () => {
		const { setPermissionMode, session } = await openSession({
			messages: [EXIT_PLAN_MESSAGE],
			planMode: true,
		});

		await session.submit({
			planMode: true,
			prompt: 'actually',
			streamingBehavior: 'steer',
		});

		expect(setPermissionMode).not.toHaveBeenCalled();
	});

	// Forgetting the applied mode is this session's own bookkeeping, so it cannot
	// depend on anyone having subscribed to the submission.
	it('forgets the applied mode even with no plan hook wired', async () => {
		const { permissionModes, session } = await openSession({
			messages: [EXIT_PLAN_MESSAGE],
			planMode: true,
			withPlanHook: false,
		});

		await session.submit({ planMode: true, prompt: 'refine it' });

		expect(permissionModes).toEqual(['plan']);
	});

	it('re-asserts once per plan, not once per turn after it', async () => {
		const { permissionModes, session } = await openSession({
			messages: [EXIT_PLAN_MESSAGE],
			planMode: true,
		});

		await session.submit({ planMode: true, prompt: 'refine it' });
		await session.submit({ planMode: true, prompt: 'refine it again' });

		expect(permissionModes).toEqual(['plan']);
	});
});
