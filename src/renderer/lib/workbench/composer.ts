import { i18n } from '@/renderer/lib/i18n';
import type { FollowUpBehavior } from '@/renderer/state/preferences';
import type {
	ComposerContextUsage,
	ComposerModelOption,
	ComposerPlanUsage,
	ComposerSendIntent,
	ComposerShellState,
	ComposerSubmitOutcome,
	ComposerThinkingOption,
	SessionTabModel,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import {
	type AgentProviderId,
	normalizeAgentProviderId,
} from '@/shared/agent-provider';
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
 * The usage the gauge should render. A reading measured on the chat's own
 * session always wins; with none yet — a chat that has never run a turn, or one
 * whose first turn is still in flight — the selected model's published window
 * stands in at zero occupancy, so the gauge shows a real denominator instead of
 * claiming the window is unknown.
 * @param measured - Usage the runtime has reported for this chat, if any.
 * @param selectedModel - The model the composer would submit with.
 * @returns The usage to render, or null when no window is known at all.
 */
export function resolveContextUsage(
	measured: ComposerContextUsage | null,
	selectedModel: ComposerModelOption | undefined,
): ComposerContextUsage | null {
	if (measured) {
		return measured;
	}
	const contextWindow = selectedModel?.contextWindow ?? 0;
	return contextWindow > 0 ? { maxTokens: contextWindow, usedTokens: 0 } : null;
}

/**
 * Decides whether the context gauge is worth showing. Context alone is noise at
 * low usage, so by default it appears only past 70% of the window; the setting
 * forces it on. Plan usage overrides both — a session's spend against its plan
 * is the popover's other half and has nowhere else to surface, so once a runtime
 * has reported any the control has to be reachable.
 * @param composer - Composer shell state carrying the current usage.
 * @param alwaysShow - The user's always-show-context preference.
 * @returns True when the gauge should render.
 */
export function showContextIndicator(
	composer: ComposerShellState,
	alwaysShow: boolean,
): boolean {
	const plan = composer.planUsage;
	if (plan && (plan.limits.length > 0 || plan.totalCostUsd !== null)) {
		return true;
	}
	const usage = composer.contextUsage;
	if (!usage || usage.maxTokens <= 0) {
		return alwaysShow;
	}
	return alwaysShow || (usage.usedTokens / usage.maxTokens) * 100 > 70;
}

/**
 * Which agent runtime the composer's chips should speak for. A chat with a
 * session is pinned and that pin wins; a new chat has no pin, so the selected
 * model's runtime stands in — it is the one a submit would start.
 * @param composer - Composer shell state carrying the pin and the selection.
 * @returns The active runtime, defaulting to pi before either is known.
 */
export function resolveComposerProvider(
	composer: ComposerShellState,
): AgentProviderId {
	return normalizeAgentProviderId(
		composer.lockedProvider ??
			composer.availableModels.find((option) => option.id === composer.modelId)
				?.agentProvider,
	);
}

/**
 * What the composer invites, keyed off what the chat *is* rather than what it is
 * called. The chat's own title used to be interpolated in here, which restated
 * the tab label the user is already looking at, grew with it, and said nothing
 * about what to type.
 * @param planMode - Whether the next turn plans instead of editing.
 * @param hasStarted - Whether the chat has already run a turn.
 * @returns The placeholder to render.
 */
function getReadyPlaceholder(planMode: boolean, hasStarted: boolean): string {
	if (planMode) {
		return i18n.t(
			'workbench:composer.plan-mode.placeholder',
			'Describe what you want planned',
		);
	}
	if (hasStarted) {
		return i18n.t(
			'workbench:composer.follow-up.placeholder',
			'Send a follow-up',
		);
	}
	return i18n.t(
		'workbench:composer.placeholder',
		'Ask to make changes, @mention files, run /commands',
	);
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
	liveAgentSessionId,
	lockedProvider,
	modelId,
	onModelChange,
	onPlanModeChange,
	onStop,
	onSubmit,
	onThinkingChange,
	planMode,
	planUsage,
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
	liveAgentSessionId?: string | null;
	lockedProvider: AgentProviderId | null;
	modelId: string | null;
	onModelChange: (modelId: string) => void;
	onPlanModeChange: (planMode: boolean) => void;
	onStop: () => Promise<void> | void;
	onSubmit: (
		prompt: string,
		options?: { streamingBehavior?: 'steer' | 'followUp' },
	) => Promise<ComposerSubmitOutcome>;
	onThinkingChange: (thinkingLevel: string) => void;
	planMode: boolean;
	planUsage?: ComposerPlanUsage | null;
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	setupError: string | null;
	thinkingLevel: string | null;
	workspaceCwd?: string;
	workspaceFiles?: readonly WorkspaceFileSummary[];
}): ComposerShellState {
	const modelLabel =
		availableModels.find((option) => option.id === modelId)?.displayName ??
		i18n.t('workbench:composer.model.pending', 'Model pending');
	const thinkingLabelText =
		availableThinkingLevels.find((option) => option.id === thinkingLevel)
			?.label ??
		i18n.t('workbench:composer.thinking.pending', 'Thinking pending');

	const base = {
		activeAgentSessionId,
		availableModels,
		availableThinkingLevels,
		contextUsage: contextUsage ?? null,
		isStreaming,
		liveAgentSessionId: liveAgentSessionId ?? null,
		lockedProvider,
		modelId,
		modelLabel,
		onModelChange,
		onPlanModeChange,
		onStop,
		onSubmit,
		onThinkingChange,
		planMode,
		planUsage: planUsage ?? null,
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
			placeholder: i18n.t(
				'workbench:composer.setup-error.placeholder',
				'Resolve setup diagnostics before starting an agent turn.',
			),
		};
	}

	if (!setupDiagnostics) {
		return {
			...base,
			disabled: true,
			disabledReason: i18n.t(
				'workbench:composer.setup-loading.reason',
				'Ensemblr is still checking setup readiness.',
			),
			placeholder: i18n.t(
				'workbench:composer.setup-loading.placeholder',
				'Setup checks are still loading.',
			),
		};
	}

	if (setupDiagnostics.status !== 'ready') {
		return {
			...base,
			disabled: true,
			disabledReason: i18n.t('workbench:composer.setup-blocked.reason', {
				count: setupDiagnostics.blockedCount,
				defaultValue_one: '{{count}} required setup check needs attention.',
				defaultValue_other: '{{count}} required setup checks need attention.',
			}),
			placeholder: i18n.t(
				'workbench:composer.setup-blocked.placeholder',
				'Fix setup blockers before sending a prompt.',
			),
		};
	}

	return {
		...base,
		disabled: false,
		disabledReason: null,
		placeholder: getReadyPlaceholder(
			planMode,
			Boolean(activeAgentSessionId ?? activeSession.agentSessionId),
		),
	};
}

/**
 * Resolves what pressing Send would do, given the behavior and whether a turn is
 * running. Derived per render rather than latched: the flag this replaces went
 * stale the moment a turn ended and survived a switch onto an idle tab.
 * @param behavior - The Follow-up behavior setting
 * @param isStreaming - Whether the agent is mid-turn
 * @returns Where the next send goes
 */
export function resolveSendIntent(
	behavior: FollowUpBehavior,
	isStreaming: boolean,
): ComposerSendIntent {
	if (!isStreaming || behavior === 'steer') {
		return 'send';
	}
	return behavior === 'block' ? 'hold' : 'queue';
}
