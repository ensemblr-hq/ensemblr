import type {
	ComposerContextUsage,
	ComposerModelOption,
	ComposerShellState,
	ComposerThinkingOption,
	SessionTabModel,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc/contracts/setup';

/**
 * Whether a session tab gets a composer at all. A spawned sub-agent's tab never
 * does: the orchestrator that spawned it owns the conversation and steers it
 * with `ensemblr_send_follow_up` for the tab's whole life, so a prompt typed
 * here would put a second writer on a delegated turn. Nothing renders in the
 * composer's place — a disabled textarea only advertises an affordance that
 * never unlocks, and a child left running when its orchestrator stops is stopped
 * with it rather than handed back to the user.
 * @param session - The session tab about to be rendered.
 * @returns True when the tab is the user's to type into.
 */
export function showsComposer(session: SessionTabModel): boolean {
	return !session.isSubAgent;
}

/**
 * Computes the composer shell state from setup readiness, the active session,
 * and an agent controller. Disables the composer while setup is not yet ready
 * and while agent runtime checks fail. Sub-agent tabs never reach here — they
 * render no composer at all; see {@link showsComposer}.
 */
export function getComposerState({
	activeSession,
	activeAgentSessionId,
	availableModels,
	availableThinkingLevels,
	contextUsage,
	isStreaming,
	lockedProvider,
	modelId,
	onModelChange,
	onPlanModeChange,
	onStop,
	onSubmit,
	onThinkingChange,
	planMode,
	setupDiagnostics,
	setupError,
	thinkingLevel,
	workspaceCwd,
	workspaceFiles,
}: {
	activeAgentSessionId: string | null;
	activeSession: SessionTabModel;
	availableModels: readonly ComposerModelOption[];
	availableThinkingLevels: readonly ComposerThinkingOption[];
	contextUsage?: ComposerContextUsage | null;
	isStreaming: boolean;
	lockedProvider: AgentProviderId | null;
	modelId: string | null;
	onModelChange: (modelId: string) => void;
	onPlanModeChange: (planMode: boolean) => void;
	onStop: () => Promise<void> | void;
	onSubmit: (
		prompt: string,
		options?: { streamingBehavior?: 'steer' | 'followUp' },
	) => Promise<void> | void;
	onThinkingChange: (thinkingLevel: string) => void;
	planMode: boolean;
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	setupError: string | null;
	thinkingLevel: string | null;
	workspaceCwd?: string;
	workspaceFiles?: readonly WorkspaceFileSummary[];
}): ComposerShellState {
	const modelLabel =
		availableModels.find((option) => option.id === modelId)?.displayName ??
		'Model pending';
	const thinkingLabelText =
		availableThinkingLevels.find((option) => option.id === thinkingLevel)
			?.label ?? 'Thinking pending';

	const base = {
		activeAgentSessionId,
		availableModels,
		availableThinkingLevels,
		contextUsage: contextUsage ?? null,
		isStreaming,
		lockedProvider,
		modelId,
		modelLabel,
		onModelChange,
		onPlanModeChange,
		onStop,
		onSubmit,
		onThinkingChange,
		planMode,
		workspaceCwd: workspaceCwd ?? '',
		thinkingLabel: thinkingLabelText,
		thinkingLevel,
		workspaceFiles: workspaceFiles ?? [],
	};

	if (setupError) {
		return {
			...base,
			disabled: true,
			disabledReason: setupError,
			placeholder: 'Resolve setup diagnostics before starting an agent turn.',
		};
	}

	if (!setupDiagnostics) {
		return {
			...base,
			disabled: true,
			disabledReason: 'Ensemblr is still checking setup readiness.',
			placeholder: 'Setup checks are still loading.',
		};
	}

	if (setupDiagnostics.status !== 'ready') {
		return {
			...base,
			disabled: true,
			disabledReason: `${setupDiagnostics.blockedCount} required setup checks need attention.`,
			placeholder: 'Fix setup blockers before sending a prompt.',
		};
	}

	return {
		...base,
		disabled: false,
		disabledReason: null,
		placeholder: planMode
			? 'Describe what you want built — the agent will plan it with you before touching any files'
			: `Ask the agent to continue ${activeSession.label.toLowerCase()}`,
	};
}
