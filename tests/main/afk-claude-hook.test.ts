import type { HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { withAfkHooks } from '../../src/main/claude-agent/claude-afk-mode.ts';

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
 * Runs the single `PreToolUse` hook the builder registers against one tool call.
 * @param unattended - Reads the session's live AFK flag, as the adapter's does.
 * @param toolName - The tool Claude asked to run.
 * @returns The hook's output.
 */
const run = async (unattended: () => boolean, toolName: string) => {
	const hooks = withAfkHooks(undefined, unattended);
	const hook = hooks.PreToolUse?.[0]?.hooks[0];
	if (!hook) {
		throw new Error('No PreToolUse hook registered.');
	}
	return await hook(
		{
			hook_event_name: 'PreToolUse',
			tool_input: {},
			tool_name: toolName,
		} as never,
		undefined,
		{ signal: new AbortController().signal },
	);
};

describe('claude AFK hook', () => {
	it('denies the native question tool while the user is away', async () => {
		const output = await run(() => true, 'AskUserQuestion');

		expect(verdictOf(output)).toMatchObject({
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
		});
	});

	it('tells the model to decide for itself rather than only refusing', async () => {
		const verdict = verdictOf(await run(() => true, 'AskUserQuestion'));
		const reason =
			verdict && 'permissionDecisionReason' in verdict
				? verdict.permissionDecisionReason
				: '';

		expect(reason).toContain('AFK');
		expect(reason).toContain('Decide it yourself');
	});

	it('allows the question tool while the user is present', async () => {
		expect(await run(() => false, 'AskUserQuestion')).toEqual({});
	});

	// A pass returns no decision rather than `allow`: pre-approving everything the
	// hook does not refuse would hand the session more than its permission mode
	// granted it.
	it('renders no verdict for any other tool', async () => {
		expect(await run(() => true, 'Edit')).toEqual({});
		expect(await run(() => true, 'Bash')).toEqual({});
	});

	// The SDK fixes `disallowedTools` when `query()` opens, but the composer's chip
	// moves per turn. Reading the flag at call time is what makes a chat that goes
	// AFK mid-run refuse the tool, and one that comes back get it again.
	it('tracks the flag between calls rather than capturing it', async () => {
		let unattended = false;
		const hooks = withAfkHooks(undefined, () => unattended);
		const hook = hooks.PreToolUse?.[0]?.hooks[0];
		if (!hook) {
			throw new Error('No PreToolUse hook registered.');
		}
		const call = () =>
			hook(
				{
					hook_event_name: 'PreToolUse',
					tool_input: {},
					tool_name: 'AskUserQuestion',
				} as never,
				undefined,
				{ signal: new AbortController().signal },
			);

		expect(await call()).toEqual({});
		unattended = true;
		expect(verdictOf(await call())).not.toBeNull();
		unattended = false;
		expect(await call()).toEqual({});
	});
});
