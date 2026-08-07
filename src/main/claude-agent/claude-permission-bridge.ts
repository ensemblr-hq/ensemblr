import type {
	CanUseTool,
	PermissionMode as SdkPermissionMode,
} from '@anthropic-ai/claude-agent-sdk';

import type { PermissionMode } from '../../shared/permissions.ts';

/**
 * The SDK's per-tool approval callback. Re-exported under a local name so the
 * approval UI can depend on this seam without importing the SDK itself.
 */
export type ClaudeCanUseTool = CanUseTool;

/** The approval seam for one Claude session, plus its teardown. */
export interface ClaudeSessionApproval {
	/** Installed as the SDK's `canUseTool` when the mode calls for a gate. */
	canUseTool: ClaudeCanUseTool;
	/**
	 * Withdraws every prompt this session raised, denying each so the SDK is never
	 * left holding a tool call, and forgets anything remembered for the session.
	 * The adapter calls it on every shutdown path.
	 */
	release: () => void;
}

/**
 * Opens the approval seam for one session. The composition root injects one of
 * these; the adapter calls it once per session, because a prompt has to name the
 * chat it belongs to and the SDK's `canUseTool` arguments carry no session id.
 *
 * `agentSessionId` must be the `agent_sessions.id` row key — the only id a
 * renderer window can match a card against. The runtime's own session id and the
 * agent client's `AgentSessionMetadata.id` handle both reach nothing.
 */
export type ClaudeApprovalGate = (session: {
	agentSessionId: string;
}) => ClaudeSessionApproval;

/**
 * Tools Claude Code exposes that mutate the workspace or run commands. Withheld
 * outright in read-only mode, where `plan` alone would still let the model edit
 * once it left plan mode via its own `ExitPlanMode` call.
 */
const MUTATING_TOOLS = [
	'Bash',
	'BashOutput',
	'Edit',
	'KillShell',
	'NotebookEdit',
	'Write',
] as const;

/** The SDK permission settings a workspace permission mode resolves to. */
export interface ClaudePermissionSettings {
	allowDangerouslySkipPermissions?: boolean;
	disallowedTools?: string[];
	permissionMode: SdkPermissionMode;
}

/**
 * Maps Ensemblr's workspace permission mode onto the Agent SDK's gates.
 *
 * `read-only` pairs `plan` with an explicit `disallowedTools` list, because
 * plan mode is a mode the model can leave on its own; the deny list is what
 * actually holds. `workspace-trusted` opts into `bypassPermissions`.
 *
 * This is deliberately separate from the terminal harness, which bakes
 * `--dangerously-skip-permissions` into its launch by product decision
 * (`docs/harnesses.md`). First-class Claude honours the workspace mode like Pi
 * does, and the two paths must not converge.
 * @param mode - The workspace's permission mode.
 * @returns The SDK permission settings to spread into `query({ options })`.
 */
export function toClaudePermissionSettings(
	mode: PermissionMode,
): ClaudePermissionSettings {
	if (mode === 'read-only') {
		return {
			disallowedTools: [...MUTATING_TOOLS],
			permissionMode: 'plan',
		};
	}

	if (mode === 'approval-required') {
		return { permissionMode: 'default' };
	}

	return {
		allowDangerouslySkipPermissions: true,
		permissionMode: 'bypassPermissions',
	};
}

/**
 * Resolves the permission settings for a session, letting an explicit plan-mode
 * toggle win over the workspace mode. A trusted workspace whose chat is in plan
 * mode still plans first — the toggle is the more specific intent.
 *
 * Called for the opening `query()` and again on every turn, because Claude's
 * native `ExitPlanMode` drops the live session out of plan mode on its own. That
 * is why turning the toggle off resolves back to the workspace mode's own
 * baseline rather than a fixed `default`: a trusted chat would otherwise lose
 * `bypassPermissions` and a read-only one would lose its gate the first time a
 * plan was submitted.
 * @param input - Workspace permission mode and the chat's plan-mode toggle.
 * @returns The SDK permission settings for this turn.
 */
export function resolvePermissionSettings({
	mode,
	planMode,
}: {
	mode: PermissionMode;
	planMode: boolean;
}): ClaudePermissionSettings {
	const settings = toClaudePermissionSettings(mode);
	return planMode ? { ...settings, permissionMode: 'plan' } : settings;
}

/**
 * Builds the `canUseTool` callback for approval-required mode, preferring the
 * approval handler the composition root injected and falling back to the
 * placeholder when none is wired.
 * @param input - The workspace's permission mode and the injected approval handler.
 * @returns The callback, or undefined when the mode needs no per-tool gate.
 */
export function buildCanUseTool({
	canUseTool,
	mode,
}: {
	canUseTool?: ClaudeCanUseTool;
	mode: PermissionMode;
}): ClaudeCanUseTool | undefined {
	if (mode !== 'approval-required') {
		return undefined;
	}
	return canUseTool ?? createPlaceholderCanUseTool();
}

/**
 * Fallback approval handler for `approval-required` when the composition root
 * wired no gate — a headless path, or a test that opens a session without one.
 * It allows every call and warns once per session rather than denying: a silent
 * deny would make Claude look broken to a user who only asked to be consulted.
 * @returns A callback that allows each tool call unchanged.
 */
export function createPlaceholderCanUseTool(): ClaudeCanUseTool {
	let warned = false;
	return async (toolName, input) => {
		if (!warned) {
			warned = true;
			console.warn(
				'[claude-agent] approval-required has no approval handler wired; allowing tool calls unprompted.',
				{ toolName },
			);
		}
		return { behavior: 'allow', updatedInput: input };
	};
}
