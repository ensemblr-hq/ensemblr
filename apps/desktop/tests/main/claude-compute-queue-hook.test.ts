import type { HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { withAfkHooks } from '../../src/main/claude-agent/claude-afk-mode.ts';
import { withComputeQueueHooks } from '../../src/main/claude-agent/claude-compute-queue-guard.ts';
import { withPlanModeHooks } from '../../src/main/claude-agent/claude-plan-mode-guard.ts';
import type { ComputeQueueSettings } from '../../src/shared/config.ts';

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
) => {
	const hooks = withComputeQueueHooks(undefined, readSettings);
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

	it('passes a light Bash command with no decision at all', async () => {
		expect(
			await run(() => SETTINGS, 'Bash', { command: 'git status' }),
		).toEqual({});
	});

	it('passes every tool other than Bash', async () => {
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
