import type {
	Options,
	Query,
	SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import type {
	AgentAdapterSession,
	AgentEvent,
	AgentSessionMetadata,
} from '../../src/main/agent-runtime/index.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const SESSION_ID = 'agent-session-submit';
const WORKSPACE_CWD = '/tmp/ensemblr/submit/ws';

/** A query that never yields, so a turn stays open for the whole test. */
function createPendingQuery(): Query {
	const iterator = (async function* (): AsyncGenerator<SDKMessage, void> {
		await new Promise<void>(() => undefined);
	})();
	return Object.assign(iterator, {
		applyFlagSettings: async () => undefined,
		close: () => undefined,
		getContextUsage: async () => CONTEXT_USAGE,
		interrupt: async () => undefined,
		setMaxThinkingTokens: async () => undefined,
		setModel: async () => undefined,
		setPermissionMode: async () => undefined,
	}) as unknown as Query;
}

/** Session metadata shaped the way the opener hands it to an adapter. */
function createMetadata(): AgentSessionMetadata {
	return {
		args: [],
		command: 'claude',
		cwd: WORKSPACE_CWD,
		env: {},
		id: SESSION_ID,
		label: 'Submit',
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

/** Opens a Claude session over a never-yielding query, collecting its events. */
async function openSession(
	queryFn: () => Query = createPendingQuery,
): Promise<{ events: AgentEvent[]; session: AgentAdapterSession }> {
	let turn = 0;
	const adapter = createClaudeAgentAdapter({
		queryFn: queryFn as never,
		resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
		turnIdFactory: () => {
			turn += 1;
			return `turn-${turn}`;
		},
	});
	const session = await adapter.createSession({
		metadata: createMetadata(),
		request: { agentSessionId: SESSION_ID, workspaceCwd: WORKSPACE_CWD },
	});
	const events: AgentEvent[] = [];
	session.subscribe((event) => events.push(event));
	return { events, session };
}

/** The prompt payloads a session emitted, in order. */
function promptEvents(
	events: readonly AgentEvent[],
): Array<{ prompt: string; turnId: string | null }> {
	return events.flatMap((event) =>
		event.type === 'message' && event.payload.kind === 'prompt'
			? [{ prompt: event.payload.prompt, turnId: event.turnId }]
			: [],
	);
}

describe('claude submit', () => {
	it('removes Git routing after merging base and session environments into query options', async () => {
		const queryOptions: Array<Options | undefined> = [];
		const adapter = createClaudeAgentAdapter({
			resolveBaseEnv: () => ({
				PATH: '/usr/bin',
				GIT_DIR: '/sibling/.git',
				GIT_WORK_TREE: '/sibling',
				GIT_SSH_COMMAND: 'ssh -i /identity',
			}),
			queryFn: ({ options }) => {
				queryOptions.push(options);
				return createPendingQuery();
			},
		});
		try {
			const session = await adapter.createSession({
				metadata: {
					...createMetadata(),
					env: {
						LANG: 'en_US.UTF-8',
						GIT_DIR: '/overlay/.git',
						GIT_INDEX_FILE: '/sibling/.git/index',
						GIT_CONFIG_COUNT: '1',
						GIT_CONFIG_KEY_0: 'core.worktree',
						GIT_CONFIG_VALUE_0: '/sibling',
					},
				},
				request: { agentSessionId: SESSION_ID, workspaceCwd: WORKSPACE_CWD },
			});
			await session.submit({ prompt: 'work here' });
			expect(queryOptions).toHaveLength(1);
			const options = queryOptions[0];
			expect(options?.cwd).toBe(WORKSPACE_CWD);
			expect(options?.env?.PATH).toBe('/usr/bin');
			expect(options?.env?.LANG).toBe('en_US.UTF-8');
			expect(options?.env?.GIT_SSH_COMMAND).toBe('ssh -i /identity');
			for (const key of [
				'GIT_DIR',
				'GIT_WORK_TREE',
				'GIT_INDEX_FILE',
				'GIT_CONFIG_COUNT',
				'GIT_CONFIG_KEY_0',
				'GIT_CONFIG_VALUE_0',
			]) {
				expect(options?.env?.[key], key).toBeUndefined();
			}
		} finally {
			await adapter.shutdown();
		}
	});

	it('renders one bubble per prompt, since the SDK echo is dropped', async () => {
		const { events, session } = await openSession();

		await session.submit({ prompt: 'hello' });

		expect(promptEvents(events)).toEqual([
			{ prompt: 'hello', turnId: 'turn-1' },
		]);
	});

	it('reports the session busy as soon as a prompt is accepted', async () => {
		const { events, session } = await openSession();

		await session.submit({ prompt: 'hello' });

		const statuses = events.flatMap((event) =>
			event.type === 'metadata' ? [event.metadata.status] : [],
		);
		expect(statuses).toContain('streaming');
	});

	it('keeps a steer on the turn already streaming', async () => {
		const { events, session } = await openSession();

		await session.submit({ prompt: 'first' });
		await session.submit({
			prompt: 'actually do X',
			streamingBehavior: 'steer',
		});

		expect(promptEvents(events)).toEqual([
			{ prompt: 'first', turnId: 'turn-1' },
			{ prompt: 'actually do X', turnId: 'turn-1' },
		]);
	});

	it('opens a new turn for a plain prompt', async () => {
		const { events, session } = await openSession();

		await session.submit({ prompt: 'first' });
		await session.submit({ prompt: 'second' });

		expect(promptEvents(events).map((entry) => entry.turnId)).toEqual([
			'turn-1',
			'turn-2',
		]);
	});

	it('refuses a prompt once the session is closed', async () => {
		const { session } = await openSession();

		await session.close();

		await expect(session.submit({ prompt: 'too late' })).rejects.toThrow(
			/closed/i,
		);
	});

	it('reports a start-up failure to a listener that subscribes afterwards', async () => {
		const adapter = createClaudeAgentAdapter({
			queryFn: (() => {
				throw new Error('spawn EACCES');
			}) as never,
			resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
		});
		const session = await adapter.createSession({
			metadata: createMetadata(),
			request: { agentSessionId: SESSION_ID, workspaceCwd: WORKSPACE_CWD },
		});

		const events: AgentEvent[] = [];
		await new Promise<void>((resolve) => queueMicrotask(resolve));
		session.subscribe((event) => events.push(event));

		expect(events.some((event) => event.type === 'error')).toBe(true);
		expect(events.some((event) => event.type === 'shutdown')).toBe(true);
	});
});
