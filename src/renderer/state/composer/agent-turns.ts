import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from 'jotai';
import { useCallback, useState } from 'react';

import {
	ensemblrQueryKeys,
	openAgentSession,
	stopAgentSession,
	submitAgentPrompt,
} from '@/renderer/api/ensemblr-queries';
import { wrapWithMasterPrompt } from '@/renderer/lib/workbench/action-prompts';
import { useInFlightTurns } from '@/renderer/state/composer/in-flight-turns';
import { useOptimisticPrompts } from '@/renderer/state/composer/optimistic-prompts';
import { chatAppliedLinkedDirectoriesAtomFamily } from '@/renderer/state/preferences';
import type { PiStreamingBehavior } from '@/shared/ipc/contracts/agent-session';

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

/** The persisted session fields a turn has to consult before opening a new one. */
interface PersistedSession {
	id: string;
	runtimeOpen?: boolean;
}

/**
 * Owns an agent chat's session lifecycle and its turns: opening a session,
 * submitting prompts, stopping a run, and the optimistic entry each turn renders
 * behind.
 *
 * Everything that identifies the turn — target tab, model, thinking level, Plan
 * Mode — rides in the mutation variables rather than being read from render
 * scope. TanStack rebuilds a mutation from the newest options at mutate time,
 * and a first turn submits only after awaiting its own `openAgentSession`, so a
 * render-scope read would stamp whichever tab the user switched to while the
 * agent process was still spawning.
 * @param input - The tab, the resolved turn settings, and the workspace it runs in
 * @returns The chat's active session, its busy state, and the submit/stop callbacks
 */
export function useAgentTurns({
	chatTabId,
	isResolvingChatTab,
	linkedDirectoriesRequest,
	masterPrompt,
	modelId,
	persistedActiveSession,
	planModeRequest,
	thinkingLevel,
	workspaceCwd,
	workspaceId,
}: {
	chatTabId: string;
	isResolvingChatTab: boolean;
	/**
	 * Reads the chat's linked directories at open time. Only the open request
	 * carries them: the runtimes that sandbox by working directory take their
	 * extra roots at launch, so a per-turn field would promise a grant no submit
	 * can make.
	 */
	linkedDirectoriesRequest: () => readonly string[];
	masterPrompt: string;
	modelId: string | null;
	persistedActiveSession: PersistedSession | undefined;
	planModeRequest: () => { planMode?: boolean };
	thinkingLevel: string | null;
	workspaceCwd: string;
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const store = useStore();
	const inFlight = useInFlightTurns();
	const optimistic = useOptimisticPrompts(chatTabId);
	const [lastError, setLastError] = useState<string | null>(null);
	// Sessions opened this mount, keyed by the tab that opened them, standing in
	// until the refetch lands. Keyed rather than a single slot so a second tab
	// starting a chat cannot erase the first tab's freshly-opened session.
	const [pendingSessionByTab, setPendingSessionByTab] = useState<
		Readonly<Record<string, string | undefined>>
	>({});

	const activeSessionId =
		persistedActiveSession?.id ?? pendingSessionByTab[chatTabId] ?? null;

	const openSessionMutation = useMutation({
		mutationFn: (input: {
			chatTabId: string;
			initialPrompt: string | null;
			linkedDirectories: readonly string[];
			resumeSessionId?: string | null;
			turn: AgentTurnOptions;
		}) =>
			openAgentSession({
				...input.turn,
				chatTabId: input.chatTabId,
				initialPrompt: input.initialPrompt,
				linkedDirectories: input.linkedDirectories,
				resumeSessionId: input.resumeSessionId ?? null,
				workspaceCwd,
				workspaceId,
			}),
		onSuccess: (result, variables) => {
			if (result.session) {
				const openedSessionId = result.session.id;
				// Record what the runtime was actually launched with, so the composer
				// can tell the user when a directory linked later is not readable yet.
				store.set(
					chatAppliedLinkedDirectoriesAtomFamily(variables.chatTabId),
					variables.linkedDirectories,
				);
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

	/**
	 * Resolves the session a turn will run on, opening one when the chat has none
	 * and reopening the runtime when a persisted session's process has exited.
	 * @param initialPrompt - First message, used for title and branch naming
	 * @param turn - The snapshotted model, thinking level, and Plan Mode
	 * @returns The session id to submit against, or the failure that stopped it
	 */
	const ensureSession = useCallback(
		async (
			initialPrompt: string,
			turn: AgentTurnOptions,
		): Promise<{ error?: string; sessionId?: string }> => {
			const needsRuntimeResume =
				persistedActiveSession !== undefined &&
				!persistedActiveSession.runtimeOpen;
			if (activeSessionId && !needsRuntimeResume) {
				return { sessionId: activeSessionId };
			}
			const opened = await inFlight.track(chatTabId, () =>
				openSessionMutation.mutateAsync({
					chatTabId,
					initialPrompt: activeSessionId ? null : initialPrompt,
					linkedDirectories: linkedDirectoriesRequest(),
					resumeSessionId: activeSessionId,
					turn,
				}),
			);
			if (opened.error) {
				return { error: opened.error };
			}
			return opened.session?.id
				? { sessionId: opened.session.id }
				: { error: 'Unable to open an agent session.' };
		},
		[
			activeSessionId,
			chatTabId,
			inFlight,
			linkedDirectoriesRequest,
			openSessionMutation,
			persistedActiveSession,
		],
	);

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
			const promptToSend = activeSessionId
				? trimmed
				: wrapWithMasterPrompt(masterPrompt, trimmed);

			// Render the submitted prompt instantly. The Timeline removes this entry
			// once the matching persisted user-message lands, so it must be the exact
			// text sent (master prompt included) or optimistic and persisted entries
			// won't match and both render.
			const optimisticEntry = optimistic.push(promptToSend);

			const resolved = await ensureSession(trimmed, turn);
			if (!resolved.sessionId) {
				setLastError(resolved.error ?? 'Unable to open an agent session.');
				optimistic.remove(optimisticEntry.id);
				return;
			}

			const turnSessionId = resolved.sessionId;
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
			ensureSession,
			inFlight,
			isRealChatTabId,
			isResolvingChatTab,
			masterPrompt,
			modelId,
			optimistic,
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

	return {
		activeSessionId,
		// One controller instance serves whichever tab is active, so a shared
		// mutation's own pending flag would report a sibling's turn as this tab's.
		// The in-flight set is keyed by tab (a session still spawning) and by session
		// (a turn or a stop already under way), so several tabs run independently.
		hasInFlightTurn:
			inFlight.isBusy(chatTabId) || inFlight.isBusy(activeSessionId),
		lastError,
		onStop,
		onSubmit,
	};
}
