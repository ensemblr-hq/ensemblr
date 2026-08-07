import type {
	Options,
	Query,
	SDKMessage,
	SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import type {
	AgentAdapterSession,
	AgentEvent,
	AgentSessionMetadata,
} from '../../src/main/agent-runtime/index.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';

const SESSION_ID = 'agent-session-preamble';
const WORKSPACE_CWD = '/tmp/ensemblr/preamble/ws';
const UPKEEP = 'ENSEMBLR SESSION UPKEEP — name the branch.';

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
		label: 'Preamble',
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
 * Opens a Claude session over a never-yielding query, keeping hold of the input
 * stream the SDK would read so a test can see what actually reached the model.
 */
async function openSession(
	resolveTurnPreamble: (() => Promise<string | null>) | null,
): Promise<{
	events: AgentEvent[];
	session: AgentAdapterSession;
	sdkPrompts: (count?: number) => Promise<string[]>;
}> {
	let stream: AsyncIterable<SDKUserMessage> | null = null;
	const adapter = createClaudeAgentAdapter({
		queryFn: ((input: { options: Options; prompt: unknown }) => {
			stream = input.prompt as AsyncIterable<SDKUserMessage>;
			return createPendingQuery();
		}) as never,
		resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
		turnIdFactory: () => 'turn-1',
	});
	const session = await adapter.createSession({
		metadata: createMetadata(),
		request: {
			agentSessionId: SESSION_ID,
			resolveTurnPreamble,
			workspaceCwd: WORKSPACE_CWD,
		},
	});
	const events: AgentEvent[] = [];
	session.subscribe((event) => events.push(event));
	return {
		events,
		session,
		sdkPrompts: async (count = 1) => {
			const collected: string[] = [];
			for await (const message of stream ?? []) {
				collected.push(String(message.message.content));
				if (collected.length >= count) {
					break;
				}
			}
			return collected;
		},
	};
}

/** The prompt payloads a session emitted, in order. */
function promptEvents(events: readonly AgentEvent[]): string[] {
	return events.flatMap((event) =>
		event.type === 'message' && event.payload.kind === 'prompt'
			? [event.payload.prompt]
			: [],
	);
}

describe('claude turn preamble', () => {
	it('prepends the upkeep block to the prompt the runtime receives', async () => {
		const { sdkPrompts, session } = await openSession(async () => UPKEEP);

		await session.submit({ prompt: 'hello' });

		expect(await sdkPrompts()).toEqual([`${UPKEEP}\n\nhello`]);
	});

	// The block is app bookkeeping, not something the user typed. Persisting it
	// onto the prompt event would replay it in the transcript every turn.
	it('keeps the block out of the prompt the app persists and renders', async () => {
		const { events, session } = await openSession(async () => UPKEEP);

		await session.submit({ prompt: 'hello' });

		expect(promptEvents(events)).toEqual(['hello']);
	});

	it('sends the prompt untouched when nothing is outstanding', async () => {
		const { sdkPrompts, session } = await openSession(async () => null);

		await session.submit({ prompt: 'hello' });

		expect(await sdkPrompts()).toEqual(['hello']);
	});

	it('sends the prompt untouched when the session has no resolver', async () => {
		const { sdkPrompts, session } = await openSession(null);

		await session.submit({ prompt: 'hello' });

		expect(await sdkPrompts()).toEqual(['hello']);
	});

	// Resolving the block yields, and a steer arriving mid-turn submits while the
	// first call is still parked on it. Whichever wins that race, the transcript
	// the app persists and the stream the runtime reads have to agree — a yield
	// between the two would let them disagree.
	it('records and queues overlapping submits in the same order', async () => {
		const gates: Array<() => void> = [];
		const { events, sdkPrompts, session } = await openSession(
			() =>
				new Promise<string | null>((resolve) => {
					gates.push(() => resolve(UPKEEP));
				}),
		);

		const first = session.submit({ prompt: 'first' });
		const second = session.submit({
			prompt: 'second',
			streamingBehavior: 'steer',
		});
		await Promise.resolve();
		for (const release of [...gates].reverse()) {
			release();
		}
		await Promise.all([first, second]);

		const queued = await sdkPrompts(2);
		expect(queued).toEqual(
			promptEvents(events).map((prompt) => `${UPKEEP}\n\n${prompt}`),
		);
		expect(queued).toHaveLength(2);
	});

	// The block is a reminder; losing one costs a turn's bookkeeping, while
	// letting the failure through costs the turn itself.
	it('sends the prompt untouched when resolving the block throws', async () => {
		const { sdkPrompts, session } = await openSession(async () => {
			throw new Error('control layer is down');
		});

		await session.submit({ prompt: 'hello' });

		expect(await sdkPrompts()).toEqual(['hello']);
	});
});
