import { useQuery } from '@tanstack/react-query';
import { useAtom, useStore } from 'jotai';
import { useCallback } from 'react';

import { agentSessionsForWorkspaceQuery } from '@/renderer/api/ensemblr-queries';
import { useAgentTurns } from '@/renderer/state/composer/agent-turns';
import { useComposerModelSelection } from '@/renderer/state/composer/composer-model-selection';
import { useLiveSessionUsage } from '@/renderer/state/composer/session-usage';
import {
	chatAfkModeAtomFamily,
	chatLinkedDirectoriesAtomFamily,
	chatPlanModeAtomFamily,
} from '@/renderer/state/preferences';
import type {
	ComposerContextUsage,
	ComposerModelOption,
	ComposerPlanUsage,
	ComposerSubmitOutcome,
	ComposerThinkingOption,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';
import type { PiStreamingBehavior } from '@/shared/ipc/contracts/agent-session';

/** State and callbacks the agent composer controller exposes to the composer UI. */
export interface AgentComposerControllerState {
	activeSessionId: string | null;
	availableModels: readonly ComposerModelOption[];
	availableThinkingLevels: readonly ComposerThinkingOption[];
	contextUsage: ComposerContextUsage | null;
	isStreaming: boolean;
	lastError: string | null;
	/**
	 * Agent runtime this chat is pinned to, or `null` while it is still new and
	 * every model is fair game. A chat pins on its first session and stays pinned.
	 */
	lockedProvider: AgentProviderId | null;
	/**
	 * This chat's session while a runtime child is actually attached to it, and
	 * `null` otherwise. {@link AgentComposerControllerState.activeSessionId} names
	 * the persisted session whether or not anything is running behind it, so a
	 * control that has to reach the live runtime — asking it to re-read the plan —
	 * reads this instead and offers itself only when there is something to ask.
	 */
	liveSessionId: string | null;
	modelId: string | null;
	onModelChange: (modelId: string) => void;
	onPlanModeChange: (planMode: boolean) => void;
	/** Switching AFK on switches Plan Mode off; the two are mutually exclusive. */
	onAfkModeChange: (afkMode: boolean) => void;
	onStop: () => Promise<void>;
	onSubmit: (
		prompt: string,
		options?: { streamingBehavior?: PiStreamingBehavior },
	) => Promise<ComposerSubmitOutcome>;
	onThinkingChange: (thinkingLevel: string) => void;
	planMode: boolean;
	/**
	 * Whether the user has stepped away from this chat: the agent decides for
	 * itself rather than asking, and the confirmations it would otherwise raise
	 * are approved on their behalf.
	 */
	afkMode: boolean;
	/** Plan windows and running cost this chat's session has reported. */
	planUsage: ComposerPlanUsage | null;
	thinkingLevel: string | null;
}

/**
 * Wires the composer UI to the main-process agent session service. Owns local
 * state for selected model, thinking level, and the active session, derives
 * streaming state from the persisted agent status, and exposes async submit/stop
 * callbacks suitable for `ComposerShellState`. Per-tab binding: the controller
 * scopes its active session lookup to `currentAgentSessionId`, and binds a
 * newly-opened agent session to `chatTabId` on first submit.
 */
export function useAgentComposerController({
	chatTabId,
	currentAgentSessionId,
	isResolvingChatTab = false,
	masterPrompt = '',
	workspaceCwd,
	workspaceId,
}: {
	chatTabId: string;
	currentAgentSessionId: string | null;
	/**
	 * True while the routed tab id has no row in the tab list yet, so `chatTabId`
	 * names a real tab whose session has not loaded. Submitting then would read as
	 * a fresh chat and open a second session over the one the tab already owns.
	 */
	isResolvingChatTab?: boolean;
	/** Repository `general` preferences prepended to the first message of a new chat. */
	masterPrompt?: string;
	workspaceCwd: string;
	workspaceId: string;
}): AgentComposerControllerState {
	const { data: sessionsData } = useQuery(
		agentSessionsForWorkspaceQuery(workspaceId),
	);

	const [planMode, setPlanMode] = useAtom(chatPlanModeAtomFamily(chatTabId));
	const [afkMode, setAfkMode] = useAtom(chatAfkModeAtomFamily(chatTabId));
	const store = useStore();
	/**
	 * Builds the Plan Mode half of a turn snapshot, reading the store at call time.
	 * Approving a plan turns the toggle off and submits in the same tick, and a
	 * render-scope read would still hold `true` on the very turn meant to start
	 * implementing.
	 *
	 * Omits the field entirely when the user has never decided for this tab, so main
	 * keeps whatever it already holds. A spawned child inherits Plan Mode through the
	 * control layer, and sending `false` for "no opinion" would clear it.
	 * @returns The `planMode` field to spread into the request, or nothing.
	 */
	const planModeRequest = useCallback((): { planMode?: boolean } => {
		const decided = store.get(chatPlanModeAtomFamily(chatTabId));
		return decided === null ? {} : { planMode: decided };
	}, [chatTabId, store]);

	/**
	 * Builds the AFK half of a turn snapshot, reading the store at call time and
	 * omitting the field when the user has never decided, for both the reasons
	 * {@link planModeRequest} does. Switching the chip submits in the same tick,
	 * and a child that inherited AFK from an unattended parent must not be
	 * cleared by a request that states no opinion.
	 * @returns The `afkMode` field to spread into the request, or nothing.
	 */
	const afkModeRequest = useCallback((): { afkMode?: boolean } => {
		const decided = store.get(chatAfkModeAtomFamily(chatTabId));
		return decided === null ? {} : { afkMode: decided };
	}, [chatTabId, store]);

	/**
	 * Reads the chat's linked directories at call time, matching
	 * {@link planModeRequest}: a session opens after an await, and a render-scope
	 * read would launch the runtime with whatever set was current a tick earlier.
	 * @returns The absolute paths to grant the opening session.
	 */
	const linkedDirectoriesRequest = useCallback(
		(): readonly string[] =>
			store
				.get(chatLinkedDirectoriesAtomFamily(chatTabId))
				.map((directory) => directory.path),
		[chatTabId, store],
	);

	const persistedActiveSession = sessionsData?.sessions.find(
		(session) => session.id === currentAgentSessionId,
	);

	const {
		availableModels,
		availableThinkingLevels,
		modelId,
		setChatModelOverride,
		setChatThinkingOverride,
		thinkingLevel,
	} = useComposerModelSelection({ chatTabId, persistedActiveSession });

	const { activeSessionId, hasInFlightTurn, lastError, onStop, onSubmit } =
		useAgentTurns({
			chatTabId,
			isResolvingChatTab,
			linkedDirectoriesRequest,
			masterPrompt,
			modelId,
			persistedActiveSession,
			planModeRequest,
			afkModeRequest,
			thinkingLevel,
			workspaceCwd,
			workspaceId,
		});

	const activeSessionSnapshot = sessionsData?.sessions.find(
		(session) => session.id === activeSessionId,
	);
	const activeSessionStatus = activeSessionSnapshot?.status;
	const lockedProvider = resolveLockedProvider({
		activeSessionId,
		selectedModelProvider: availableModels.find(
			(option) => option.id === modelId,
		)?.agentProvider,
		sessionProvider: activeSessionSnapshot?.provider,
	});
	const { contextUsage, planUsage } = useLiveSessionUsage({
		activeSessionId,
		branchId: activeSessionSnapshot?.branchId ?? '',
		model: availableModels.find((option) => option.id === modelId),
		workspaceId,
	});
	const isRuntimeOpen = activeSessionSnapshot?.runtimeOpen === true;
	const isAgentSessionStreaming =
		isRuntimeOpen &&
		(activeSessionStatus === 'starting' || activeSessionStatus === 'streaming');

	const onModelChange = useCallback(
		(nextModelId: string) => {
			setChatModelOverride(nextModelId);
		},
		[setChatModelOverride],
	);

	const onThinkingChange = useCallback(
		(nextThinkingLevel: string) => {
			setChatThinkingOverride(nextThinkingLevel);
		},
		[setChatThinkingOverride],
	);

	const onPlanModeChange = useCallback(
		(nextPlanMode: boolean) => {
			setPlanMode(nextPlanMode);
			if (nextPlanMode) {
				setAfkMode(false);
			}
		},
		[setAfkMode, setPlanMode],
	);

	const onAfkModeChange = useCallback(
		(nextAfkMode: boolean) => {
			setAfkMode(nextAfkMode);
			if (nextAfkMode) {
				setPlanMode(false);
			}
		},
		[setAfkMode, setPlanMode],
	);

	return {
		activeSessionId,
		availableModels,
		availableThinkingLevels,
		contextUsage,
		isStreaming: isAgentSessionStreaming || hasInFlightTurn,
		lastError,
		liveSessionId: isRuntimeOpen ? activeSessionId : null,
		lockedProvider,
		modelId,
		onAfkModeChange,
		onModelChange,
		onPlanModeChange,
		onStop,
		onSubmit,
		onThinkingChange,
		afkMode: afkMode === true,
		planMode: planMode === true,
		planUsage,
		thinkingLevel,
	};
}

/**
 * Resolves the agent runtime a chat is pinned to. A chat with no session is
 * unpinned and may still choose any model; once a session exists the snapshot
 * names the runtime. That snapshot only lands on the refetch that follows
 * `openAgentSession`, so until it arrives the model that opened the session
 * stands in — otherwise the picker would stay unlocked for a beat after the
 * first submit.
 * @param activeSessionId - Id of the chat's session, or null while it is new.
 * @param selectedModelProvider - Runtime of the model the composer has selected.
 * @param sessionProvider - Runtime recorded on the session snapshot, once loaded.
 * @returns The pinned runtime, or null while the chat is still new.
 */
function resolveLockedProvider({
	activeSessionId,
	selectedModelProvider,
	sessionProvider,
}: {
	activeSessionId: string | null;
	selectedModelProvider: AgentProviderId | undefined;
	sessionProvider: AgentProviderId | undefined;
}): AgentProviderId | null {
	if (activeSessionId === null) {
		return null;
	}
	return sessionProvider ?? selectedModelProvider ?? null;
}
