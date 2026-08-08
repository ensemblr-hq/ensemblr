import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import type {
	AgentEvent,
	AgentSessionMetadata,
} from '../../src/main/agent-runtime/index.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const SESSION_ID = 'agent-session-context';
const WORKSPACE_CWD = '/tmp/ensemblr/context/ws';

/** Session metadata shaped the way the opener hands it to an adapter. */
function createMetadata(): AgentSessionMetadata {
	return {
		args: [],
		command: 'claude',
		cwd: WORKSPACE_CWD,
		env: {},
		id: SESSION_ID,
		label: 'Context',
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
 * A query that never yields, so the session stays open with no turn ever having
 * produced a `result` — the state a chat is in for the whole of its first turn.
 */
function createQuery(getContextUsage: () => Promise<unknown>): () => Query {
	return () => {
		const iterator = (async function* (): AsyncGenerator<SDKMessage, void> {
			await new Promise<void>(() => undefined);
		})();
		return Object.assign(iterator, {
			applyFlagSettings: async () => undefined,
			close: () => undefined,
			getContextUsage,
			interrupt: async () => undefined,
			setModel: async () => undefined,
			setPermissionMode: async () => undefined,
		}) as unknown as Query;
	};
}

/** Opens a session over the given query and collects the events it emits. */
async function openSession(queryFn: () => Query): Promise<AgentEvent[]> {
	const adapter = createClaudeAgentAdapter({
		queryFn: queryFn as never,
		resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
	});
	const events: AgentEvent[] = [];
	const session = await adapter.createSession({
		metadata: createMetadata(),
		request: { agentSessionId: SESSION_ID, workspaceCwd: WORKSPACE_CWD },
	});
	session.subscribe((event) => events.push(event));
	await new Promise((resolve) => setImmediate(resolve));
	return events;
}

describe('the context window a Claude session opens with', () => {
	it('is read from the runtime before any turn has produced a result', async () => {
		const events = await openSession(createQuery(async () => CONTEXT_USAGE));

		expect(
			events.flatMap((event) =>
				event.type === 'context-usage' ? [event.usage] : [],
			),
		).toEqual([
			{
				contextWindow: 1_000_000,
				percent: (23_000 / 1_000_000) * 100,
				tokens: 23_000,
			},
		]);
	});

	it('leaves the gauge unreported when the runtime cannot answer', async () => {
		const events = await openSession(
			createQuery(async () => {
				throw new Error('control request failed');
			}),
		);

		expect(events.filter((event) => event.type === 'context-usage')).toEqual(
			[],
		);
	});
});
