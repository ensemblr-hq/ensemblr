import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom, useStore } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
	agentModelsQuery,
	agentSessionEventsQuery,
	agentSessionsForWorkspaceQuery,
	ensemblrQueryKeys,
	openAgentSession,
	stopAgentSession,
	submitAgentPrompt,
	subscribeAgentSessionEvents,
} from '@/renderer/api/ensemblr-queries';
import { wrapWithMasterPrompt } from '@/renderer/lib/workbench/action-prompts';
import { useInFlightTurns } from '@/renderer/state/composer/in-flight-turns';
import { useOptimisticPrompts } from '@/renderer/state/composer/optimistic-prompts';
import {
	chatModelOverrideAtomFamily,
	chatPlanModeAtomFamily,
	chatThinkingOverrideAtomFamily,
	defaultChatModelAtom,
	defaultChatThinkingLevelAtom,
} from '@/renderer/state/preferences';
import type {
	ComposerContextUsage,
	ComposerModelOption,
	ComposerThinkingOption,
} from '@/renderer/types/workbench';
import {
	type AgentProviderId,
	normalizeAgentProviderId,
} from '@/shared/agent-provider';
import {
	getThinkingLevelLabel,
	listThinkingLevels,
} from '@/shared/agent-thinking';
import type { AgentPersistedEnvelope } from '@/shared/ipc/contracts/agent-message-payloads';
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
 * Model, thinking level, and Plan Mode one turn is sent with, snapshotted when
 * the user fired it. Both requests of a first turn (open, then submit) carry the
 * same snapshot, so a tab switch while the runtime spawns cannot re-stamp the
 * second request with the newly-active tab's picks.
 */
interface AgentTurnOptions {
	model: string | null;
	planMode?: boolean;
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
	const queryClient = useQueryClient();
	const { data: models } = useQuery(agentModelsQuery);
	const { data: sessionsData } = useQuery(
		agentSessionsForWorkspaceQuery(workspaceId),
	);

	// Per-chat overrides win when set; otherwise a new chat inherits the
	// Settings → Default model/thinking. Keying the override atoms by chat-tab
	// id keeps one chat's pick from leaking into another.
	const [chatModelOverride, setChatModelOverride] = useAtom(
		chatModelOverrideAtomFamily(chatTabId),
	);
	const [chatThinkingOverride, setChatThinkingOverride] = useAtom(
		chatThinkingOverrideAtomFamily(chatTabId),
	);
	const [planMode, setPlanMode] = useAtom(chatPlanModeAtomFamily(chatTabId));
	const store = useStore();
	const [defaultModelId] = useAtom(defaultChatModelAtom);
	const [defaultThinkingLevel] = useAtom(defaultChatThinkingLevelAtom);
	const [lastError, setLastError] = useState<string | null>(null);
	// Sessions opened this mount, keyed by the tab that opened them, standing in
	// until the refetch lands. Keyed rather than a single slot so a second tab
	// starting a chat cannot erase the first tab's freshly-opened session.
	const [pendingSessionByTab, setPendingSessionByTab] = useState<
		Readonly<Record<string, string | undefined>>
	>({});
	const inFlight = useInFlightTurns();
	const [liveContextUsage, setLiveContextUsage] = useState<{
		sessionId: string;
		usage: ComposerContextUsage;
	} | null>(null);

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

	const availableModels = useMemo<readonly ComposerModelOption[]>(() => {
		if (!models) {
			return [];
		}
		return models.models.map((model) => ({
			agentProvider: normalizeAgentProviderId(model.agentProvider),
			displayName: model.displayName,
			id: model.id,
			isDefault: model.id === models.defaultModelId,
			provider: model.provider,
		}));
	}, [models]);

	const persistedActiveSession = sessionsData?.sessions.find(
		(session) => session.id === currentAgentSessionId,
	);

	// Resolution order: explicit per-chat pick → persisted session model →
	// Settings default → runtime-reported default → first available model. Existing
	// chats keep their session model when the default changes; only fresh chats
	// inherit the latest configured default.
	const modelId =
		chatModelOverride ??
		persistedActiveSession?.model ??
		defaultModelId ??
		models?.defaultModelId ??
		availableModels[0]?.id ??
		null;
	const thinkingLevel =
		chatThinkingOverride ??
		defaultThinkingLevel ??
		models?.defaultThinkingLevel ??
		null;

	const availableThinkingLevels = useMemo<
		readonly ComposerThinkingOption[]
	>(() => {
		const selectedModel = models?.models.find((model) => model.id === modelId);
		const provider = normalizeAgentProviderId(selectedModel?.agentProvider);
		// A model's own list is authoritative — Claude publishes exactly the efforts
		// it accepts, and offering one it would reject is worse than offering fewer.
		// The runtime's canonical ladder stands in only when nothing was published,
		// which is how a pi build that doesn't enumerate levels still gets a picker.
		const supplied = selectedModel?.thinkingLevels ?? [];
		const levels =
			supplied.length > 0 ? supplied : listThinkingLevels(provider);
		return levels.map((level) => ({
			id: level,
			label: getThinkingLevelLabel(provider, level),
		}));
	}, [models, modelId]);

	const pendingSessionId = pendingSessionByTab[chatTabId] ?? null;
	const activeSessionId = persistedActiveSession?.id ?? pendingSessionId;
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

	useEffect(() => {
		const unsubscribe = subscribeAgentSessionEvents((broadcast) => {
			if (broadcast.workspaceId !== workspaceId) {
				return;
			}
			if (activeSessionId && broadcast.sessionId !== activeSessionId) {
				return;
			}
			if (broadcast.event.eventType === 'context-usage') {
				const payload = broadcast.event.payload;
				if (payload?.kind === 'context-usage') {
					setLiveContextUsage({
						sessionId: broadcast.sessionId,
						usage: toComposerContextUsage(payload.usage),
					});
					void queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.agentSessionEvents(
							broadcast.event.branchId,
						),
					});
				}
				return;
			}
			if (broadcast.event.eventType === 'metadata') {
				if (hasChatTitleMetadata(broadcast.event.payload)) {
					void queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
					});
				}
				if (hasWorkspaceRenamedMetadata(broadcast.event.payload)) {
					void queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.repositoryWorkspaceNavigation(),
					});
				}
				return;
			}
			if (broadcast.event.eventType !== 'status') {
				return;
			}
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.agentSessionsForWorkspace(workspaceId),
			});
		});
		return unsubscribe;
	}, [activeSessionId, queryClient, workspaceId]);

	// Everything that identifies the turn — target tab, model, thinking level, Plan
	// Mode — rides in the mutation variables rather than being read from render
	// scope. TanStack rebuilds a mutation from the newest options at mutate time,
	// and a first turn submits only after awaiting its own `openAgentSession`, so a
	// render-scope read would stamp whichever tab the user switched to while the
	// agent process was still spawning.
	const openSessionMutation = useMutation({
		mutationFn: (input: {
			chatTabId: string;
			initialPrompt: string | null;
			resumeSessionId?: string | null;
			turn: AgentTurnOptions;
		}) =>
			openAgentSession({
				...input.turn,
				chatTabId: input.chatTabId,
				initialPrompt: input.initialPrompt,
				resumeSessionId: input.resumeSessionId ?? null,
				workspaceCwd,
				workspaceId,
			}),
		onSuccess: (result, variables) => {
			if (result.session) {
				const openedSessionId = result.session.id;
				setPendingSessionByTab((previous) => ({
					...previous,
					[variables.chatTabId]: openedSessionId,
				}));
				void queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.agentSessionsForWorkspace(workspaceId),
				});
				void queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
				});
			}
		},
	});

	const submitMutation = useMutation({
		mutationFn: (input: {
			prompt: string;
			sessionId: string;
			streamingBehavior?: PiStreamingBehavior;
			turn: AgentTurnOptions;
		}) =>
			submitAgentPrompt({
				...input.turn,
				prompt: input.prompt,
				sessionId: input.sessionId,
				streamingBehavior: input.streamingBehavior,
			}),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.agentSessionsForWorkspace(workspaceId),
			}),
	});

	const stopMutation = useMutation({
		mutationFn: (sessionId: string) => stopAgentSession({ sessionId }),
		onSuccess: (_result, sessionId) => {
			setPendingSessionByTab((previous) =>
				Object.fromEntries(
					Object.entries(previous).filter(([, id]) => id !== sessionId),
				),
			);
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.agentSessionsForWorkspace(workspaceId),
			});
		},
	});

	const isRealChatTabId = !chatTabId.endsWith(':overview');
	const optimistic = useOptimisticPrompts(chatTabId);

	const onSubmit = useCallback(
		async (
			prompt: string,
			options?: { streamingBehavior?: PiStreamingBehavior },
		): Promise<void> => {
			const trimmed = prompt.trim();
			if (!trimmed) {
				return;
			}
			if (!isRealChatTabId || isResolvingChatTab) {
				setLastError(
					'Workspace chat tab is still initializing. Try again in a moment.',
				);
				return;
			}
			setLastError(null);
			const turn: AgentTurnOptions = {
				model: modelId,
				...planModeRequest(),
				thinkingLevel,
			};

			// Prepend the repository's `general` master prompt to the very first
			// message of a fresh chat only. It is agent-only context: the timeline
			// strips the `<user_preferences>` block from what it renders (see
			// `parsePromptAttachments`), so it never shows on the FE. The session's
			// initialPrompt (used for title/branch naming) stays clean.
			const isFirstMessage = !activeSessionId;
			const promptToSend = isFirstMessage
				? wrapWithMasterPrompt(masterPrompt, trimmed)
				: trimmed;

			// Render the submitted prompt instantly. The Timeline removes this entry
			// once the matching persisted user-message lands, so it must be the exact
			// text sent (master prompt included) or optimistic and persisted entries
			// won't match and both render.
			const optimisticEntry = optimistic.push(promptToSend);

			let sessionId = activeSessionId;
			const needsRuntimeResume =
				persistedActiveSession !== undefined &&
				!persistedActiveSession.runtimeOpen;
			if (!sessionId || needsRuntimeResume) {
				const opened = await inFlight.track(chatTabId, () =>
					openSessionMutation.mutateAsync({
						chatTabId,
						initialPrompt: sessionId ? null : trimmed,
						resumeSessionId: sessionId,
						turn,
					}),
				);
				if (opened.error) {
					setLastError(opened.error);
					optimistic.remove(optimisticEntry.id);
					return;
				}
				sessionId = opened.session?.id ?? null;
			}
			if (!sessionId) {
				setLastError('Unable to open an agent session.');
				optimistic.remove(optimisticEntry.id);
				return;
			}

			const turnSessionId = sessionId;
			const result = await inFlight.track(turnSessionId, () =>
				submitMutation.mutateAsync({
					prompt: promptToSend,
					sessionId: turnSessionId,
					streamingBehavior: options?.streamingBehavior,
					turn,
				}),
			);
			if (result.error) {
				setLastError(result.error);
				optimistic.remove(optimisticEntry.id);
			}
		},
		[
			activeSessionId,
			chatTabId,
			inFlight,
			isRealChatTabId,
			isResolvingChatTab,
			masterPrompt,
			modelId,
			openSessionMutation,
			optimistic,
			persistedActiveSession,
			planModeRequest,
			submitMutation,
			thinkingLevel,
		],
	);

	const onStop = useCallback(async (): Promise<void> => {
		if (!activeSessionId) {
			return;
		}
		await inFlight.track(activeSessionId, () =>
			stopMutation.mutateAsync(activeSessionId),
		);
	}, [activeSessionId, inFlight, stopMutation]);

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

	// One controller instance serves whichever tab is active, so a shared mutation's
	// own pending flag would report a sibling's turn as this tab's. The in-flight
	// set is keyed by tab (a session still spawning) and by session (a turn or a
	// stop already under way), so several tabs can run turns independently.
	const hasInFlightTurn =
		inFlight.isBusy(chatTabId) || inFlight.isBusy(activeSessionId);

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

/** Converts the runtime's usage wire payload into the composer meter model. */
function toComposerContextUsage(usage: {
	contextWindow: number;
	percent: number | null;
	tokens: number | null;
}): ComposerContextUsage {
	const maxTokens = Math.max(0, usage.contextWindow);
	const usedTokens =
		usage.tokens ??
		(usage.percent === null
			? 0
			: Math.round(maxTokens * (usage.percent / 100)));
	return {
		maxTokens,
		usedTokens,
	};
}

/** Detects the metadata event emitted when the main process finishes tab titling. */
function hasChatTitleMetadata(payload: AgentPersistedEnvelope | null): boolean {
	if (payload?.kind !== 'metadata') {
		return false;
	}
	return typeof payload.metadata.chatTitle === 'string';
}

/** Detects the metadata event emitted after an auto branch-naming rename. */
function hasWorkspaceRenamedMetadata(
	payload: AgentPersistedEnvelope | null,
): boolean {
	if (payload?.kind !== 'metadata') {
		return false;
	}
	return payload.metadata.workspaceRenamed === true;
}
