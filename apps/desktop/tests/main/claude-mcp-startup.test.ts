import type {
	McpServerStatus,
	Options,
	Query,
	SDKMessage,
	SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';

import type { AgentSessionMetadata } from '../../src/main/agent-runtime/index.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import {
	waitForControlServer,
	withoutMcpStartupWait,
} from '../../src/main/claude-agent/claude-mcp-startup.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const SESSION_ID = 'agent-session-mcp-startup';
const WORKSPACE_CWD = '/tmp/ensemblr/mcp-startup/ws';
const STARTUP_WAIT_KEY = 'CLAUDE_CODE_MCP_STARTUP_WAIT_MS';
const CONTROL_MCP = { token: 'control-token', url: 'http://127.0.0.1:4100' };

type Status = McpServerStatus['status'];

/** Session metadata shaped the way the opener hands it to an adapter. */
function createMetadata(): AgentSessionMetadata {
	return {
		args: [],
		command: 'claude',
		cwd: WORKSPACE_CWD,
		env: {},
		id: SESSION_ID,
		label: 'MCP startup',
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

/** A status reader answering with the control server at each status in turn, the last one repeating. */
function statusSequence(statuses: readonly Status[]): {
	mcpServerStatus: () => Promise<McpServerStatus[]>;
	reads: () => number;
} {
	let reads = 0;
	return {
		mcpServerStatus: async () => {
			const status = statuses[Math.min(reads, statuses.length - 1)];
			reads += 1;
			return status ? [{ name: 'ensemblr', status }] : [];
		},
		reads: () => reads,
	};
}

/** A query that never yields, reading MCP state from the given reader. */
function createPendingQuery(
	mcpServerStatus: () => Promise<McpServerStatus[]>,
): Query {
	const iterator = (async function* (): AsyncGenerator<SDKMessage, void> {
		await new Promise<void>(() => undefined);
	})();
	return Object.assign(iterator, {
		applyFlagSettings: async () => undefined,
		close: () => undefined,
		getContextUsage: async () => CONTEXT_USAGE,
		interrupt: async () => undefined,
		mcpServerStatus,
		setMaxThinkingTokens: async () => undefined,
		setModel: async () => undefined,
		setPermissionMode: async () => undefined,
	}) as unknown as Query;
}

/** Opens a session and returns the options the SDK was handed. */
async function openedOptions(
	request: { controlMcp?: typeof CONTROL_MCP },
	baseEnv: NodeJS.ProcessEnv = { PATH: '/usr/bin' },
): Promise<Options | undefined> {
	const captured: Array<Options | undefined> = [];
	const adapter = createClaudeAgentAdapter({
		queryFn: (({ options }: { options?: Options }) => {
			captured.push(options);
			return createPendingQuery(async () => []);
		}) as never,
		resolveBaseEnv: () => baseEnv,
	});
	try {
		await adapter.createSession({
			metadata: createMetadata(),
			request: {
				agentSessionId: SESSION_ID,
				workspaceCwd: WORKSPACE_CWD,
				...request,
			},
		});
		return captured[0];
	} finally {
		await adapter.shutdown();
	}
}

describe('withoutMcpStartupWait', () => {
	it('switches the first-turn MCP wait off without touching the input', () => {
		const env = { PATH: '/usr/bin' };

		expect(withoutMcpStartupWait(env)).toEqual({
			PATH: '/usr/bin',
			[STARTUP_WAIT_KEY]: '0',
		});
		expect(env).toEqual({ PATH: '/usr/bin' });
	});

	it('keeps a wait the user already chose', () => {
		const env = { [STARTUP_WAIT_KEY]: '4000' };

		expect(withoutMcpStartupWait(env)).toBe(env);
	});
});

describe('waitForControlServer', () => {
	it('settles once the control server stops connecting', async () => {
		const reader = statusSequence(['pending', 'pending', 'connected']);

		const status = await waitForControlServer(reader, {
			isClosed: () => false,
			sleep: async () => undefined,
		});

		expect(status).toBe('connected');
		expect(reader.reads()).toBe(3);
	});

	it('settles on a server that failed rather than waiting for it', async () => {
		const reader = statusSequence(['failed']);

		await expect(
			waitForControlServer(reader, { isClosed: () => false }),
		).resolves.toBe('failed');
		expect(reader.reads()).toBe(1);
	});

	it('does not wait for a server the runtime does not report', async () => {
		await expect(
			waitForControlServer(statusSequence([]), { isClosed: () => false }),
		).resolves.toBeNull();
	});

	it('does not wait on a runtime that refuses the read', async () => {
		const reader = {
			mcpServerStatus: async (): Promise<McpServerStatus[]> => {
				throw new Error('control request failed');
			},
		};

		await expect(
			waitForControlServer(reader, { isClosed: () => false }),
		).resolves.toBeNull();
	});

	it('gives up at the deadline on a server that never connects', async () => {
		const status = await waitForControlServer(statusSequence(['pending']), {
			isClosed: () => false,
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms / 10)),
			timeoutMs: 30,
		});

		expect(status).toBe('pending');
	});

	it('gives up at the deadline on a runtime that never answers', async () => {
		const reader = {
			mcpServerStatus: () => new Promise<McpServerStatus[]>(() => undefined),
		};

		await expect(
			waitForControlServer(reader, { isClosed: () => false, timeoutMs: 20 }),
		).resolves.toBe('pending');
	});

	it('stops waiting once the session closes', async () => {
		const reader = statusSequence(['pending']);

		await expect(
			waitForControlServer(reader, { isClosed: () => true }),
		).resolves.toBeNull();
		expect(reader.reads()).toBe(0);
	});
});

describe('a Claude session handed the control server', () => {
	it('lifts the CLI first-turn wait on the user MCP servers', async () => {
		const options = await openedOptions({ controlMcp: CONTROL_MCP });

		expect(options?.mcpServers).toHaveProperty('ensemblr');
		expect(options?.env?.[STARTUP_WAIT_KEY]).toBe('0');
	});

	it('keeps the startup wait the user set in their environment', async () => {
		const options = await openedOptions(
			{ controlMcp: CONTROL_MCP },
			{ PATH: '/usr/bin', [STARTUP_WAIT_KEY]: '2500' },
		);

		expect(options?.env?.[STARTUP_WAIT_KEY]).toBe('2500');
	});

	it('leaves the CLI defaults alone when it passes no MCP config', async () => {
		const options = await openedOptions({});

		expect(options?.mcpServers).toBeUndefined();
		expect(options?.env?.[STARTUP_WAIT_KEY]).toBeUndefined();
	});

	it('holds the first prompt until the control server has connected', async () => {
		const reader = statusSequence(['pending', 'pending', 'connected']);
		const readsWhenPromptArrived: number[] = [];
		const adapter = createClaudeAgentAdapter({
			queryFn: (({ prompt }: { prompt: AsyncIterable<SDKUserMessage> }) => {
				void (async () => {
					for await (const _message of prompt) {
						readsWhenPromptArrived.push(reader.reads());
					}
				})();
				return createPendingQuery(reader.mcpServerStatus);
			}) as never,
			resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
		});
		try {
			const session = await adapter.createSession({
				metadata: createMetadata(),
				request: {
					agentSessionId: SESSION_ID,
					controlMcp: CONTROL_MCP,
					workspaceCwd: WORKSPACE_CWD,
				},
			});

			await session.submit({ prompt: 'hello' });

			await vi.waitFor(() => expect(readsWhenPromptArrived).toEqual([3]));
		} finally {
			await adapter.shutdown();
		}
	});
});
