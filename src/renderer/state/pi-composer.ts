import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
	ensembleQueryKeys,
	openPiSession,
	piModelsQuery,
	piSessionsForWorkspaceQuery,
	stopPiSession,
	submitPiPrompt,
	subscribePiSessionEvents,
} from '@/renderer/api/ensemble-queries';
import {
	selectedPiModelByWorkspaceAtom,
	selectedPiThinkingLevelByWorkspaceAtom,
} from '@/renderer/state/workspace';
import type {
	ComposerModelOption,
	ComposerThinkingOption,
} from '@/renderer/types/workbench';

export interface PiComposerControllerState {
	activeSessionId: string | null;
	availableModels: readonly ComposerModelOption[];
	availableThinkingLevels: readonly ComposerThinkingOption[];
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
	off: 'Off',
};

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

	const [selectedModelByWorkspace, setSelectedModelByWorkspace] = useAtom(
		selectedPiModelByWorkspaceAtom,
	);
	const [selectedThinkingByWorkspace, setSelectedThinkingByWorkspace] = useAtom(
		selectedPiThinkingLevelByWorkspaceAtom,
	);
	const selectedModelId = selectedModelByWorkspace[workspaceId] ?? null;
	const selectedThinkingLevel =
		selectedThinkingByWorkspace[workspaceId] ?? null;
	const [lastError, setLastError] = useState<string | null>(null);
	const [pendingSession, setPendingSession] =
		useState<PendingTabSession | null>(null);

	const models = modelsQuery.data;
	const availableModels = useMemo<readonly ComposerModelOption[]>(() => {
		if (!models) {
			return [];
		}
		return models.models.map((model) => ({
			displayName: model.displayName,
			id: model.id,
		}));
	}, [models]);

	const modelId =
		selectedModelId ?? models?.defaultModelId ?? availableModels[0]?.id ?? null;
	const thinkingLevel =
		selectedThinkingLevel ?? models?.defaultThinkingLevel ?? null;

	const availableThinkingLevels = useMemo<
		readonly ComposerThinkingOption[]
	>(() => {
		if (!models || !modelId) {
			return [];
		}
		const selectedModel = models.models.find((model) => model.id === modelId);
		const levels = selectedModel?.thinkingLevels ?? [];
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
					return;
				}
				sessionId = opened.session?.id ?? null;
			}
			if (!sessionId) {
				setLastError('Unable to open a Pi session.');
				return;
			}

			const result = await submitMutation.mutateAsync({
				prompt: trimmed,
				sessionId,
			});
			if (result.error) {
				setLastError(result.error);
			}
		},
		[
			activeSessionId,
			isRealChatTabId,
			openSessionMutation,
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
			setSelectedModelByWorkspace((current) => ({
				...current,
				[workspaceId]: nextModelId,
			}));
		},
		[setSelectedModelByWorkspace, workspaceId],
	);

	const onThinkingChange = useCallback(
		(nextThinkingLevel: string) => {
			setSelectedThinkingByWorkspace((current) => ({
				...current,
				[workspaceId]: nextThinkingLevel,
			}));
		},
		[setSelectedThinkingByWorkspace, workspaceId],
	);

	return {
		activeSessionId,
		availableModels,
		availableThinkingLevels,
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

/** Detects the metadata event emitted when the main process finishes tab titling. */
function hasChatTitleMetadata(
	payload: import('@/shared/ipc').PiPersistedEnvelope | null,
): boolean {
	if (payload?.kind !== 'metadata') {
		return false;
	}
	return typeof payload.metadata.chatTitle === 'string';
}
