/**
 * Where a Claude chat's plan gauge gets its figures. The pushed rate-limit
 * frames name one window at a time and may carry no utilization at all, so the
 * adapter asks the account outright — once when the session opens, and again
 * only after a sealing turn finds the last answer stale.
 */

import type {
	Query,
	SDKControlGetUsageResponse,
	SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import type {
	AgentEvent,
	AgentSessionMetadata,
} from '../../src/main/agent-runtime/index.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const SESSION_ID = 'agent-session-plan';
const WORKSPACE_CWD = '/tmp/ensemblr/plan/ws';
const OPENED_AT = new Date('2026-01-01T00:00:00.000Z');
const MINUTE_MS = 60_000;

/** What the account answers when it has a subscription behind it. */
const PLAN_RESPONSE = {
	rate_limits: {
		five_hour: { resets_at: '2026-01-01T05:00:00.000Z', utilization: 41 },
		model_scoped: [
			{
				display_name: 'Opus',
				resets_at: '2026-01-08T00:00:00.000Z',
				utilization: 8,
			},
		],
		seven_day: { resets_at: '2026-01-08T00:00:00.000Z', utilization: 17 },
	},
	rate_limits_available: true,
	subscription_type: 'max',
} as unknown as SDKControlGetUsageResponse;

/** Session metadata shaped the way the opener hands it to an adapter. */
function createMetadata(): AgentSessionMetadata {
	return {
		args: [],
		command: 'claude',
		cwd: WORKSPACE_CWD,
		env: {},
		id: SESSION_ID,
		label: 'Plan',
		model: null,
		piAgentDirectoryPreserved: true,
		provider: 'claude',
		sessionId: null,
		startedAt: OPENED_AT.toISOString(),
		status: 'starting',
		thinking: null,
		updatedAt: OPENED_AT.toISOString(),
	};
}

/** A turn that sealed with a cost, which is what invites a refresh. */
function sealedTurn(): SDKMessage {
	return {
		modelUsage: { 'claude-opus-5': { contextWindow: 200_000 } },
		subtype: 'success',
		total_cost_usd: 1.5,
		type: 'result',
	} as unknown as SDKMessage;
}

/** Lets the microtask and timer queues drain between the phases of a session. */
async function settle(): Promise<void> {
	for (let tick = 0; tick < 5; tick += 1) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

/**
 * A query that holds its messages back until the opener releases them, then
 * yields each and stays open, so the session outlives its turns the way a real
 * chat does. The gate is what makes a turn land strictly after the session has
 * finished opening — the opening read is in flight until then, and a turn
 * sealing into that window is asking a different question than these tests are.
 */
function createQuery({
	messages = [],
	readUsage,
	released,
}: {
	messages?: readonly SDKMessage[];
	readUsage: () => Promise<SDKControlGetUsageResponse>;
	released: Promise<void>;
}): () => Query {
	return () => {
		const iterator = (async function* (): AsyncGenerator<SDKMessage, void> {
			await released;
			for (const message of messages) {
				yield message;
			}
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
			usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: readUsage,
		}) as unknown as Query;
	};
}

/**
 * Opens a session, lets it finish opening, then releases its turns and collects
 * every event it emitted across both phases.
 */
async function openSession({
	messages,
	now = () => OPENED_AT,
	readUsage,
}: {
	messages?: readonly SDKMessage[];
	now?: () => Date;
	readUsage: () => Promise<SDKControlGetUsageResponse>;
}): Promise<AgentEvent[]> {
	let release: () => void = () => undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	const adapter = createClaudeAgentAdapter({
		now,
		queryFn: createQuery({ messages, readUsage, released }) as never,
		resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
	});
	const events: AgentEvent[] = [];
	const session = await adapter.createSession({
		metadata: createMetadata(),
		request: { agentSessionId: SESSION_ID, workspaceCwd: WORKSPACE_CWD },
	});
	session.subscribe((event) => events.push(event));
	await settle();
	release();
	await settle();
	return events;
}

/** The windows each plan-windows event reported, in order. */
function reportedWindows(events: readonly AgentEvent[]) {
	return events.flatMap((event) =>
		event.type === 'plan-windows' ? [event.windows] : [],
	);
}

describe('the plan a Claude session opens against', () => {
	it('is read in full rather than waited for one pushed window at a time', async () => {
		const events = await openSession({
			readUsage: async () => PLAN_RESPONSE,
		});

		expect(reportedWindows(events)).toEqual([
			[
				{
					displayName: null,
					id: 'five_hour',
					resetsAt: '2026-01-01T05:00:00.000Z',
					utilization: 41,
				},
				{
					displayName: null,
					id: 'seven_day',
					resetsAt: '2026-01-08T00:00:00.000Z',
					utilization: 17,
				},
				{
					displayName: 'Opus',
					id: 'Opus',
					resetsAt: '2026-01-08T00:00:00.000Z',
					utilization: 8,
				},
			],
		]);
	});

	it('reports nothing when the runtime will not answer', async () => {
		const events = await openSession({
			readUsage: async () => {
				throw new Error('control request failed');
			},
		});

		expect(reportedWindows(events)).toEqual([]);
	});

	it('reports nothing for an account with no plan behind it', async () => {
		const events = await openSession({
			readUsage: async () =>
				({
					rate_limits: null,
					rate_limits_available: false,
					subscription_type: null,
				}) as unknown as SDKControlGetUsageResponse,
		});

		expect(reportedWindows(events)).toEqual([]);
	});
});

describe('refreshing a Claude session’s plan reading', () => {
	it('leaves a fresh reading alone when a turn seals', async () => {
		let reads = 0;
		await openSession({
			messages: [sealedTurn()],
			readUsage: async () => {
				reads += 1;
				return PLAN_RESPONSE;
			},
		});

		expect(reads).toBe(1);
	});

	it('asks again on the next sealing turn when the opening read failed', async () => {
		let reads = 0;
		const events = await openSession({
			messages: [sealedTurn()],
			readUsage: async () => {
				reads += 1;
				if (reads === 1) {
					throw new Error('control request failed');
				}
				return PLAN_RESPONSE;
			},
		});

		expect(reads).toBe(2);
		expect(reportedWindows(events)).toHaveLength(1);
	});

	it('leaves an account with no plan alone until its answer goes stale', async () => {
		let reads = 0;
		await openSession({
			messages: [sealedTurn()],
			readUsage: async () => {
				reads += 1;
				return {
					rate_limits: null,
					rate_limits_available: false,
					subscription_type: null,
				} as unknown as SDKControlGetUsageResponse;
			},
		});

		expect(reads).toBe(1);
	});

	it('re-reads once the last answer has gone stale', async () => {
		let reads = 0;
		let elapsedMs = 0;
		const events = await openSession({
			messages: [sealedTurn()],
			now: () => new Date(OPENED_AT.getTime() + elapsedMs),
			readUsage: async () => {
				reads += 1;
				elapsedMs += 6 * MINUTE_MS;
				return PLAN_RESPONSE;
			},
		});

		expect(reads).toBe(2);
		expect(reportedWindows(events)).toHaveLength(2);
	});
});
