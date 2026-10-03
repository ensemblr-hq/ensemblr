import type {
	HookJSONOutput,
	Options,
	Query,
	SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withAfkHooks } from '../../src/main/claude-agent/claude-afk-mode.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import { withComputeQueueHooks } from '../../src/main/claude-agent/claude-compute-queue-guard.ts';
import { withPlanModeHooks } from '../../src/main/claude-agent/claude-plan-mode-guard.ts';
import type { ComputeQueueSettings } from '../../src/shared/config.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const SETTINGS: ComputeQueueSettings = {
	concurrency: 1,
	enabled: true,
	exemptPatterns: [],
	extraPatterns: [],
	niceness: 10,
};

/**
 * Narrows the SDK's hook-output union to the synchronous shape this hook always
 * returns, so a test can read the verdict off it.
 * @param output - Whatever the hook resolved with.
 * @returns The `PreToolUse` decision, or null when the hook rendered none.
 */
const verdictOf = (output: HookJSONOutput) => {
	const specific =
		'hookSpecificOutput' in output ? output.hookSpecificOutput : undefined;
	return specific?.hookEventName === 'PreToolUse' ? specific : null;
};

/**
 * Runs the compute-queue `PreToolUse` hook against one tool call.
 * @param readSettings - Reads the live settings, as the adapter's reader does.
 * @param toolName - The tool Claude asked to run.
 * @param toolInput - The tool call's raw input.
 * @returns The hook's output.
 */
const run = async (
	readSettings: () => ComputeQueueSettings,
	toolName: string,
	toolInput: Record<string, unknown> = {},
	isPlanning: () => boolean = () => false,
) => {
	const hooks = withComputeQueueHooks(undefined, readSettings, isPlanning);
	const hook = hooks.PreToolUse?.[0]?.hooks[0];
	if (!hook) {
		throw new Error('No PreToolUse hook registered.');
	}
	return await hook(
		{
			hook_event_name: 'PreToolUse',
			tool_input: toolInput,
			tool_name: toolName,
		} as never,
		undefined,
		{ signal: new AbortController().signal },
	);
};

describe('compute-queue Claude hook', () => {
	it('denies a heavy Bash command and points at the namespaced queue tools', async () => {
		const verdict = verdictOf(
			await run(() => SETTINGS, 'Bash', {
				command: 'cd apps/desktop && bun run test',
			}),
		);
		expect(verdict?.permissionDecision).toBe('deny');
		const reason = String(verdict?.permissionDecisionReason);
		expect(reason).toContain('`run test*`');
		expect(reason).toContain('`mcp__ensemblr__ensemblr_run_queued`');
		expect(reason).toContain('`mcp__ensemblr__ensemblr_wait_for_job`');
		expect(reason).toContain('{"command":"cd apps/desktop && bun run test"}');
	});

	it('denies a heavy command run in the background too', async () => {
		const verdict = verdictOf(
			await run(() => SETTINGS, 'Bash', {
				command: 'cargo build --release',
				run_in_background: true,
			}),
		);
		expect(verdict?.permissionDecision).toBe('deny');
	});

	it('denies a heavy command a Monitor would run in its shell', async () => {
		const verdict = verdictOf(
			await run(() => SETTINGS, 'Monitor', {
				command: 'bunx vitest --watch',
				description: 'watch tests',
				timeout_ms: 60_000,
			}),
		);
		expect(verdict?.permissionDecision).toBe('deny');
		expect(String(verdict?.permissionDecisionReason)).toContain('`vitest`');
	});

	it('passes a Monitor that opens a socket rather than a command', async () => {
		expect(
			await run(() => SETTINGS, 'Monitor', {
				description: 'events',
				timeout_ms: 60_000,
				ws: { url: 'ws://127.0.0.1:1' },
			}),
		).toEqual({});
	});

	it('leaves a heavy Bash command to Plan Mode while the session plans', async () => {
		expect(
			await run(
				() => SETTINGS,
				'Bash',
				{ command: 'bun run test' },
				() => true,
			),
		).toEqual({});
	});

	it('still refuses a heavy Monitor while planning, which Plan Mode passes', async () => {
		const verdict = verdictOf(
			await run(
				() => SETTINGS,
				'Monitor',
				{ command: 'make', description: 'm', timeout_ms: 1_000 },
				() => true,
			),
		);
		expect(verdict?.permissionDecision).toBe('deny');
		const reason = String(verdict?.permissionDecisionReason);
		expect(reason).toContain('until the plan is approved');
		expect(reason).not.toContain('ensemblr_run_queued');
		expect(reason).not.toContain('ensemblr_wait_for_job');
	});

	it('passes the call, and logs, when the classifier itself throws', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const exploding = {
			...SETTINGS,
			get extraPatterns(): string[] {
				throw new Error('boom');
			},
		};
		try {
			expect(
				await run(() => exploding, 'Bash', { command: 'bun run test' }),
			).toEqual({});
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('compute-queue classification failed'),
				expect.objectContaining({ commandLength: 12 }),
			);
		} finally {
			warn.mockRestore();
		}
	});

	it('passes a light Bash command with no decision at all', async () => {
		expect(
			await run(() => SETTINGS, 'Bash', { command: 'git status' }),
		).toEqual({});
	});

	it('passes every tool other than Bash and Monitor', async () => {
		expect(
			await run(() => SETTINGS, 'Write', {
				command: 'bun run test',
				file_path: '/tmp/x',
			}),
		).toEqual({});
		expect(
			await run(() => SETTINGS, 'mcp__ensemblr__ensemblr_run_queued', {
				command: 'bun run test',
			}),
		).toEqual({});
	});

	it('passes a Bash call with no command string', async () => {
		expect(await run(() => SETTINGS, 'Bash', {})).toEqual({});
	});

	it('reads the settings live at every call', async () => {
		let settings = SETTINGS;
		const read = () => settings;
		expect(
			verdictOf(await run(read, 'Bash', { command: 'make' }))
				?.permissionDecision,
		).toBe('deny');
		settings = { ...SETTINGS, enabled: false };
		expect(await run(read, 'Bash', { command: 'make' })).toEqual({});
		settings = { ...SETTINGS, exemptPatterns: ['make'] };
		expect(await run(read, 'Bash', { command: 'make' })).toEqual({});
	});

	it('ignores events other than PreToolUse', async () => {
		const hook = withComputeQueueHooks(undefined, () => SETTINGS)
			.PreToolUse?.[0]?.hooks[0];
		expect(
			await hook?.(
				{ hook_event_name: 'PostToolUse', tool_name: 'Bash' } as never,
				undefined,
				{ signal: new AbortController().signal },
			),
		).toEqual({});
	});

	it('composes after the session’s other hooks instead of replacing them', () => {
		const hooks = withAfkHooks(
			withComputeQueueHooks(
				withPlanModeHooks(undefined, () => false),
				() => SETTINGS,
			),
			() => false,
		);
		expect(hooks.PreToolUse?.length).toBe(3);
	});
});

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	while (cleanups.length > 0) {
		await cleanups.pop()?.();
	}
});

/** A query that never completes, so the adapter keeps the session open. */
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

/**
 * Opens one Claude session through the real adapter and hands back the SDK
 * options it installed.
 * @param input - Whether the session has the control server, plans, or is the Concierge.
 * @returns The installed options.
 */
async function openSession(input: {
	controlMcp: boolean;
	planMode?: boolean;
	concierge?: boolean;
}): Promise<Options> {
	let installed: Options | undefined;
	const adapter = createClaudeAgentAdapter({
		queryFn: ({ options }) => {
			if (options) {
				installed = options;
			}
			return createPendingQuery();
		},
		readComputeQueueSettings: () => SETTINGS,
		resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
		resolveConciergeHome: () => (input.concierge ? '/root/concierge' : null),
	});
	await adapter.createSession({
		metadata: {
			args: [],
			command: 'claude',
			cwd: '/tmp/ws',
			env: {},
			id: 'runtime-handle-1',
			label: 'Chat',
			model: null,
			piAgentDirectoryPreserved: true,
			provider: 'claude',
			sessionId: null,
			startedAt: '2026-10-03T00:00:00.000Z',
			status: 'starting',
			thinking: null,
			updatedAt: '2026-10-03T00:00:00.000Z',
		},
		request: {
			agentSessionId: 'session-1',
			controlMcp: input.controlMcp
				? { token: 'tok', url: 'http://127.0.0.1:4321' }
				: null,
			permissionMode: 'workspace-trusted',
			planMode: input.planMode,
			workspaceCwd: '/tmp/ws',
		},
	});
	cleanups.push(() => adapter.shutdown());
	if (!installed) {
		throw new Error('The adapter never called query().');
	}
	return installed;
}

/**
 * Runs every installed `PreToolUse` hook against one `Bash` call.
 * @param options - The options the adapter installed.
 * @param command - The command the call would run.
 * @returns The reason of every deny rendered.
 */
async function denialsFor(options: Options, command: string) {
	const reasons: string[] = [];
	for (const matcher of options.hooks?.PreToolUse ?? []) {
		for (const hook of matcher.hooks) {
			const verdict = verdictOf(
				await hook(
					{
						hook_event_name: 'PreToolUse',
						tool_input: { command },
						tool_name: 'Bash',
					} as never,
					undefined,
					{ signal: new AbortController().signal },
				),
			);
			if (verdict?.permissionDecision === 'deny') {
				reasons.push(String(verdict.permissionDecisionReason));
			}
		}
	}
	return reasons;
}

describe('compute-queue Claude hook: where the adapter installs it', () => {
	it('gates a session served the control tools', async () => {
		const reasons = await denialsFor(
			await openSession({ controlMcp: true }),
			'bun run test',
		);
		expect(reasons).toHaveLength(1);
		expect(reasons[0]).toContain('mcp__ensemblr__ensemblr_run_queued');
	});

	it('leaves a session without the control server ungated, since it has no queue tool', async () => {
		expect(
			await denialsFor(
				await openSession({ controlMcp: false }),
				'bun run test',
			),
		).toEqual([]);
	});

	it('never gates the Concierge', async () => {
		const reasons = await denialsFor(
			await openSession({ concierge: true, controlMcp: true }),
			'bun run test',
		);
		expect(reasons.some((reason) => reason.includes('run_queued'))).toBe(false);
	});

	it('answers a planning session with Plan Mode’s refusal alone', async () => {
		const reasons = await denialsFor(
			await openSession({ controlMcp: true, planMode: true }),
			'bun run test',
		);
		expect(reasons).toHaveLength(1);
		expect(reasons[0]).not.toContain('run_queued');
	});
});
