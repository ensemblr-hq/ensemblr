/**
 * Enforces the Concierge's containment rule on the Claude Code path.
 *
 * The classifier itself is `evaluateConciergeTool` in `shared/`, the same one
 * the shipped Pi extension asks the app for per intercepted tool call. Nothing
 * here decides policy — it only translates the SDK's vocabulary into the
 * request that classifier takes, so the two runtimes cannot drift.
 *
 * Two seams, because one of them is not enough on its own. `canUseTool` is the
 * SDK's permission surface and never fires under `bypassPermissions`, which is
 * what `workspace-trusted` used to resolve to; the `PreToolUse` hook resolves
 * before permissions are consulted at all, so it also holds against an
 * allow-rule in the user's own `settings.json` that would otherwise pre-approve
 * a write and skip `canUseTool` entirely.
 */
import type {
	CanUseTool,
	HookCallbackMatcher,
	HookEvent,
	HookJSONOutput,
	PermissionResult,
} from '@anthropic-ai/claude-agent-sdk';

import {
	type ConciergeToolVerdict,
	evaluateConciergeTool,
} from '../../shared/plan-mode.ts';
import type { ClaudePermissionSettings } from './claude-permission-bridge.ts';

/**
 * The SDK permission settings a Concierge session opens under.
 *
 * `default` rather than the `bypassPermissions` a trusted workspace gets:
 * bypassing every permission check also bypasses `canUseTool`, which is the gate
 * the containment rule hangs on. An agent that is read-only outside its own
 * folder has no business asking for `allowDangerouslySkipPermissions` anyway.
 */
const CONCIERGE_PERMISSION_SETTINGS: ClaudePermissionSettings = {
	permissionMode: 'default',
};

/** The slice of a Claude session's SDK options the Concierge policy replaces. */
export interface ConciergeSessionGate {
	canUseTool: CanUseTool;
	hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
	permission: ClaudePermissionSettings;
}

/**
 * Reads the path a Claude tool call targets.
 *
 * Claude's file tools name it `file_path` and its notebook tool `notebook_path`,
 * where Pi says `path`; all three are read because the classifier takes one
 * field and a spelling missed here reaches it as "no path", which it refuses.
 * @param input - The tool call's raw input object.
 * @returns The path the call names, or undefined when it names none.
 */
function toolPath(input: Record<string, unknown>): string | undefined {
	for (const key of ['file_path', 'path', 'notebook_path']) {
		const value = input[key];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

/**
 * Classifies one Claude tool call against the Concierge's containment rule.
 * @param input - The Concierge home, the SDK tool name, and the call's raw input.
 * @returns The shared classifier's verdict.
 */
function evaluate({
	conciergeHome,
	toolInput,
	toolName,
}: {
	conciergeHome: string;
	toolInput: Record<string, unknown>;
	toolName: string;
}): ConciergeToolVerdict {
	const command = toolInput.command;
	const path = toolPath(toolInput);
	return evaluateConciergeTool({
		conciergeHome,
		...(typeof command === 'string' ? { command } : {}),
		...(path === undefined ? {} : { path }),
		tool: toolName,
	});
}

/**
 * Builds the `canUseTool` gate a Concierge session runs behind, denying a
 * blocked call with the classifier's own reason so the model is told what to do
 * instead rather than just refused.
 * @param conciergeHome - Absolute path of the tree the Concierge may write.
 * @returns The SDK permission callback.
 */
function createConciergeCanUseTool(conciergeHome: string): CanUseTool {
	return async (toolName, input): Promise<PermissionResult> => {
		const verdict = evaluate({ conciergeHome, toolInput: input, toolName });
		return verdict.blocked
			? { behavior: 'deny', message: verdict.reason ?? '' }
			: { behavior: 'allow', updatedInput: input };
	};
}

/**
 * Builds the `PreToolUse` hook that backs the gate up, denying a blocked call
 * before the CLI resolves permissions for it.
 *
 * A pass returns no decision rather than `allow`: the hook exists to refuse, and
 * pre-approving everything it does not refuse would hand the Concierge more than
 * the workspace mode granted it.
 * @param conciergeHome - Absolute path of the tree the Concierge may write.
 * @returns The matcher to register under `PreToolUse`.
 */
function createConciergePreToolUseHook(
	conciergeHome: string,
): HookCallbackMatcher {
	return {
		hooks: [
			async (input): Promise<HookJSONOutput> => {
				if (input.hook_event_name !== 'PreToolUse') {
					return {};
				}
				const verdict = evaluate({
					conciergeHome,
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
 * Builds every SDK option a Concierge session needs so its tool calls are
 * classified. The adapter spreads this in place of the workspace permission
 * mapping, which is what makes the gate unconditional rather than a mode the
 * session could open without.
 * @param conciergeHome - Absolute path of the tree the Concierge may write.
 * @returns The permission settings, the `canUseTool` gate, and the backing hook.
 */
export function createConciergeSessionGate(
	conciergeHome: string,
): ConciergeSessionGate {
	return {
		canUseTool: createConciergeCanUseTool(conciergeHome),
		hooks: { PreToolUse: [createConciergePreToolUseHook(conciergeHome)] },
		permission: CONCIERGE_PERMISSION_SETTINGS,
	};
}
