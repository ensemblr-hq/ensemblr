/**
 * Closes the two surfaces a Claude session parks a turn on while the user is
 * away: its own question tool, and the per-tool approval card.
 *
 * Ensemblr's `ensemblr_ask_user_question` is refused by the control gate and its
 * `approval-required` confirmation is auto-approved there, but neither path
 * covers Claude — it ships `AskUserQuestion` natively and raises its own
 * permission card through `canUseTool`, and both surfaces block with no deadline
 * of their own. Without this module a session told the user is away would still
 * stall on whichever it reached first.
 *
 * Both are wrappers reading a live flag rather than options fixed at `query()`,
 * and that is the whole design. The SDK settles `disallowedTools` and the
 * `canUseTool` callback when the query opens, while the composer's chip moves
 * per turn: anything decided at open would keep refusing after the user came
 * back, and would let a session that went AFK mid-run through. Reading the flag
 * at call time tracks the toggle both ways.
 *
 * What each one may relax is deliberately different, mirroring
 * `gatePermission`'s scope. The approval card is a *confirmation* the mode
 * already permits, so AFK answers it; a containment gate that refuses outright —
 * the Concierge's — is left alone, because AFK never widens a mode. The hook only
 * ever refuses, and a pass returns no decision rather than `allow`, so it stacks
 * with whatever else the session registers instead of replacing it.
 */
import type {
	HookCallbackMatcher,
	HookEvent,
	HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';

import type { ClaudeCanUseTool } from './claude-permission-bridge.ts';

/** Claude Code's own interactive question tool. */
const ASK_USER_QUESTION_TOOL = 'AskUserQuestion';

/** Every `PreToolUse` matcher a session runs, keyed by hook event. */
type ClaudeHookMap = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

/**
 * What the model is told when the tool is refused. It carries the escape hatch
 * as well as the cause, for the reason `afkModeControlOpDenial` does: an agent
 * told only "no" retries the same call or stops, and both lose the run.
 */
const AFK_TOOL_DENIAL =
	'The user has switched this conversation to AFK and is away from the machine, so nothing would answer a question and asking one would park the turn. Decide it yourself: take the most defensible reading, act on it, and record the assumption in your final message under its own heading.';

/**
 * Builds the `PreToolUse` matcher that denies Claude's native question tool for
 * as long as the chat is unattended.
 * @param isUnattended - Reads the session's live AFK flag at tool-call time.
 * @returns The matcher to register under `PreToolUse`.
 */
function createAfkPreToolUseHook(
	isUnattended: () => boolean,
): HookCallbackMatcher {
	return {
		hooks: [
			async (input): Promise<HookJSONOutput> => {
				if (input.hook_event_name !== 'PreToolUse') {
					return {};
				}
				if (input.tool_name !== ASK_USER_QUESTION_TOOL || !isUnattended()) {
					return {};
				}
				return {
					hookSpecificOutput: {
						hookEventName: 'PreToolUse',
						permissionDecision: 'deny',
						permissionDecisionReason: AFK_TOOL_DENIAL,
					},
				};
			},
		],
	};
}

/**
 * Adds the AFK question guard to whatever hooks a session already runs behind.
 *
 * Composed rather than chosen between: the Concierge's containment hook and this
 * one both exist to refuse, and a session that needs both has to run both — a
 * deny from either stands, and neither pre-approves anything the other would
 * have caught.
 * @param base - Hooks the session's other surfaces registered, if any.
 * @param isUnattended - Reads the session's live AFK flag at tool-call time.
 * @returns The combined hook map to hand the SDK.
 */
export function withAfkHooks(
	base: ClaudeHookMap | undefined,
	isUnattended: () => boolean,
): ClaudeHookMap {
	const afkHook = createAfkPreToolUseHook(isUnattended);
	return {
		...base,
		PreToolUse: [...(base?.PreToolUse ?? []), afkHook],
	};
}

/**
 * Wraps the `approval-required` per-tool gate so an unattended session resolves
 * approved instead of raising a card nobody will answer.
 *
 * Scoped exactly as `gatePermission`'s auto-approval is: this reaches only the
 * confirmation gate a mode already permits, so a `read-only` workspace still
 * withholds its mutating tools and the Concierge's containment gate is never
 * handed here. The counterweight is in `buildAfkDirective` — nobody is watching,
 * so the agent's own judgement is the remaining gate on anything hard to
 * reverse.
 * @param canUseTool - The mode's own gate, or undefined when it raises no card.
 * @param isUnattended - Reads the session's live AFK flag at tool-call time.
 * @returns The wrapped gate, or undefined when there was none to wrap.
 */
export function withAfkAutoApproval(
	canUseTool: ClaudeCanUseTool | undefined,
	isUnattended: () => boolean,
): ClaudeCanUseTool | undefined {
	if (!canUseTool) {
		return undefined;
	}
	return async (toolName, input, options) => {
		if (isUnattended()) {
			return { behavior: 'allow', updatedInput: input };
		}
		return await canUseTool(toolName, input, options);
	};
}
