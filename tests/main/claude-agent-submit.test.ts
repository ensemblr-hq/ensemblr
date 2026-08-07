import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import type {
	AgentAdapterSession,
	AgentEvent,
	AgentSessionMetadata,
} from '../../src/main/agent-runtime/index.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';

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
		interrupt: async () => undefined,
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
