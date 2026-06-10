import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
	ensembleQueryKeys,
	openPiSession,
	piModelsQuery,
	piSessionEventsQuery,
	piSessionsForWorkspaceQuery,
	stopPiSession,
	submitPiPrompt,
	subscribePiSessionEvents,
} from '@/renderer/api/ensemble-queries';
import { useOptimisticPrompts } from '@/renderer/state/optimistic-prompts';
import {
	lastSelectedPiModelAtom,
	lastSelectedPiThinkingLevelAtom,
} from '@/renderer/state/preferences';
import type {
	ComposerContextUsage,
	ComposerModelOption,
	ComposerThinkingOption,
} from '@/renderer/types/workbench';

export interface PiComposerControllerState {
	activeSessionId: string | null;
	availableModels: readonly ComposerModelOption[];
	availableThinkingLevels: readonly ComposerThinkingOption[];
	contextUsage: ComposerContextUsage | null;
	isStreaming: boolean;
	lastError: string | null;
	modelId: string | null;
	onModelChange: (modelId: string) => void;
	onStop: () => Promise<void>;
	onSubmit: (prompt: string) => Promise<void>;
	onThinkingChange: (thinkingLevel: string) => void;
	thinkingLevel: string | null;
}

const THINKING_LABELS: Record<string, string> = {
	high: 'High',
	low: 'Low',
	medium: 'Medium',
	minimal: 'Minimal',
	off: 'Off',
	xhigh: 'Extra high',
};

/**
 * Canonical pi thinking levels (matches `ThinkingLevel` in
 * `@earendil-works/pi-agent-core`). Hard-coded so the picker doesn't depend
 * on `pi --list-models` reporting per-model levels — pi accepts any of these
 * via `--thinking` and the RPC `set_thinking_level` command.
 */
const PI_THINKING_LEVELS = [
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
] as const;

/** Locally tracks the Pi session opened for one chat tab before refetch lands. */
interface PendingTabSession {
	chatTabId: string;
	sessionId: string;
}

/**
 * Wires the Pi composer UI to the main-process Pi session service. Owns local
 * state for selected model, thinking level, and the active session, derives
 * streaming state from persisted Pi status, and exposes async submit/stop
 * callbacks suitable for `ComposerShellState`. Per-tab binding: the controller
 * scopes its active Pi session lookup to `currentPiSessionId`, and binds a
 * newly-opened Pi session to `chatTabId` on first submit.
 */
export function usePiComposerController({
	chatTabId,
	currentPiSessionId,
	workspaceCwd,
	workspaceId,
}: {
	chatTabId: string;
	currentPiSessionId: string | null;
	workspaceCwd: string;
	workspaceId: string;
}): PiComposerControllerState {
	const queryClient = useQueryClient();
	const modelsQuery = useQuery(piModelsQuery);
	const sessionsQuery = useQuery(piSessionsForWorkspaceQuery(workspaceId));

	const [selectedModelId, setSelectedModelId] = useAtom(
		lastSelectedPiModelAtom,
	);
	const [selectedThinkingLevel, setSelectedThinkingLevel] = useAtom(
		lastSelectedPiThinkingLevelAtom,
	);
	const [lastError, setLastError] = useState<string | null>(null);
	const [pendingSession, setPendingSession] =
		useState<PendingTabSession | null>(null);
	const [liveContextUsage, setLiveContextUsage] = useState<{
		sessionId: string;
		usage: ComposerContextUsage;
	} | null>(null);

	const models = modelsQuery.data;
	const availableModels = useMemo<readonly ComposerModelOption[]>(() => {
		if (!models) {
			return [];
		}
		return models.models.map((model) => ({
			displayName: model.displayName,
			id: model.id,
			isDefault: model.id === models.defaultModelId,
			provider: model.provider,
		}));
	}, [models]);

	const modelId =
		selectedModelId ?? models?.defaultModelId ?? availableModels[0]?.id ?? null;
	const thinkingLevel =
		selectedThinkingLevel ?? models?.defaultThinkingLevel ?? null;

	const availableThinkingLevels = useMemo<
		readonly ComposerThinkingOption[]
	>(() => {
		const selectedModel = models?.models.find((model) => model.id === modelId);
		const supplied = selectedModel?.thinkingLevels ?? [];
		// Prefer pi's per-model list when it covers the canonical 6 levels; fall
		// back to the hard-coded canonical list so the picker works even when
		// `pi --list-models` doesn't enumerate them.
		const levels =
			supplied.length >= PI_THINKING_LEVELS.length
				? supplied
				: PI_THINKING_LEVELS;
		return levels.map((level) => ({
			id: level,
			label: THINKING_LABELS[level] ?? level,
		}));
	}, [models, modelId]);

	const persistedActiveSession = sessionsQuery.data?.sessions.find(
		(session) => session.id === currentPiSessionId,
	);
	const pendingSessionId =
		pendingSession?.chatTabId === chatTabId ? pendingSession.sessionId : null;
	const activeSessionId = persistedActiveSession?.id ?? pendingSessionId;
	const activeSessionSnapshot = sessionsQuery.data?.sessions.find(
		(session) => session.id === activeSessionId,
	);
	const activeSessionStatus = activeSessionSnapshot?.status;
	const activeBranchId = activeSessionSnapshot?.branchId ?? '';
	const contextEventsQuery = useQuery(piSessionEventsQuery(activeBranchId));
	const persistedContextUsage = useMemo(
		() => latestContextUsageFromEvents(contextEventsQuery.data?.events ?? []),
		[contextEventsQuery.data?.events],
	);
	// Live usage is tagged by session id; a stale snapshot from a previous
	// session is treated as absent so the gauge falls back to persisted state
	// without needing a reset-on-change effect.
	const contextUsage =
		liveContextUsage && liveContextUsage.sessionId === activeSessionId
			? liveContextUsage.usage
			: persistedContextUsage;
	const isPiSessionStreaming =
		activeSessionSnapshot?.runtimeOpen === true &&
		(activeSessionStatus === 'starting' || activeSessionStatus === 'streaming');

	useEffect(() => {
		const unsubscribe = subscribePiSessionEvents((broadcast) => {
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
						queryKey: ensembleQueryKeys.piSessionEvents(
							broadcast.event.branchId,
						),
					});
				}
				return;
			}
			if (broadcast.event.eventType === 'metadata') {
				if (hasChatTitleMetadata(broadcast.event.payload)) {
					void queryClient.invalidateQueries({
						queryKey: ensembleQueryKeys.chatTabs(workspaceId),
					});
				}
				return;
			}
			if (broadcast.event.eventType !== 'status') {
				return;
			}
			void queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.piSessionsForWorkspace(workspaceId),
			});
		});
		return unsubscribe;
	}, [activeSessionId, queryClient, workspaceId]);

	const openSessionMutation = useMutation({
		mutationFn: (input: {
			initialPrompt: string | null;
			resumeSessionId?: string | null;
		}) =>
			openPiSession({
				chatTabId,
				initialPrompt: input.initialPrompt,
				model: modelId,
				resumeSessionId: input.resumeSessionId ?? null,
				thinkingLevel,
				workspaceCwd,
				workspaceId,
			}),
		onSuccess: (result) => {
			if (result.session) {
				setPendingSession({ chatTabId, sessionId: result.session.id });
				void queryClient.invalidateQueries({
					queryKey: ensembleQueryKeys.piSessionsForWorkspace(workspaceId),
				});
				void queryClient.invalidateQueries({
					queryKey: ensembleQueryKeys.chatTabs(workspaceId),
				});
			}
		},
	});

	const submitMutation = useMutation({
		mutationFn: (input: { prompt: string; sessionId: string }) =>
			submitPiPrompt({
				model: modelId,
				prompt: input.prompt,
				sessionId: input.sessionId,
				thinkingLevel,
			}),
	});

	const stopMutation = useMutation({
		mutationFn: (sessionId: string) => stopPiSession({ sessionId }),
		onSuccess: () => {
			setPendingSession(null);
			void queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.piSessionsForWorkspace(workspaceId),
			});
		},
	});

	const isRealChatTabId = !chatTabId.endsWith(':overview');
	const optimistic = useOptimisticPrompts(chatTabId);

	const onSubmit = useCallback(
		async (prompt: string): Promise<void> => {
			const trimmed = prompt.trim();
			if (!trimmed) {
				return;
			}
			if (!isRealChatTabId) {
				setLastError(
					'Workspace chat tab is still initializing. Try again in a moment.',
				);
				return;
			}
			setLastError(null);

			// Render the user prompt instantly. The Timeline removes this entry as
			// soon as a matching persisted user-message event lands so we don't
			// double-render once the runtime echoes the prompt back.
			const optimisticEntry = optimistic.push(trimmed);

			let sessionId = activeSessionId;
			const needsRuntimeResume =
				persistedActiveSession !== undefined &&
				!persistedActiveSession.runtimeOpen;
			if (!sessionId || needsRuntimeResume) {
				const opened = await openSessionMutation.mutateAsync({
					initialPrompt: sessionId ? null : trimmed,
					resumeSessionId: sessionId,
				});
				if (opened.error) {
					setLastError(opened.error);
					optimistic.remove(optimisticEntry.id);
					return;
				}
				sessionId = opened.session?.id ?? null;
			}
			if (!sessionId) {
				setLastError('Unable to open a Pi session.');
				optimistic.remove(optimisticEntry.id);
				return;
			}

			const result = await submitMutation.mutateAsync({
				prompt: trimmed,
				sessionId,
			});
			if (result.error) {
				setLastError(result.error);
				optimistic.remove(optimisticEntry.id);
			}
		},
		[
			activeSessionId,
			isRealChatTabId,
			openSessionMutation,
			optimistic,
			persistedActiveSession,
			submitMutation,
		],
	);

	const onStop = useCallback(async (): Promise<void> => {
		if (!activeSessionId) {
			return;
		}
		await stopMutation.mutateAsync(activeSessionId);
	}, [activeSessionId, stopMutation]);

	const onModelChange = useCallback(
		(nextModelId: string) => {
			setSelectedModelId(nextModelId);
		},
		[setSelectedModelId],
	);

	const onThinkingChange = useCallback(
		(nextThinkingLevel: string) => {
			setSelectedThinkingLevel(nextThinkingLevel);
		},
		[setSelectedThinkingLevel],
	);

	return {
		activeSessionId,
		availableModels,
		availableThinkingLevels,
		contextUsage,
		isStreaming:
			isPiSessionStreaming ||
			openSessionMutation.isPending ||
			submitMutation.isPending ||
			stopMutation.isPending,
		lastError,
		modelId,
		onModelChange,
		onStop,
		onSubmit,
		onThinkingChange,
		thinkingLevel,
	};
}

/** Finds the newest persisted context usage event for the active session. */
function latestContextUsageFromEvents(
	events: readonly import('@/shared/ipc').PiSessionEventWire[],
): ComposerContextUsage | null {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const payload = events[index]?.payload;
		if (payload?.kind === 'context-usage') {
			return toComposerContextUsage(payload.usage);
		}
	}
	return null;
}

/** Converts Pi's usage wire payload into the composer meter model. */
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
function hasChatTitleMetadata(
	payload: import('@/shared/ipc').PiPersistedEnvelope | null,
): boolean {
	if (payload?.kind !== 'metadata') {
		return false;
	}
	return typeof payload.metadata.chatTitle === 'string';
}
