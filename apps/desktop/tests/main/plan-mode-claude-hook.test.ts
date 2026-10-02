import type { HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { withAfkHooks } from '../../src/main/claude-agent/claude-afk-mode.ts';
import { withholdsControlTools } from '../../src/main/claude-agent/claude-permission-bridge.ts';
import { withPlanModeHooks } from '../../src/main/claude-agent/claude-plan-mode-guard.ts';
import type { PermissionMode } from '../../src/shared/permissions.ts';

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
 * Builds the hook the way the adapter does, from a workspace permission mode
 * rather than a hand-written clearance — so a test cannot pass a combination the
 * real wiring never produces.
 * @param input - The workspace's permission mode and whether the chat is planning.
 * @returns The session's single `PreToolUse` hook.
 */
const hookFor = ({
	mode,
	planning,
}: {
	mode: PermissionMode;
	planning: boolean;
}) => {
	const hooks = withPlanModeHooks(
		undefined,
		() => planning,
		() => withholdsControlTools({ mode, planning }),
	);
	const hook = hooks.PreToolUse?.[0]?.hooks[0];
	if (!hook) {
		throw new Error('No PreToolUse hook registered.');
	}
	return hook;
};

/**
 * Runs one tool call against a hook built by {@link hookFor}.
 * @param hook - The hook to run.
 * @param toolName - The tool Claude asked to run.
 * @param toolInput - The tool call's raw input.
 * @returns The hook's output.
 */
const call = async (
	hook: ReturnType<typeof hookFor>,
	toolName: string,
	toolInput: Record<string, unknown> = {},
) =>
	await hook(
		{
			hook_event_name: 'PreToolUse',
			tool_input: toolInput,
			tool_name: toolName,
		} as never,
		undefined,
		{ signal: new AbortController().signal },
	);

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

	// The native tool is published only to a session running behind a per-tool
	// approval callback, so naming it alone sent a trusted workspace hunting for
	// `No such tool available: ExitPlanMode`.
	it('names the control exit first and the native one as conditional', async () => {
		const reason = reasonOf(
			await run(() => true, 'Write', { file_path: '/x' }),
		);

		expect(reason).toContain('ensemblr_exit_plan_mode');
		expect(reason).toContain('ExitPlanMode');
		expect(reason.indexOf('ensemblr_exit_plan_mode')).toBeLessThan(
			reason.indexOf("runtime's own"),
		);
	});

	// The CLI routes any MCP tool it cannot read as read-only to `canUseTool`
	// while the mode is `plan`, and a trusted workspace hands it none — so every
	// control tool came back `Cannot call … while in plan mode`, the naming and
	// summary ops the upkeep block asks for by name included. The control server
	// answers for each op by role, which is the finer gate.
	it.each([
		'mcp__ensemblr__ensemblr_set_name',
		'mcp__ensemblr__ensemblr_set_branch_name',
		'mcp__ensemblr__ensemblr_set_summary',
		'mcp__ensemblr__ensemblr_ask_user_question',
		'mcp__ensemblr__ensemblr_start_conversation',
		'ensemblr_set_branch_name',
	])('pre-approves %s so the CLI does not refuse it', async (toolName) => {
		const output = await run(() => true, toolName, { name: 'Add dark mode' });

		expect(verdictOf(output)).toMatchObject({
			hookEventName: 'PreToolUse',
			permissionDecision: 'allow',
		});
	});

	// Membership, not a prefix: an unrelated server borrowing the name would
	// otherwise collect the clearance the control server's own gate pays for.
	it.each([
		'mcp__ensemblr__ensemblr_not_a_real_op',
		'mcp__other__ensemblr__ensemblr_start_terminal',
	])('renders no decision for %s', async (toolName) => {
		expect(await run(() => true, toolName)).toEqual({});
	});

	it('pre-approves nothing once the chat stops planning', async () => {
		expect(
			await run(() => false, 'mcp__ensemblr__ensemblr_set_branch_name', {
				name: 'Add dark mode',
			}),
		).toEqual({});
	});

	// A `read-only` workspace opens under `permissionMode: 'plan'` for every turn,
	// planning or not, so the CLI withholds the control surface there even with
	// the chat's own Plan Mode flag off. The clearance follows the mode.
	it('clears the control surface for a workspace the CLI keeps in plan mode', async () => {
		const hook = hookFor({ mode: 'read-only', planning: false });

		const allowed = await call(hook, 'mcp__ensemblr__ensemblr_set_name');
		const untouched = await call(hook, 'Write', { file_path: '/tmp/x' });

		expect(verdictOf(allowed)).toMatchObject({ permissionDecision: 'allow' });
		expect(untouched).toEqual({});
	});

	// `approval-required` is the one mode whose planning turns keep a `canUseTool`,
	// so the CLI's routing ends at the user's approval card rather than a refusal.
	// Clearing the tool here would spend the gate that mode is chosen for — the
	// clearance has to reach the classifier, not just the hook's early return.
	it('leaves a control tool to the approval card while planning', async () => {
		const hook = hookFor({ mode: 'approval-required', planning: true });

		expect(await call(hook, 'mcp__ensemblr__ensemblr_set_branch_name')).toEqual(
			{},
		);
	});

	// The refusals are the other half of that turn, and they do not follow the
	// clearance: a planning approval-required session still has writes held.
	it('still refuses a write on the mode that keeps its approval card', async () => {
		const hook = hookFor({ mode: 'approval-required', planning: true });

		const denied = await call(hook, 'Write', { file_path: '/tmp/x' });

		expect(verdictOf(denied)).toMatchObject({ permissionDecision: 'deny' });
	});

	it('composes with the AFK hook rather than replacing it', async () => {
		const hooks = withAfkHooks(
			withPlanModeHooks(undefined, () => true),
			() => true,
		);

		expect(hooks.PreToolUse).toHaveLength(2);
	});
});

// The clearance exists only where the CLI's routing ends in a refusal. Under
// `approval-required` it ends at the user's own approval card instead, and
// clearing the tool there would spend the gate that mode is chosen for.
describe('withholdsControlTools', () => {
	it('clears a planning trusted workspace and leaves it alone otherwise', () => {
		expect(
			withholdsControlTools({ mode: 'workspace-trusted', planning: true }),
		).toBe(true);
		expect(
			withholdsControlTools({ mode: 'workspace-trusted', planning: false }),
		).toBe(false);
	});

	// `read-only` resolves to `permissionMode: 'plan'` on every turn, so the CLI
	// withholds the control surface there whether or not the chat is planning.
	it('clears a read-only workspace on every turn', () => {
		for (const planning of [true, false]) {
			expect(withholdsControlTools({ mode: 'read-only', planning })).toBe(true);
		}
	});

	it('never clears approval-required, which can raise the card instead', () => {
		for (const planning of [true, false]) {
			expect(
				withholdsControlTools({ mode: 'approval-required', planning }),
			).toBe(false);
		}
	});
});
