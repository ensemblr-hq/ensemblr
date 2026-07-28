import type {
	ComposerContextUsage,
	ComposerModelOption,
	ComposerShellState,
	ComposerThinkingOption,
	SessionTabModel,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc/contracts/setup';

/**
 * Computes the composer shell state from setup readiness, the active session,
 * and a Pi controller. Disables the composer when setup is not yet ready or
 * Pi runtime checks fail.
 */
export function getComposerState({
	activeSession,
	activePiSessionId,
	availableModels,
	availableThinkingLevels,
	contextUsage,
	isStreaming,
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
	activePiSessionId: string | null;
	activeSession: SessionTabModel;
	availableModels: readonly ComposerModelOption[];
	availableThinkingLevels: readonly ComposerThinkingOption[];
	contextUsage?: ComposerContextUsage | null;
	isStreaming: boolean;
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
		'Pi model pending';
	const thinkingLabelText =
		availableThinkingLevels.find((option) => option.id === thinkingLevel)
			?.label ?? 'Thinking pending';

	const base = {
		activePiSessionId,
		availableModels,
		availableThinkingLevels,
		contextUsage: contextUsage ?? null,
		isStreaming,
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
			placeholder: 'Resolve setup diagnostics before starting a Pi turn.',
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
			? 'Describe what you want built — Pi will plan it with you before touching any files'
			: `Ask Pi to continue ${activeSession.label.toLowerCase()}`,
	};
}
