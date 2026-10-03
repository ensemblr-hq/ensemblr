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
 * Nor is `Monitor`, whose `command` runs in a shell just as `Bash`'s does.
 *
 * While the session plans, a command Plan Mode refuses is left to Plan Mode, so
 * the model reads one refusal rather than two that disagree on what to do next
 * — the order Pi's `checkPlanModeTool` answers in. A command Plan Mode passes,
 * such as a `Monitor`'s, is still classified here, and refused in words that
 * defer to the plan rather than pointing at a queue tool Plan Mode also blocks.
 *
 * A classifier failure is logged and passes the call: an exception escaping a
 * hook fails the tool call with nothing the model can act on.
 */
import type {
	HookCallbackMatcher,
	HookEvent,
	HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';

import { CONTROL_SERVER_NAME } from '../../shared/agent-control.ts';
import {
	classifyHeavyCommandForSettings,
	type HeavyCommandVerdict,
	heavyCommandBlockReason,
} from '../../shared/compute-queue.ts';
import type { ComputeQueueSettings } from '../../shared/config.ts';
import { isReadOnlyBashCommand } from '../../shared/plan-mode.ts';

/** Claude Code's shell tool, the one Plan Mode classifies. */
const CLAUDE_SHELL_TOOL = 'Bash';

/**
 * Every Claude Code tool whose input carries a `command` it runs in a shell:
 * `Bash`, and `Monitor`, which runs one and streams its stdout as events.
 */
const CLAUDE_SHELL_COMMAND_TOOLS: ReadonlySet<string> = new Set([
	CLAUDE_SHELL_TOOL,
	'Monitor',
]);

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
 * Classifies a command, passing it if the classifier itself fails: the hook
 * runs on every tool call, and an exception escaping it would fail the call
 * outright rather than refuse it with a reason the model can act on.
 * @param command - The command the tool would run.
 * @param settings - The live compute-queue settings.
 * @returns The verdict, or a pass when classification threw.
 */
function classifySafely(
	command: string,
	settings: ComputeQueueSettings,
): HeavyCommandVerdict {
	try {
		return classifyHeavyCommandForSettings(command, settings);
	} catch (cause) {
		console.warn(
			'[claude-agent] compute-queue classification failed; passing the call.',
			{ cause, commandLength: command.length },
		);
		return { heavy: false };
	}
}

/**
 * Words the refusal for a heavy command while the session plans. Plan Mode
 * blocks the queue tools as well, so pointing at them would contradict it.
 * @param matched - The pattern the command matched.
 * @returns The refusal.
 */
function planningRefusal(matched: string): string {
	return `Plan Mode: this command is compute-heavy (it matches \`${matched}\`), and heavy commands cannot run until the plan is approved — not in a shell tool, and not through the compute queue. Put it in the plan as a step to run after approval.`;
}

/**
 * Decides one Claude tool call against the compute queue's policy.
 * @param toolName - The SDK tool name being called.
 * @param toolInput - The tool call's raw input object.
 * @param settings - The live compute-queue settings.
 * @param planning - Whether the session is planning, which changes what the refusal advises.
 * @returns The refusal to hand the model, or null when the call passes.
 */
function computeQueueDenial(
	toolName: string,
	toolInput: Record<string, unknown>,
	settings: ComputeQueueSettings,
	planning: boolean,
): string | null {
	const command = toolInput.command;
	if (
		!CLAUDE_SHELL_COMMAND_TOOLS.has(toolName) ||
		typeof command !== 'string'
	) {
		return null;
	}
	const verdict = classifySafely(command, settings);
	if (!verdict.heavy) {
		return null;
	}
	return planning
		? planningRefusal(verdict.matched)
		: heavyCommandBlockReason({
				command,
				matched: verdict.matched,
				queueToolName: QUEUE_TOOL_NAME,
				waitToolName: WAIT_TOOL_NAME,
			});
}

/**
 * Reports whether Plan Mode's own hook refuses this call, which it does to any
 * `Bash` command that is not read-only while the session plans.
 * @param toolName - The SDK tool name being called.
 * @param toolInput - The tool call's raw input object.
 * @returns True when Plan Mode answers the call itself.
 */
function planModeRefuses(
	toolName: string,
	toolInput: Record<string, unknown>,
): boolean {
	const command = toolInput.command;
	return (
		toolName === CLAUDE_SHELL_TOOL &&
		!isReadOnlyBashCommand(typeof command === 'string' ? command : '').ok
	);
}

/**
 * Builds the `PreToolUse` matcher that refuses a heavy shell command.
 * @param readSettings - Reads the live compute-queue settings at tool-call time.
 * @param isPlanning - Reads the session's live Plan Mode flag at tool-call time.
 * @returns The matcher to register under `PreToolUse`.
 */
function createComputeQueuePreToolUseHook(
	readSettings: () => ComputeQueueSettings,
	isPlanning: () => boolean,
): HookCallbackMatcher {
	return {
		hooks: [
			async (input): Promise<HookJSONOutput> => {
				if (input.hook_event_name !== 'PreToolUse') {
					return {};
				}
				const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
				const planning = isPlanning();
				if (planning && planModeRefuses(input.tool_name, toolInput)) {
					return {};
				}
				const reason = computeQueueDenial(
					input.tool_name,
					toolInput,
					readSettings(),
					planning,
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
 * @param isPlanning - Reads the session's live Plan Mode flag at tool-call time.
 * @returns The combined hook map to hand the SDK.
 */
export function withComputeQueueHooks(
	base: ClaudeHookMap | undefined,
	readSettings: () => ComputeQueueSettings,
	isPlanning: () => boolean = () => false,
): ClaudeHookMap {
	return {
		...base,
		PreToolUse: [
			...(base?.PreToolUse ?? []),
			createComputeQueuePreToolUseHook(readSettings, isPlanning),
		],
	};
}
