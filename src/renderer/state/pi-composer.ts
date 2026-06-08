import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import {
	ensembleQueryKeys,
	openPiSession,
	piModelsQuery,
	piSessionsForWorkspaceQuery,
	stopPiSession,
	submitPiPrompt,
} from '@/renderer/api/ensemble-queries';
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

/**
 * Wires the Pi composer UI to the main-process Pi session service. Owns local
 * state for selected model, thinking level, the active session, and the
 * streaming flag — and exposes async submit/stop callbacks suitable for
 * `ComposerShellState`.
 */
export function usePiComposerController({
	workspaceCwd,
	workspaceId,
}: {
	workspaceCwd: string;
	workspaceId: string;
}): PiComposerControllerState {
	const queryClient = useQueryClient();
	const modelsQuery = useQuery(piModelsQuery);
	const sessionsQuery = useQuery(piSessionsForWorkspaceQuery(workspaceId));

	const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
	const [selectedThinkingLevel, setSelectedThinkingLevel] = useState<
		string | null
	>(null);
	const [lastError, setLastError] = useState<string | null>(null);
	const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
	const [isStreaming, setIsStreaming] = useState(false);

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
		(session) => session.status !== 'closed' && session.status !== 'errored',
	);
	const activeSessionId =
		pendingSessionId ?? persistedActiveSession?.id ?? null;

	const openSessionMutation = useMutation({
		mutationFn: () =>
			openPiSession({
				model: modelId,
				thinkingLevel,
				workspaceCwd,
				workspaceId,
			}),
		onSuccess: (result) => {
			if (result.session) {
				setPendingSessionId(result.session.id);
				void queryClient.invalidateQueries({
					queryKey: ensembleQueryKeys.piSessionsForWorkspace(workspaceId),
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
			setPendingSessionId(null);
			setIsStreaming(false);
			void queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.piSessionsForWorkspace(workspaceId),
			});
		},
	});

	const onSubmit = useCallback(
		async (prompt: string): Promise<void> => {
			const trimmed = prompt.trim();
			if (!trimmed) {
				return;
			}
			setLastError(null);

			let sessionId = activeSessionId;
			if (!sessionId) {
				const opened = await openSessionMutation.mutateAsync();
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

			setIsStreaming(true);
			const result = await submitMutation.mutateAsync({
				prompt: trimmed,
				sessionId,
			});
			if (result.error) {
				setLastError(result.error);
				setIsStreaming(false);
			}
		},
		[activeSessionId, openSessionMutation, submitMutation],
	);

	const onStop = useCallback(async (): Promise<void> => {
		if (!activeSessionId) {
			setIsStreaming(false);
			return;
		}
		await stopMutation.mutateAsync(activeSessionId);
	}, [activeSessionId, stopMutation]);

	return {
		activeSessionId,
		availableModels,
		availableThinkingLevels,
		isStreaming: isStreaming || submitMutation.isPending,
		lastError,
		modelId,
		onModelChange: setSelectedModelId,
		onStop,
		onSubmit,
		onThinkingChange: setSelectedThinkingLevel,
		thinkingLevel,
	};
}
