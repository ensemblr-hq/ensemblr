import { useQuery } from '@tanstack/react-query';
import { useAtom, useStore } from 'jotai';
import { useCallback, useMemo, useState } from 'react';

import {
	agentSessionEventsQuery,
	agentSessionsForWorkspaceQuery,
} from '@/renderer/api/ensemblr-queries';
import {
	type TaggedContextUsage,
	toComposerContextUsage,
	useAgentSessionEventSync,
} from '@/renderer/state/composer/agent-session-event-sync';
import { useAgentTurns } from '@/renderer/state/composer/agent-turns';
import { useComposerModelSelection } from '@/renderer/state/composer/composer-model-selection';
import { chatPlanModeAtomFamily } from '@/renderer/state/preferences';
import type {
	ComposerContextUsage,
	ComposerModelOption,
	ComposerThinkingOption,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';
import type {
	AgentSessionEventWire,
	PiStreamingBehavior,
} from '@/shared/ipc/contracts/agent-session';

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
	modelId: string | null;
	onModelChange: (modelId: string) => void;
	onPlanModeChange: (planMode: boolean) => void;
	onStop: () => Promise<void>;
	onSubmit: (
		prompt: string,
		options?: { streamingBehavior?: PiStreamingBehavior },
	) => Promise<void>;
	onThinkingChange: (thinkingLevel: string) => void;
	planMode: boolean;
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
	const store = useStore();
	const [liveContextUsage, setLiveContextUsage] =
		useState<TaggedContextUsage | null>(null);

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
			masterPrompt,
			modelId,
			persistedActiveSession,
			planModeRequest,
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
	const activeBranchId = activeSessionSnapshot?.branchId ?? '';
	const { data: contextEventsData } = useQuery(
		agentSessionEventsQuery(activeBranchId),
	);
	const persistedContextUsage = useMemo(
		() => latestContextUsageFromEvents(contextEventsData?.events ?? []),
		[contextEventsData?.events],
	);
	// Live usage is tagged by session id; a stale snapshot from a previous
	// session is treated as absent so the gauge falls back to persisted state
	// without needing a reset-on-change effect.
	const contextUsage =
		liveContextUsage && liveContextUsage.sessionId === activeSessionId
			? liveContextUsage.usage
			: persistedContextUsage;
	const isAgentSessionStreaming =
		activeSessionSnapshot?.runtimeOpen === true &&
		(activeSessionStatus === 'starting' || activeSessionStatus === 'streaming');

	useAgentSessionEventSync({
		activeSessionId,
		onContextUsage: setLiveContextUsage,
		workspaceId,
	});

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
		},
		[setPlanMode],
	);

	return {
		activeSessionId,
		availableModels,
		availableThinkingLevels,
		contextUsage,
		isStreaming: isAgentSessionStreaming || hasInFlightTurn,
		lastError,
		lockedProvider,
		modelId,
		onModelChange,
		onPlanModeChange,
		onStop,
		onSubmit,
		onThinkingChange,
		planMode: planMode === true,
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

/** Finds the newest persisted context usage event for the active session. */
function latestContextUsageFromEvents(
	events: readonly AgentSessionEventWire[],
): ComposerContextUsage | null {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const payload = events[index]?.payload;
		if (payload?.kind === 'context-usage') {
			return toComposerContextUsage(payload.usage);
		}
	}
	return null;
}
