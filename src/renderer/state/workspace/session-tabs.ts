import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
	closeChatTab,
	ensembleQueryKeys,
	listChatTabsQuery,
	listClosedChatTabsWithSummaryQuery,
	openChatTab,
	piSessionsForWorkspaceQuery,
	removeOpenChatTabFromCache,
	restoreChatTab,
	subscribePiSessionEvents,
	writeOpenedChatTabToCache,
} from '@/renderer/api/ensemble-queries';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { SessionTabState } from '@/renderer/types/workbench-shell';
import {
	CHAT_TAB_LIMIT,
	CHAT_TAB_LIMIT_ERROR_CODE,
	type ChatTabWire,
	type ClosedChatTabEntryWire,
	type OpenChatTabRequest,
} from '@/shared/ipc/contracts/chat-tab';
import type { PiSessionSnapshotWire } from '@/shared/ipc/contracts/pi-session';

/**
 * Cross-instance lock for the workspace-level bootstrap. The route shell owns
 * the only long-lived hook instance, but remounts (StrictMode, route
 * transitions) must not spawn duplicate chat tabs on first load — the first
 * mount to claim the workspace id wins.
 */
const bootstrappedWorkspacesGlobal = new Set<string>();

/** Result returned after closing a tab, allowing callers to handle a replacement. */
export interface CloseSessionTabHandlerResult {
	replacementChatTabId: string | null;
}

/** Result returned after opening a new tab, exposing the new id for navigation. */
export interface OpenSessionTabHandlerResult {
	chatTabId: string;
}

/**
 * React hook exposing chat-tab state for a workspace, backed by SQLite via the
 * `listChatTabs` and `listClosedChatTabsWithSummary` IPC queries. Open tabs
 * project into `SessionTabModel`s; closed tabs feed the history dropdown.
 * Mutations call the corresponding open/close IPCs and invalidate both caches.
 */
export function useSessionTabState({
	activeSession,
	activeWorkspace,
	bootstrap = false,
	onSessionTabChange,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	/** When true, the hook auto-opens a real chat-tab if none exists for the workspace. */
	bootstrap?: boolean;
	onSessionTabChange: (sessionId: string) => void;
}): SessionTabState & {
	openSessionTab: () => Promise<OpenSessionTabHandlerResult | null>;
	openFilePreviewTab: (input: {
		filePath: string;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	openTurnDiffTab: (input: {
		label: string;
		turnId: string;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	openWorkspaceFileDiffTab: (input: {
		filePath: string;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	closeSessionTabAsync: (
		chatTabId: string,
	) => Promise<CloseSessionTabHandlerResult>;
} {
	const workspaceId = activeWorkspace.id;
	const queryClient = useQueryClient();
	const chatTabsQuery = useQuery(listChatTabsQuery(workspaceId));
	const closedChatTabsQuery = useQuery(
		listClosedChatTabsWithSummaryQuery(workspaceId),
	);
	const piSessionsQuery = useQuery(piSessionsForWorkspaceQuery(workspaceId));

	const openTabs = chatTabsQuery.data?.open ?? null;
	const closedEntries = closedChatTabsQuery.data?.entries ?? null;
	const piSessions = piSessionsQuery.data?.sessions;

	const piStatusByPiSessionId = useMemo(() => {
		const map = new Map<string, PiSessionSnapshotWire>();
		if (!piSessions) {
			return map;
		}
		for (const session of piSessions) {
			map.set(session.id, session);
		}
		return map;
	}, [piSessions]);

	const sessionTabs = useMemo<SessionTabModel[]>(() => {
		if (!openTabs || openTabs.length === 0) {
			// Fall back to the placeholder-derived sessions so the UI stays
			// populated until the IPC query lands. Min-one-tab is enforced
			// server-side; this branch covers first-paint and offline modes.
			return activeWorkspace.sessions;
		}
		return openTabs.map((tab) =>
			toSessionTabModel(tab, piStatusByPiSessionId.get(tab.piSessionId ?? '')),
		);
	}, [openTabs, activeWorkspace.sessions, piStatusByPiSessionId]);

	const closedSessions = useMemo<SessionTabModel[]>(() => {
		if (!closedEntries) {
			return [];
		}
		return closedEntries.map(toClosedSessionTabModel);
	}, [closedEntries]);

	const effectiveActiveSession =
		sessionTabs.find((session) => session.id === activeSession.id) ??
		sessionTabs[0] ??
		activeSession;

	const invalidateChatTabs = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ensembleQueryKeys.chatTabs(workspaceId),
		});
		void queryClient.invalidateQueries({
			queryKey: ensembleQueryKeys.closedChatTabsWithSummary(workspaceId),
		});
	}, [queryClient, workspaceId]);

	// Tab-level subscription: refresh the Pi session list on status events
	// across ALL sessions in this workspace so inactive-tab spinners update.
	// The composer-bound subscription filters to one session id and would
	// otherwise miss status changes on background tabs.
	useEffect(() => {
		const unsubscribe = subscribePiSessionEvents((broadcast) => {
			if (broadcast.workspaceId !== workspaceId) {
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
	}, [queryClient, workspaceId]);

	const cacheOpenedTab = useCallback(
		(result: { tab: ChatTabWire }) => {
			writeOpenedChatTabToCache({
				queryClient,
				tab: result.tab,
				workspaceId,
			});
			invalidateChatTabs();
		},
		[invalidateChatTabs, queryClient, workspaceId],
	);

	// Chat opens are subject to the per-workspace tab limit; the limit toast
	// only makes sense here, so file/diff opens use a separate mutation below.
	const openChatTabMutation = useMutation({
		mutationFn: (request?: Omit<OpenChatTabRequest, 'workspaceId'>) =>
			openChatTab({ ...request, workspaceId }),
		onError: (error) => {
			if (isChatTabLimitError(error)) {
				toast.warning(`Chat tab limit reached`, {
					description: `At most ${CHAT_TAB_LIMIT} chat tabs can be open in a workspace. Close one to open a new chat — closed chats stay available in history.`,
				});
				return;
			}
			invalidateChatTabs();
		},
		onSuccess: cacheOpenedTab,
	});

	const openAuxiliaryTabMutation = useMutation({
		mutationFn: (request: Omit<OpenChatTabRequest, 'workspaceId'>) =>
			openChatTab({ ...request, workspaceId }),
		onError: (error) => {
			invalidateChatTabs();
			toast.error('Could not open tab', {
				description: error instanceof Error ? error.message : undefined,
			});
		},
		onSuccess: cacheOpenedTab,
	});

	// Bootstrap a real chat-tab row when the workspace has none. Placeholder
	// session ids like `<workspaceId>:overview` are not persisted, so the first
	// prompt would fail to bind without a real row. Cross-instance lock keeps
	// remounted hooks from spawning duplicate tabs on first load.
	useEffect(() => {
		if (!bootstrap) {
			return;
		}
		if (!chatTabsQuery.data) {
			return;
		}
		if (chatTabsQuery.data.open.length > 0) {
			return;
		}
		if (bootstrappedWorkspacesGlobal.has(workspaceId)) {
			return;
		}
		bootstrappedWorkspacesGlobal.add(workspaceId);
		openChatTabMutation.mutate(undefined, {
			onError: () => {
				bootstrappedWorkspacesGlobal.delete(workspaceId);
			},
			onSuccess: (result) => {
				if (result.tab) {
					onSessionTabChange(result.tab.id);
				}
				invalidateChatTabs();
			},
		});
	}, [
		bootstrap,
		chatTabsQuery.data,
		invalidateChatTabs,
		onSessionTabChange,
		openChatTabMutation,
		workspaceId,
	]);

	const closeMutation = useMutation({
		mutationFn: (chatTabId: string) => closeChatTab({ chatTabId }),
		onError: invalidateChatTabs,
		onMutate: (chatTabId: string) => {
			removeOpenChatTabFromCache({
				chatTabId,
				queryClient,
				workspaceId,
			});
		},
		onSuccess: invalidateChatTabs,
	});

	const openSessionTab =
		useCallback(async (): Promise<OpenSessionTabHandlerResult | null> => {
			try {
				const result = await openChatTabMutation.mutateAsync(undefined);
				if (!result.tab) {
					return null;
				}
				return { chatTabId: result.tab.id };
			} catch (error) {
				// Limit errors are surfaced as a toast by the mutation; treat the
				// blocked open as a soft no-op so callers do not navigate.
				if (isChatTabLimitError(error)) {
					return null;
				}
				throw error;
			}
		}, [openChatTabMutation]);

	/** Opens (or re-focuses) a file-preview tab for a workspace-relative path. */
	const openFilePreviewTab = useCallback(
		async ({
			filePath,
		}: {
			filePath: string;
		}): Promise<OpenSessionTabHandlerResult | null> => {
			try {
				const result = await openAuxiliaryTabMutation.mutateAsync({
					kind: 'file',
					metadata: { filePath },
					title: basenameOf(filePath),
				});
				return result.tab ? { chatTabId: result.tab.id } : null;
			} catch {
				// Surfaced as a toast by the mutation; callers treat as no-op.
				return null;
			}
		},
		[openAuxiliaryTabMutation],
	);

	/** Opens (or re-focuses) a turn-diff tab for a checkpointed turn. */
	const openTurnDiffTab = useCallback(
		async ({
			label,
			turnId,
		}: {
			label: string;
			turnId: string;
		}): Promise<OpenSessionTabHandlerResult | null> => {
			try {
				const result = await openAuxiliaryTabMutation.mutateAsync({
					kind: 'diff',
					metadata: { turnId },
					title: `Diff: ${label}`,
				});
				return result.tab ? { chatTabId: result.tab.id } : null;
			} catch {
				// Surfaced as a toast by the mutation; callers treat as no-op.
				return null;
			}
		},
		[openAuxiliaryTabMutation],
	);

	/** Opens (or re-focuses) a working-tree diff tab for a changed file. */
	const openWorkspaceFileDiffTab = useCallback(
		async ({
			filePath,
		}: {
			filePath: string;
		}): Promise<OpenSessionTabHandlerResult | null> => {
			try {
				const result = await openAuxiliaryTabMutation.mutateAsync({
					kind: 'diff',
					metadata: { filePath },
					title: `Diff: ${basenameOf(filePath)}`,
				});
				return result.tab ? { chatTabId: result.tab.id } : null;
			} catch {
				// Surfaced as a toast by the mutation; callers treat as no-op.
				return null;
			}
		},
		[openAuxiliaryTabMutation],
	);

	const closeSessionTabAsync = useCallback(
		async (chatTabId: string): Promise<CloseSessionTabHandlerResult> => {
			await closeMutation.mutateAsync(chatTabId);
			return { replacementChatTabId: null };
		},
		[closeMutation],
	);

	/** Fire-and-forget close used by the SessionTabState contract. */
	const closeSessionTab = useCallback(
		(chatTabId: string) => {
			const closing = sessionTabs.find((session) => session.id === chatTabId);
			const isChatKind = (closing?.kind ?? 'chat') === 'chat';
			// Min-one applies to chat tabs only; non-chat tabs always close.
			if (isChatKind) {
				const openChatTabCount = sessionTabs.filter(
					(session) => (session.kind ?? 'chat') === 'chat',
				).length;
				if (openChatTabCount <= 1) {
					return;
				}
			}
			const nextSession = sessionTabs.find(
				(session) => session.id !== chatTabId,
			);
			if (activeSession.id === chatTabId && nextSession) {
				onSessionTabChange(nextSession.id);
			}
			void closeSessionTabAsync(chatTabId).then((result) => {
				if (result.replacementChatTabId) {
					onSessionTabChange(result.replacementChatTabId);
				}
			});
		},
		[activeSession.id, closeSessionTabAsync, onSessionTabChange, sessionTabs],
	);

	/** Reopens a previously-closed tab and selects it when restoration succeeds. */
	const restoreSessionTab = useCallback(
		(chatTabId: string) => {
			void restoreChatTab({ chatTabId }).then((result) => {
				invalidateChatTabs();
				if (result.tab) {
					onSessionTabChange(result.tab.id);
				}
			});
		},
		[invalidateChatTabs, onSessionTabChange],
	);

	return {
		closedSessions,
		closeSessionTab,
		closeSessionTabAsync,
		effectiveActiveSession,
		openFilePreviewTab,
		openSessionTab,
		openTurnDiffTab,
		openWorkspaceFileDiffTab,
		restoreSessionTab,
		sessionTabs,
	};
}

/** True when an IPC open-tab rejection carries the chat-tab-limit marker. */
function isChatTabLimitError(error: unknown): boolean {
	return (
		error instanceof Error && error.message.includes(CHAT_TAB_LIMIT_ERROR_CODE)
	);
}

function basenameOf(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	return trimmed.split('/').at(-1) ?? trimmed;
}

/** Maps an open chat-tab wire row into a renderer-facing `SessionTabModel`. */
function toSessionTabModel(
	tab: ChatTabWire,
	piSession: PiSessionSnapshotWire | undefined,
): SessionTabModel {
	const base = {
		chatTabId: tab.id,
		id: tab.id,
		label: tab.title,
		piSessionId: tab.piSessionId,
		status: deriveTabStatus(piSession),
		summary: '',
		updatedLabel: '',
	} as const;
	if (tab.kind === 'diff') {
		const turnId = tab.metadata.turnId;
		const filePath = tab.metadata.filePath;
		return {
			...base,
			filePath: typeof filePath === 'string' ? filePath : null,
			kind: 'diff',
			turnId: typeof turnId === 'string' ? turnId : null,
		};
	}
	if (tab.kind === 'chat') {
		return { ...base, kind: 'chat' };
	}
	const filePath = tab.metadata.filePath;
	return {
		...base,
		filePath: typeof filePath === 'string' ? filePath : null,
		kind: tab.kind,
	};
}

/** Maps a Pi session's runtime status to the tab spinner state. */
function deriveTabStatus(
	piSession: PiSessionSnapshotWire | undefined,
): SessionTabModel['status'] {
	if (!piSession?.runtimeOpen) {
		return 'idle';
	}
	if (piSession.status === 'starting' || piSession.status === 'streaming') {
		return 'working';
	}
	return 'idle';
}

/** Maps a closed-tab + summary entry into a `SessionTabModel`. */
function toClosedSessionTabModel(
	entry: ClosedChatTabEntryWire,
): SessionTabModel {
	return {
		chatTabId: entry.tab.id,
		id: entry.tab.id,
		// Prefer the short chat-title that was visible on the open tab. The
		// LLM-derived summary title is verbose and often diverges from what
		// the user saw, so it is only used when no tab title exists.
		label: entry.tab.title || entry.summaryTitle || 'Untitled chat',
		piSessionId: entry.tab.piSessionId,
		status: 'idle',
		summary: entry.summaryPath,
		updatedLabel: formatRelativeClosedAt(entry.closedAt),
	};
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Renders a closed-at ISO timestamp as a compact relative label
 * (`"just now"`, `"5m ago"`, `"2h ago"`, `"3d ago"`). Returns the raw input
 * when it cannot be parsed.
 */
export function formatRelativeClosedAt(closedAtIso: string): string {
	const closedAt = Date.parse(closedAtIso);
	if (Number.isNaN(closedAt)) {
		return closedAtIso;
	}
	const elapsed = Date.now() - closedAt;
	if (elapsed < MINUTE_MS) {
		return 'just now';
	}
	if (elapsed < HOUR_MS) {
		return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
	}
	if (elapsed < DAY_MS) {
		return `${Math.floor(elapsed / HOUR_MS)}h ago`;
	}
	return `${Math.floor(elapsed / DAY_MS)}d ago`;
}
