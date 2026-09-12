import type { HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { withAfkHooks } from '../../src/main/claude-agent/claude-afk-mode.ts';
import { withPlanModeHooks } from '../../src/main/claude-agent/claude-plan-mode-guard.ts';

/**
 * Narrows the SDK's hook-output union to the synchronous shape this hook always
 * returns, so a test can read the verdict off it.
 * @param output - Whatever the hook resolved with.
 * @returns The `PreToolUse` decision, or null when the hook rendered none.
 */
const verdictOf = (output: HookJSONOutput) =>
	'hookSpecificOutput' in output && output.hookSpecificOutput
		? output.hookSpecificOutput
		: null;

/**
 * Runs the Plan Mode `PreToolUse` hook against one tool call.
 * @param isPlanning - Reads the session's live Plan Mode flag, as the adapter's does.
 * @param toolName - The tool Claude asked to run.
 * @param toolInput - The tool call's raw input.
 * @returns The hook's output.
 */
const run = async (
	isPlanning: () => boolean,
	toolName: string,
	toolInput: Record<string, unknown> = {},
) => {
	const hooks = withPlanModeHooks(undefined, isPlanning);
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

/**
 * Reads the model-facing reason off a hook decision.
 * @param output - Whatever the hook resolved with.
 * @returns The reason, or the empty string when the hook rendered no decision.
 */
const reasonOf = (output: HookJSONOutput): string => {
	const verdict = verdictOf(output);
	return verdict && 'permissionDecisionReason' in verdict
		? (verdict.permissionDecisionReason ?? '')
		: '';
};

// `permissionMode: 'plan'` is the only seam the Claude path had, and the CLI
// drops it as the model runs its own `ExitPlanMode` — so on a trusted workspace
// the rest of that turn ran at `bypassPermissions` with no `canUseTool` and no
// hook. This is the Concierge's second seam, given to Plan Mode: it resolves
// before permissions are consulted at all, so it also holds against an
// allow-rule in the user's own `settings.json`.
describe('claude Plan Mode hook', () => {
	it.each(['Edit', 'MultiEdit', 'NotebookEdit', 'Write'])(
		'denies %s while the chat is planning',
		async (toolName) => {
			const output = await run(() => true, toolName, {
				file_path: '/tmp/ws/src/x.ts',
			});

			expect(verdictOf(output)).toMatchObject({
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
			});
			expect(reasonOf(output)).toContain(toolName);
		},
	);

	it('routes Bash through the shared read-only classifier', async () => {
		expect(await run(() => true, 'Bash', { command: 'git status' })).toEqual(
			{},
		);

		const denied = await run(() => true, 'Bash', {
			command: 'git commit -am wip',
		});
		expect(verdictOf(denied)).toMatchObject({ permissionDecision: 'deny' });
		expect(reasonOf(denied)).toContain('commit');
	});

	it('catches the escape the same classifier now guards', async () => {
		const denied = await run(() => true, 'Bash', {
			command: 'sort --compress-program=/tmp/evil.sh in.txt',
		});

		expect(verdictOf(denied)).toMatchObject({ permissionDecision: 'deny' });
	});

	it('reads the flag at call time, so a chat that is not planning is untouched', async () => {
		expect(await run(() => false, 'Write', { file_path: '/tmp/x' })).toEqual(
			{},
		);
		expect(
			await run(() => false, 'Bash', { command: 'git commit -am wip' }),
		).toEqual({});
	});

	// The CLI's `plan` mode already answers for Claude's whole built-in set plus
	// whatever the user's settings and MCP servers add; this hook holds the two
	// cases that mode has been observed to drop, rather than re-implementing it.
	it.each(['Read', 'Glob', 'Grep', 'Task', 'WebFetch', 'ExitPlanMode'])(
		'renders no decision for %s, leaving it to the mode',
		async (toolName) => {
			expect(await run(() => true, toolName)).toEqual({});
		},
	);

	it('names Claude s own exit tool rather than the Pi control one', async () => {
		const reason = reasonOf(
			await run(() => true, 'Write', { file_path: '/x' }),
		);

		expect(reason).toContain('ExitPlanMode');
		expect(reason).not.toContain('ensemblr_exit_plan_mode');
	});

	it('composes with the AFK hook rather than replacing it', async () => {
		const hooks = withAfkHooks(
			withPlanModeHooks(undefined, () => true),
			() => true,
		);

		expect(hooks.PreToolUse).toHaveLength(2);
	});
});
