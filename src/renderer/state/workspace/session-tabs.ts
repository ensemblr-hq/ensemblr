import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
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
import type {
	ChatTabWire,
	ClosedChatTabEntryWire,
	PiSessionSnapshotWire,
} from '@/shared/ipc';

/**
 * Cross-instance lock for the workspace-level bootstrap. Two mounted hook
 * instances (route shell + workspace content) must not both spawn a chat tab
 * on first load — the first to claim the workspace id wins.
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

	const openMutation = useMutation({
		mutationFn: () => openChatTab({ workspaceId }),
		onSuccess: (result) => {
			writeOpenedChatTabToCache({
				queryClient,
				tab: result.tab,
				workspaceId,
			});
			invalidateChatTabs();
		},
	});

	// Bootstrap a real chat-tab row when the workspace has none. Placeholder
	// session ids like `<workspaceId>:overview` are not persisted, so the first
	// prompt would fail to bind without a real row. Cross-instance lock keeps
	// the multiple hooks mounted in the same workspace from spawning duplicate
	// tabs on first load.
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
		openMutation.mutate(undefined, {
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
		openMutation,
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
			const result = await openMutation.mutateAsync();
			if (!result.tab) {
				return null;
			}
			return { chatTabId: result.tab.id };
		}, [openMutation]);

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
			if (sessionTabs.length <= 1) {
				return;
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
		openSessionTab,
		restoreSessionTab,
		sessionTabs,
	};
}

/** Maps an open chat-tab wire row into a renderer-facing `SessionTabModel`. */
function toSessionTabModel(
	tab: ChatTabWire,
	piSession: PiSessionSnapshotWire | undefined,
): SessionTabModel {
	return {
		chatTabId: tab.id,
		id: tab.id,
		label: tab.title,
		piSessionId: tab.piSessionId,
		status: deriveTabStatus(piSession),
		summary: '',
		updatedLabel: '',
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
