import type { Options, Query } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import type { AgentSessionMetadata } from '../../src/main/agent-runtime/index.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const SESSION_ID = 'agent-session-thinking';
const WORKSPACE_CWD = '/tmp/ensemblr/thinking/ws';

/** One thinking steer the adapter pushed at the live query. */
interface ThinkingCall {
	budget?: number | null;
	display?: 'summarized' | 'omitted' | null;
	effortLevel?: unknown;
	kind: 'effort' | 'budget';
}

/** A query that never yields, recording the thinking steers it was handed. */
function createRecordingQuery(calls: ThinkingCall[]): Query {
	const iterator = (async function* (): AsyncGenerator<never, void> {
		await new Promise<void>(() => undefined);
	})();
	return Object.assign(iterator, {
		applyFlagSettings: async (settings: { effortLevel?: unknown }) => {
			calls.push({ effortLevel: settings.effortLevel, kind: 'effort' });
		},
		close: () => undefined,
		getContextUsage: async () => CONTEXT_USAGE,
		interrupt: async () => undefined,
		setMaxThinkingTokens: async (
			budget: number | null,
			display?: 'summarized' | 'omitted' | null,
		) => {
			calls.push({ budget, display, kind: 'budget' });
		},
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
		label: 'Thinking',
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

/** Opens a Claude session at one thinking level, capturing its SDK options. */
async function openAtThinkingLevel(thinkingLevel?: string): Promise<{
	calls: ThinkingCall[];
	options: Options;
	submit: (level: string) => Promise<void>;
}> {
	const calls: ThinkingCall[] = [];
	const captured: Options[] = [];
	const adapter = createClaudeAgentAdapter({
		queryFn: (({ options }: { options?: Options }) => {
			if (options) {
				captured.push(options);
			}
			return createRecordingQuery(calls);
		}) as never,
		resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
	});
	const session = await adapter.createSession({
		metadata: createMetadata(),
		request: {
			agentSessionId: SESSION_ID,
			workspaceCwd: WORKSPACE_CWD,
			...(thinkingLevel ? { thinkingLevel } : {}),
		},
	});
	const options = captured[0];
	if (!options) {
		throw new Error('The adapter opened no query.');
	}
	await new Promise((resolve) => setTimeout(resolve, 0));
	return {
		calls,
		options,
		submit: async (level: string) => {
			await session.submit({ prompt: 'go', thinkingLevel: level });
		},
	};
}

const ADAPTIVE_SUMMARIZED = { display: 'summarized', type: 'adaptive' };

describe('claude thinking display', () => {
	it('asks for summarized thinking so the reasoning survives the seal', async () => {
		const { calls, options } = await openAtThinkingLevel('high');

		expect(options.thinking).toEqual(ADAPTIVE_SUMMARIZED);
		expect(options.effort).toBe('high');
		expect(calls).toEqual([]);
	});

	it('opens able to think even when the level is off, so a turn can turn it back on', async () => {
		const { options } = await openAtThinkingLevel('off');

		expect(options.thinking).toEqual(ADAPTIVE_SUMMARIZED);
		expect(options.effort).toBeUndefined();
	});

	it('zeroes the budget on a session opened at off', async () => {
		const { calls } = await openAtThinkingLevel('off');

		expect(calls).toEqual([
			{ effortLevel: null, kind: 'effort' },
			{ budget: 0, display: undefined, kind: 'budget' },
		]);
	});

	it('zeroes the budget when no level was chosen', async () => {
		const { calls, options } = await openAtThinkingLevel();

		expect(options.thinking).toEqual(ADAPTIVE_SUMMARIZED);
		expect(calls).toEqual([
			{ effortLevel: null, kind: 'effort' },
			{ budget: 0, display: undefined, kind: 'budget' },
		]);
	});

	it('clears the budget and names the display again when a turn re-enables thinking', async () => {
		const { calls, submit } = await openAtThinkingLevel('off');

		await submit('high');

		expect(calls.slice(2)).toEqual([
			{ effortLevel: 'high', kind: 'effort' },
			{ budget: null, display: 'summarized', kind: 'budget' },
		]);
	});

	it('zeroes the budget when a turn turns thinking off', async () => {
		const { calls, submit } = await openAtThinkingLevel('high');

		await submit('off');

		expect(calls).toEqual([
			{ effortLevel: null, kind: 'effort' },
			{ budget: 0, display: undefined, kind: 'budget' },
		]);
	});

	it('keeps thinking on when a turn only changes how hard to think', async () => {
		const { calls, submit } = await openAtThinkingLevel('high');

		await submit('low');

		expect(calls).toEqual([
			{ effortLevel: 'low', kind: 'effort' },
			{ budget: null, display: 'summarized', kind: 'budget' },
		]);
	});
});
