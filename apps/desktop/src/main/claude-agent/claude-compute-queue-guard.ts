/**
 * The compute queue's enforcement seam on the Claude Code path.
 *
 * A `PreToolUse` hook for the reason `claude-plan-mode-guard.ts` gives for its
 * own: the hook resolves before permissions are consulted, so neither a
 * `bypassPermissions` workspace nor an allow rule in the user's own
 * `~/.claude/settings.json` lets a heavy command past it. It reads the settings
 * live at call time, so turning the queue off or exempting a pattern takes
 * effect on the next tool call rather than the next session.
 *
 * It only ever refuses. A pass returns no decision at all, so it stacks with the
 * Plan Mode, AFK and Concierge hooks instead of overturning any of them, and a
 * command it waves through still meets every gate the session already had.
 *
 * `run_in_background` is not an escape: a backgrounded build loads the machine
 * exactly as a foreground one does, so the same command is refused either way.
 */
import type {
	HookCallbackMatcher,
	HookEvent,
	HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';

import { CONTROL_SERVER_NAME } from '../../shared/agent-control.ts';
import {
	classifyHeavyCommandForSettings,
	heavyCommandBlockReason,
} from '../../shared/compute-queue.ts';
import type { ComputeQueueSettings } from '../../shared/config.ts';

/** Claude Code's shell tool, the one surface a heavy command reaches through. */
const CLAUDE_SHELL_TOOL = 'Bash';

/**
 * The queue tools under the name Claude's tool list carries them: the SDK
 * namespaces every MCP tool by its server. Spelled out rather than run through
 * `namespaceControlToolNames`, which wraps only names it already knows to be
 * served and would leave these bare until the ops are declared.
 */
const QUEUE_TOOL_NAME = `mcp__${CONTROL_SERVER_NAME}__ensemblr_run_queued`;
const WAIT_TOOL_NAME = `mcp__${CONTROL_SERVER_NAME}__ensemblr_wait_for_job`;

/** Every `PreToolUse` matcher a session runs, keyed by hook event. */
type ClaudeHookMap = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

/**
 * Renders a refusal in the shape the SDK reads a hook decision from.
 * @param reason - What the model is told.
 * @returns The hook output denying the call.
 */
function deny(reason: string): HookJSONOutput {
	return {
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: reason,
		},
	};
}

/**
 * Decides one Claude tool call against the compute queue's policy.
 * @param toolName - The SDK tool name being called.
 * @param toolInput - The tool call's raw input object.
 * @param settings - The live compute-queue settings.
 * @returns The refusal to hand the model, or null when the call passes.
 */
function computeQueueDenial(
	toolName: string,
	toolInput: Record<string, unknown>,
	settings: ComputeQueueSettings,
): string | null {
	if (toolName !== CLAUDE_SHELL_TOOL || typeof toolInput.command !== 'string') {
		return null;
	}
	const command = toolInput.command;
	const verdict = classifyHeavyCommandForSettings(command, settings);
	return verdict.heavy
		? heavyCommandBlockReason({
				command,
				matched: verdict.matched,
				queueToolName: QUEUE_TOOL_NAME,
				waitToolName: WAIT_TOOL_NAME,
			})
		: null;
}

/**
 * Builds the `PreToolUse` matcher that refuses a heavy `Bash` command.
 * @param readSettings - Reads the live compute-queue settings at tool-call time.
 * @returns The matcher to register under `PreToolUse`.
 */
function createComputeQueuePreToolUseHook(
	readSettings: () => ComputeQueueSettings,
): HookCallbackMatcher {
	return {
		hooks: [
			async (input): Promise<HookJSONOutput> => {
				if (input.hook_event_name !== 'PreToolUse') {
					return {};
				}
				const reason = computeQueueDenial(
					input.tool_name,
					(input.tool_input ?? {}) as Record<string, unknown>,
					readSettings(),
				);
				return reason === null ? {} : deny(reason);
			},
		],
	};
}

/**
 * Adds the compute-queue guard to whatever hooks a session already runs
 * behind. Composed rather than chosen between, as `withPlanModeHooks` is: a
 * deny from any hook stands, and this one never allows.
 * @param base - Hooks the session's other surfaces registered, if any.
 * @param readSettings - Reads the live compute-queue settings at tool-call time.
 * @returns The combined hook map to hand the SDK.
 */
export function withComputeQueueHooks(
	base: ClaudeHookMap | undefined,
	readSettings: () => ComputeQueueSettings,
): ClaudeHookMap {
	return {
		...base,
		PreToolUse: [
			...(base?.PreToolUse ?? []),
			createComputeQueuePreToolUseHook(readSettings),
		],
	};
}
