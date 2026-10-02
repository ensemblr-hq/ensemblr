import type {
	McpServerStatus,
	Options,
	Query,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { createClaudeMcpRoster } from '../../src/main/claude-agent/claude-mcp-roster.ts';

const EXECUTABLE = '/opt/homebrew/bin/claude';

/** Builds a roster reader over a scripted sequence of `mcpServerStatus()` reads. */
function createRoster(
	reads: readonly (readonly McpServerStatus[])[],
	settleTimeoutMs = 8000,
): {
	capturedOptions: Options[];
	list: (cwd: string) => Promise<{
		error: string | null;
		servers: readonly { name: string; status: string }[];
	}>;
	reads: () => number;
	sleeps: number[];
} {
	const capturedOptions: Options[] = [];
	const sleeps: number[] = [];
	let index = 0;
	let closed = false;

	const list = createClaudeMcpRoster({
		queryFn: ({ options }) => {
			if (options) {
				capturedOptions.push(options);
			}
			return {
				close: () => {
					closed = true;
				},
				mcpServerStatus: async () => {
					const next = reads[Math.min(index, reads.length - 1)] ?? [];
					index += 1;
					return [...next];
				},
			} as unknown as Query;
		},
		resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
		resolveExecutablePath: () => EXECUTABLE,
		settleTimeoutMs,
		sleep: async (ms) => {
			sleeps.push(ms);
		},
	});

	return {
		capturedOptions,
		list: async (cwd) => {
			const result = await list(cwd);
			expect(closed).toBe(true);
			return result;
		},
		reads: () => index,
		sleeps,
	};
}

/** One SDK roster row with only the fields the projection reads. */
function server(
	name: string,
	status: McpServerStatus['status'],
	extra: Partial<McpServerStatus> = {},
): McpServerStatus {
	return { name, status, ...extra } as McpServerStatus;
}

describe('the Claude MCP roster is read against the workspace', () => {
	it('points the session at the workspace so project-scope servers resolve', async () => {
		const roster = createRoster([[server('shadcn', 'connected')]]);

		await roster.list('/workspaces/demo');

		expect(roster.capturedOptions[0]?.cwd).toBe('/workspaces/demo');
		expect(roster.capturedOptions[0]?.pathToClaudeCodeExecutable).toBe(
			EXECUTABLE,
		);
		expect(roster.capturedOptions[0]?.permissionMode).toBe('plan');
	});

	it('carries the error the runtime reported', async () => {
		const roster = createRoster([
			[
				server('linear', 'needs-auth', { scope: 'claudeai' }),
				server('fallow', 'failed', {
					error: 'connection refused',
					scope: 'project',
				}),
			],
		]);

		const result = await roster.list('/workspaces/demo');

		expect(result).toEqual({
			error: null,
			servers: [
				{
					error: null,
					name: 'linear',
					status: 'needs-auth',
				},
				{
					error: 'connection refused',
					name: 'fallow',
					status: 'failed',
				},
			],
		});
	});

	it('re-reads while servers are still connecting', async () => {
		const roster = createRoster([
			[server('a', 'pending'), server('b', 'pending')],
			[server('a', 'connected'), server('b', 'pending')],
			[server('a', 'connected'), server('b', 'connected')],
		]);

		const result = await roster.list('/workspaces/demo');

		expect(roster.reads()).toBe(3);
		expect(result.servers.map((entry) => entry.status)).toEqual([
			'connected',
			'connected',
		]);
	});

	it('gives up at the settle deadline rather than waiting on a wedged server', async () => {
		const roster = createRoster([[server('wedged', 'pending')]], 0);

		const result = await roster.list('/workspaces/demo');

		expect(roster.reads()).toBe(1);
		expect(roster.sleeps).toEqual([]);
		expect(result.servers[0]?.status).toBe('pending');
	});
});

describe('the Claude MCP roster reports why it is empty', () => {
	it('never spawns when no binary resolves', async () => {
		const capturedOptions: Options[] = [];
		const list = createClaudeMcpRoster({
			queryFn: ({ options }) => {
				if (options) {
					capturedOptions.push(options);
				}
				return {} as unknown as Query;
			},
			resolveExecutablePath: () => null,
		});

		const result = await list('/workspaces/demo');

		expect(capturedOptions).toEqual([]);
		expect(result.servers).toEqual([]);
		expect(result.error).toMatch(/executable/i);
	});

	it('surfaces a runtime failure instead of an empty roster', async () => {
		const list = createClaudeMcpRoster({
			queryFn: () =>
				({
					close: () => undefined,
					mcpServerStatus: async () => {
						throw new Error('ProcessTransport is not ready for writing');
					},
				}) as unknown as Query,
			resolveBaseEnv: () => ({}),
			resolveExecutablePath: () => EXECUTABLE,
		});

		const result = await list('/workspaces/demo');

		expect(result).toEqual({
			error: 'ProcessTransport is not ready for writing',
			servers: [],
		});
	});
});
