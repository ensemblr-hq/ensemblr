/**
 * Plan Mode's second enforcement seam on the Claude Code path.
 *
 * The first is `permissionMode: 'plan'`, and on its own it is not enough. Claude
 * runs its own `ExitPlanMode` and the CLI leaves plan mode as it does so,
 * without telling the adapter; nothing re-asserts until the user's next prompt,
 * so the rest of that turn runs at whatever the workspace mode grants — on a
 * `workspace-trusted` workspace, `bypassPermissions` with no `canUseTool` and no
 * hook in the path. A `permissions.allow` rule in the user's own
 * `~/.claude/settings.json` is the other way past a mode-level gate, and
 * `settingSources` loads those by design.
 *
 * So this is a `PreToolUse` hook reading live state at call time, exactly as
 * `claude-concierge-guard.ts` does and for the reason its header gives: the hook
 * resolves before permissions are consulted at all. A pass returns no decision
 * rather than `allow`, so it stacks with the AFK hook and the Concierge's
 * instead of replacing either.
 *
 * Deliberately *not* an entry in `disallowedTools`: the SDK settles that list
 * when `query()` opens and a planning session has to become a writing one the
 * moment the user approves the plan, in the same process. A deny list fixed at
 * open would strand an approved session with no editor.
 */
import type {
	HookCallbackMatcher,
	HookEvent,
	HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';

import { isReadOnlyBashCommand } from '../../shared/plan-mode.ts';

/**
 * Claude Code's file-mutating tools, under the capitalized names its SDK uses.
 * `NotebookEdit` and `MultiEdit` are listed for the same reason
 * `CONCIERGE_WRITE_TOOLS` lists them: one left off is a write with nothing in
 * front of it.
 */
const PLAN_MODE_WRITE_TOOLS: ReadonlySet<string> = new Set([
	'Edit',
	'MultiEdit',
	'NotebookEdit',
	'Write',
]);

/** Claude Code's shell tool, restricted to read-only commands while planning. */
const CLAUDE_SHELL_TOOL = 'Bash';

/**
 * What a refused call is told. It names Claude's own `ExitPlanMode` rather than
 * the `ensemblr_exit_plan_mode` in the shared reason: the native tool is the one
 * the plan bridge watches for, and pointing a Claude session at the control tool
 * would file the plan down a second path for no gain.
 * @param cause - What about this call is not allowed while planning.
 * @returns The full reason to hand the model.
 */
function planModeReason(cause: string): string {
	return `Plan Mode is on — ${cause}. This is not a bug to work around: finish the plan and call \`ExitPlanMode\`. If the user approves it, Plan Mode turns off and you can implement it.`;
}

/** Whether a planning Claude tool call may proceed, and why not when it may not. */
export interface ClaudePlanModeVerdict {
	blocked: boolean;
	reason?: string;
}

/**
 * Classifies one Claude tool call against Plan Mode policy.
 *
 * Narrower than the Pi classifier's deny-by-default posture, on purpose. Claude
 * ships a large built-in tool set plus whatever the user's own settings and MCP
 * servers add, and the CLI's `plan` mode already answers for all of it; this
 * hook exists to hold the two cases that mode has been observed to drop, not to
 * re-implement it. Anything else passes to the mode's own judgement.
 * @param toolInput - The tool call's raw input object.
 * @param toolName - The SDK tool name being called.
 * @returns Whether the call is blocked, with a reason when it is.
 */
export function evaluateClaudePlanModeTool({
	toolInput,
	toolName,
}: {
	toolInput: Record<string, unknown>;
	toolName: string;
}): ClaudePlanModeVerdict {
	if (PLAN_MODE_WRITE_TOOLS.has(toolName)) {
		return {
			blocked: true,
			reason: planModeReason(
				`\`${toolName}\` cannot change files until the plan is approved`,
			),
		};
	}
	if (toolName !== CLAUDE_SHELL_TOOL) {
		return { blocked: false };
	}
	const command = toolInput.command;
	const verdict = isReadOnlyBashCommand(
		typeof command === 'string' ? command : '',
	);
	return verdict.ok
		? { blocked: false }
		: {
				blocked: true,
				reason: planModeReason(
					`this \`Bash\` command is not read-only: ${verdict.reason}`,
				),
			};
}

/** Every `PreToolUse` matcher a session runs, keyed by hook event. */
type ClaudeHookMap = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

/**
 * Builds the `PreToolUse` matcher that refuses a write for as long as the chat
 * is planning.
 * @param isPlanning - Reads the session's live Plan Mode flag at tool-call time.
 * @returns The matcher to register under `PreToolUse`.
 */
function createPlanModePreToolUseHook(
	isPlanning: () => boolean,
): HookCallbackMatcher {
	return {
		hooks: [
			async (input): Promise<HookJSONOutput> => {
				if (input.hook_event_name !== 'PreToolUse' || !isPlanning()) {
					return {};
				}
				const verdict = evaluateClaudePlanModeTool({
					toolInput: (input.tool_input ?? {}) as Record<string, unknown>,
					toolName: input.tool_name,
				});
				return verdict.blocked
					? {
							hookSpecificOutput: {
								hookEventName: 'PreToolUse',
								permissionDecision: 'deny',
								permissionDecisionReason: verdict.reason ?? '',
							},
						}
					: {};
			},
		],
	};
}

/**
 * Adds the Plan Mode guard to whatever hooks a session already runs behind.
 *
 * Composed rather than chosen between, for the reason `withAfkHooks` composes:
 * a session can be planning, unattended and a Concierge at once, every one of
 * these hooks exists only to refuse, and a deny from any of them stands.
 * @param base - Hooks the session's other surfaces registered, if any.
 * @param isPlanning - Reads the session's live Plan Mode flag at tool-call time.
 * @returns The combined hook map to hand the SDK.
 */
export function withPlanModeHooks(
	base: ClaudeHookMap | undefined,
	isPlanning: () => boolean,
): ClaudeHookMap {
	return {
		...base,
		PreToolUse: [
			...(base?.PreToolUse ?? []),
			createPlanModePreToolUseHook(isPlanning),
		],
	};
}
