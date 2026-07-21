import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
	closeChatTab,
	ensemblrQueryKeys,
	listChatTabsQuery,
	listClosedChatTabsWithSummaryQuery,
	openChatTab,
	piSessionsForWorkspaceQuery,
	removeOpenChatTabFromCache,
	reorderChatTabs,
	restoreChatTab,
	subscribePiSessionEvents,
	writeOpenedChatTabToCache,
	writeReorderedChatTabsToCache,
} from '@/renderer/api/ensemblr-queries';
import { useWorkspaceAgentBusy } from '@/renderer/hooks/workspace/use-workspace-agent-busy';
import { areStringArraysEqual } from '@/renderer/lib/ordered-ids';
import { stripHarnessTitleDecoration } from '@/renderer/lib/terminal/harness-title';
import { forgetComposerDraft } from '@/renderer/state/composer';
import { forgetChatOverrides } from '@/renderer/state/preferences';
import type {
	CommentPreviewPayload,
	PullRequestCommentSummary,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { SessionTabState } from '@/renderer/types/workbench-shell';
import { harnessConversationTitleSource } from '@/shared/agents/harness-registry';
import {
	CHAT_TAB_LIMIT,
	CHAT_TAB_LIMIT_ERROR_CODE,
	type ChatTabWire,
	type CloseChatTabRequest,
	type ClosedChatTabEntryWire,
	type ListChatTabsResult,
	type OpenChatTabRequest,
} from '@/shared/ipc/contracts/chat-tab';
import type { PiSessionSnapshotWire } from '@/shared/ipc/contracts/pi-session';
import {
	parseWorkspaceGitDiffScope,
	type WorkspaceGitDiffScope,
} from '@/shared/ipc/contracts/workspace-git';
import { decideActiveClose, selectNeighborTab } from './session-tab-close';
import { resumeRestoredTerminalTab } from './terminal-tab-restore';

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
	openCommentPreviewTab: (input: {
		comment: PullRequestCommentSummary;
		prNumber?: number;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	openFilePreviewTab: (input: {
		filePath: string;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	openTurnDiffTab: (input: {
		label: string;
		turnId: string;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	openTerminalTab: (input: {
		harnessId: string;
		harnessLabel: string;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	openWorkspaceFileDiffTab: (input: {
		filePath: string;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	closeSessionTabAsync: (
		chatTabId: string,
	) => Promise<CloseSessionTabHandlerResult>;
	closeActiveOrReset: () => void;
} {
	const workspaceId = activeWorkspace.id;
	const queryClient = useQueryClient();
	const {
		data: chatTabsData,
		isFetching: isFetchingChatTabs,
		isSuccess: hasLoadedChatTabs,
	} = useQuery(listChatTabsQuery(workspaceId));
	const { data: closedChatTabsData } = useQuery(
		listClosedChatTabsWithSummaryQuery(workspaceId),
	);
	const { data: piSessionsData } = useQuery(
		piSessionsForWorkspaceQuery(workspaceId),
	);

	const openTabs = chatTabsData?.open ?? null;
	const closedEntries = closedChatTabsData?.entries ?? null;
	const piSessions = piSessionsData?.sessions;

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

	// Live window titles agent harnesses emit via OSC escapes, keyed by their
	// backing terminal id, so a running agent's own conversation title surfaces
	// on its tab (falling back to the harness label until one arrives).
	const [terminalTitles, setTerminalTitles] = useState<Record<string, string>>(
		{},
	);
	// Latest live title and native session id per terminal, mirrored into refs so
	// the close path can stamp them onto the archived tab without re-subscribing.
	// Keyed by backing terminal id.
	const terminalTitlesRef = useRef<Record<string, string>>({});
	const terminalSessionIdsRef = useRef<Record<string, string>>({});
	// Agent-terminal busy state, inferred from the spinner glyph a harness
	// animates in its OSC title. Owned by a workspace-scoped hook so the same
	// signal drives both this tab strip and the workspace sidebar/card rows.
	const { busyTerminalIds } = useWorkspaceAgentBusy(workspaceId);
	// Tab ids whose close is already in flight, so the harness-exit lifecycle
	// event cannot re-close a tab the user just closed (kill → synchronous exit
	// broadcast would otherwise fire a second close on the same row).
	const closingTabIdsRef = useRef<Set<string>>(new Set());

	const sessionTabs = useMemo<SessionTabModel[]>(() => {
		// The synthetic `<workspaceId>:overview` placeholder is never a strip tab.
		// Surfacing it here made opening the first real tab look like a replace:
		// the array swapped from `[placeholder]` to `[realTab]` at the 0->1 edge.
		// Until the IPC query lands (first paint, and every switch to a
		// not-yet-cached workspace) the strip is empty; the placeholder still
		// backs `effectiveActiveSession` so content keeps rendering meanwhile.
		if (!openTabs) {
			return [];
		}
		return openTabs.map((tab) => {
			const model = toSessionTabModel(
				tab,
				piStatusByPiSessionId.get(tab.piSessionId ?? ''),
			);
			if (model.kind === 'terminal') {
				const liveTitle = terminalTitles[model.terminalId];
				const isBusy = busyTerminalIds.has(model.terminalId);
				return {
					...model,
					...(liveTitle ? { label: liveTitle } : {}),
					...(isBusy ? { status: 'working' as const } : {}),
				};
			}
			return model;
		});
	}, [busyTerminalIds, openTabs, piStatusByPiSessionId, terminalTitles]);

	const closedSessions = useMemo<SessionTabModel[]>(() => {
		if (!closedEntries) {
			return [];
		}
		return closedEntries.map(toClosedSessionTabModel);
	}, [closedEntries]);

	const effectiveActiveSession =
		sessionTabs.find((session) => session.id === activeSession.id) ??
		sessionTabs[0] ??
		activeWorkspace.sessions.find(
			(session) => session.id === activeSession.id,
		) ??
		activeWorkspace.sessions[0] ??
		activeSession;

	const invalidateChatTabs = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
		});
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.closedChatTabsWithSummary(workspaceId),
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
				queryKey: ensemblrQueryKeys.piSessionsForWorkspace(workspaceId),
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
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.closedChatTabsWithSummary(workspaceId),
			});
		},
		onSuccess: (result) => {
			cacheOpenedTab(result);
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
			});
		},
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
		onSuccess: (result) => {
			cacheOpenedTab(result);
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
			});
		},
	});

	// Bootstrap a real chat-tab row when the workspace has none. Placeholder
	// session ids like `<workspaceId>:overview` are not persisted, so the first
	// prompt would fail to bind without a real row. Cross-instance lock keeps
	// remounted hooks from spawning duplicate tabs on first load.
	useEffect(() => {
		if (!bootstrap) {
			return;
		}
		// Only act on a settled query. A mid-refetch snapshot can momentarily read
		// as empty even when tabs exist; opening on that would spawn a spurious
		// "New chat" and yank the user off their current tab (the 1->2 replace).
		if (!hasLoadedChatTabs || isFetchingChatTabs) {
			return;
		}
		if (!chatTabsData || chatTabsData.open.length > 0) {
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
		chatTabsData,
		hasLoadedChatTabs,
		isFetchingChatTabs,
		invalidateChatTabs,
		onSessionTabChange,
		openChatTabMutation,
		workspaceId,
	]);

	const closeMutation = useMutation({
		mutationFn: (request: CloseChatTabRequest) => closeChatTab(request),
		onError: invalidateChatTabs,
		onMutate: ({ chatTabId }: CloseChatTabRequest) => {
			removeOpenChatTabFromCache({
				chatTabId,
				queryClient,
				workspaceId,
			});
		},
		onSuccess: (result, { chatTabId }) => {
			// Drop per-chat overrides and the composer draft only for hard-deleted
			// tabs; tabs marked closed remain restorable and must keep their
			// model/thinking picks and unsent draft.
			if (result.deleted) {
				forgetChatOverrides(chatTabId);
				forgetComposerDraft(chatTabId);
			}
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.closedChatTabsWithSummary(workspaceId),
			});
		},
	});

	const reorderChatTabsMutation = useMutation({
		mutationFn: (orderedIds: readonly string[]) =>
			reorderChatTabs({ orderedIds, workspaceId }),
		onError: (error) => {
			invalidateChatTabs();
			toast.error('Could not reorder tabs', {
				description: error instanceof Error ? error.message : undefined,
			});
		},
		onMutate: (orderedIds: readonly string[]) => {
			writeReorderedChatTabsToCache({
				orderedIds,
				queryClient,
				workspaceId,
			});
		},
		onSuccess: (result) => {
			queryClient.setQueryData<ListChatTabsResult>(
				ensemblrQueryKeys.chatTabs(workspaceId),
				(current) => ({
					closed: current?.closed ?? [],
					open: result.open,
				}),
			);
		},
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

	/**
	 * Opens (or re-focuses) a read-only preview tab for a PR comment. The comment
	 * rides in `metadata` as a `document` tab so the body survives reloads without
	 * a re-fetch (and avoids widening the `chat_tabs.kind` CHECK constraint).
	 */
	const openCommentPreviewTab = useCallback(
		async ({
			comment,
			prNumber,
		}: {
			comment: PullRequestCommentSummary;
			prNumber?: number;
		}): Promise<OpenSessionTabHandlerResult | null> => {
			try {
				const author = comment.author?.trim();
				const result = await openAuxiliaryTabMutation.mutateAsync({
					kind: 'document',
					metadata: {
						// Persist only the fields `parseCommentPreview` reads back, so a
						// future `PullRequestCommentSummary` field can't leak unintended
						// (or non-serializable) data into the tab's SQLite metadata.
						commentPreview: {
							...(comment.author === undefined
								? {}
								: { author: comment.author }),
							detail: comment.detail,
							id: comment.id,
							...(comment.isResolved === undefined
								? {}
								: { isResolved: comment.isResolved }),
							provider: comment.provider,
							...(comment.url === undefined ? {} : { url: comment.url }),
							...(typeof prNumber === 'number' ? { prNumber } : {}),
						},
					},
					title: author ? `Comment · ${author}` : 'Comment',
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
					title: label,
				});
				return result.tab ? { chatTabId: result.tab.id } : null;
			} catch {
				// Surfaced as a toast by the mutation; callers treat as no-op.
				return null;
			}
		},
		[openAuxiliaryTabMutation],
	);

	/**
	 * Opens (or re-focuses) a diff tab for a changed file at the given scope. The
	 * scope is persisted in metadata so the same file viewed at the working tree,
	 * in a commit, and across the branch each get their own tab.
	 */
	const openWorkspaceFileDiffTab = useCallback(
		async ({
			filePath,
			scope,
		}: {
			filePath: string;
			scope?: WorkspaceGitDiffScope;
		}): Promise<OpenSessionTabHandlerResult | null> => {
			try {
				const result = await openAuxiliaryTabMutation.mutateAsync({
					kind: 'diff',
					metadata: { filePath, ...(scope ? { diffScope: scope } : {}) },
					title: diffTabTitle(filePath, scope),
				});
				return result.tab ? { chatTabId: result.tab.id } : null;
			} catch {
				// Surfaced as a toast by the mutation; callers treat as no-op.
				return null;
			}
		},
		[openAuxiliaryTabMutation],
	);

	/**
	 * Launches an agent harness in a new terminal session and opens a terminal
	 * tab bound to it. The launch command is assembled in the main process from
	 * the trusted harness registry; this only forwards the selected id. Each
	 * launch starts a fresh conversation, so opening the same harness more than
	 * once yields independent instances rather than reusing one tab. (Only the
	 * post-restart resume path is cwd-scoped; the effect below keeps two
	 * same-harness tabs from resuming into one shared conversation log.)
	 */
	const openTerminalTab = useCallback(
		async ({
			harnessId,
			harnessLabel,
		}: {
			harnessId: string;
			harnessLabel: string;
		}): Promise<OpenSessionTabHandlerResult | null> => {
			const launch = await window.ensemblr?.launchAgentHarness({
				harnessId,
				workspaceId,
			});
			const session = launch?.session ?? null;
			if (!session) {
				const message = launch?.diagnostics.find(
					(diagnostic) => diagnostic.severity === 'error',
				)?.message;
				toast.error('Could not launch agent', {
					description: message ?? `${harnessLabel} is not available.`,
				});
				return null;
			}
			try {
				const result = await openAuxiliaryTabMutation.mutateAsync({
					kind: 'terminal',
					metadata: { harnessId, harnessLabel, terminalId: session.id },
					title: harnessLabel,
				});
				return result.tab ? { chatTabId: result.tab.id } : null;
			} catch {
				// The tab row failed to persist; kill the orphaned PTY so it does not
				// linger without a surface. Surfaced as a toast by the mutation.
				void window.ensemblr?.killTerminalSession({ terminalId: session.id });
				return null;
			}
		},
		[openAuxiliaryTabMutation, workspaceId],
	);

	const closeSessionTabAsync = useCallback(
		async (
			chatTabId: string,
			patch?: Pick<CloseChatTabRequest, 'metadataPatch' | 'title'>,
		): Promise<CloseSessionTabHandlerResult> => {
			await closeMutation.mutateAsync({ chatTabId, ...patch });
			return { replacementChatTabId: null };
		},
		[closeMutation],
	);

	/**
	 * For a closing terminal (harness) tab, kills its live PTY and returns the
	 * close patch stamping the final title + native session id onto the archived
	 * tab so the history row shows the conversation and a restore can reattach it.
	 * Returns undefined for non-terminal tabs, which need no sidecar teardown.
	 */
	const closeTerminalSidecar = useCallback(
		(
			closing: SessionTabModel | undefined,
		): Pick<CloseChatTabRequest, 'metadataPatch' | 'title'> | undefined => {
			if (closing?.kind !== 'terminal' || !closing.terminalId) {
				return undefined;
			}
			const terminalId = closing.terminalId;
			void window.ensemblr?.killTerminalSession({ terminalId });
			const title = terminalTitlesRef.current[terminalId];
			const agentSessionId =
				terminalSessionIdsRef.current[terminalId] ??
				closing.agentSessionId ??
				null;
			// The PTY is gone once closed; drop its ref entries so the maps do not
			// accumulate across a long-lived workspace of spawned/closed terminals.
			delete terminalTitlesRef.current[terminalId];
			delete terminalSessionIdsRef.current[terminalId];
			// Only patch the id when one was captured. Writing null here would clobber
			// a previously-persisted id (e.g. a tab closed before a re-poll), leaving
			// the archived tab unresumable and forcing a fresh session on restore.
			return {
				...(agentSessionId ? { metadataPatch: { agentSessionId } } : {}),
				...(title ? { title } : {}),
			};
		},
		[],
	);

	/** Fire-and-forget close used by the SessionTabState contract. */
	const closeSessionTab = useCallback(
		(chatTabId: string) => {
			if (closingTabIdsRef.current.has(chatTabId)) {
				return;
			}
			const closingIndex = sessionTabs.findIndex(
				(session) => session.id === chatTabId,
			);
			const closing = closingIndex >= 0 ? sessionTabs[closingIndex] : undefined;
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
			closingTabIdsRef.current.add(chatTabId);
			const nextSession = selectNeighborTab(sessionTabs, closingIndex);
			if (activeSession.id === chatTabId && nextSession) {
				onSessionTabChange(nextSession.id);
			}
			const closePatch = closeTerminalSidecar(closing);
			void closeSessionTabAsync(chatTabId, closePatch)
				.then((result) => {
					if (result.replacementChatTabId) {
						onSessionTabChange(result.replacementChatTabId);
					}
				})
				.finally(() => {
					closingTabIdsRef.current.delete(chatTabId);
				});
		},
		[
			activeSession.id,
			closeSessionTabAsync,
			closeTerminalSidecar,
			onSessionTabChange,
			sessionTabs,
		],
	);

	// Map of live terminal-tab PTYs to their tab id and harness label, so a
	// harness that exits can auto-close its tab and a live OSC title can be
	// distinguished from the initial harness-label title.
	const terminalTabByTerminalId = useMemo(() => {
		const map = new Map<
			string,
			{ harnessId: string; harnessLabel: string; tabId: string }
		>();
		for (const session of sessionTabs) {
			if (session.kind === 'terminal' && session.terminalId) {
				map.set(session.terminalId, {
					harnessId: session.harnessId,
					harnessLabel: session.harnessLabel,
					tabId: session.id,
				});
			}
		}
		return map;
	}, [sessionTabs]);

	useEffect(() => {
		if (terminalTabByTerminalId.size === 0) {
			return;
		}
		const unsubscribe = window.ensemblr?.onTerminalLifecycle((event) => {
			const tab = terminalTabByTerminalId.get(event.terminalId);
			if (!tab) {
				return;
			}
			if (event.session.agentSessionId) {
				terminalSessionIdsRef.current[event.terminalId] =
					event.session.agentSessionId;
			}
			const liveTitle = resolveLiveTerminalTitle(
				tab.harnessId,
				tab.harnessLabel,
				event.session,
			);
			if (liveTitle) {
				terminalTitlesRef.current[event.terminalId] = liveTitle;
			} else {
				delete terminalTitlesRef.current[event.terminalId];
			}
			// A stopped/exited harness is archived as restorable; the refs above hold
			// the final title and session id the close path stamps on the tab.
			if (event.session.status !== 'running') {
				closeSessionTab(tab.tabId);
				return;
			}
			setTerminalTitles((previous) => {
				const current = previous[event.terminalId];
				if (liveTitle) {
					return current === liveTitle
						? previous
						: { ...previous, [event.terminalId]: liveTitle };
				}
				if (current === undefined) {
					return previous;
				}
				const next = { ...previous };
				delete next[event.terminalId];
				return next;
			});
		});
		return unsubscribe;
	}, [closeSessionTab, terminalTabByTerminalId]);

	// Terminal tabs a previous app session already respawned this session, so a
	// re-render never resumes the same tab twice. Reset naturally on app reload.
	const autoResumedTabIdsRef = useRef<Set<string>>(new Set());
	// Harness ids that already claimed the cwd-scoped `--continue` resume this app
	// session. When no native session id was captured we fall back to reattaching
	// the harness's most recent cwd conversation, but at most one tab per harness
	// may — two concurrent `--continue` would write and corrupt one shared log.
	const resumedHarnessIdsRef = useRef<Set<string>>(new Set());
	// After a restart, a terminal tab rehydrates with a `terminalId` that points
	// to a PTY the previous process owned and killed. Probe each terminal tab; a
	// null session means it is dead, so respawn the harness and repoint the tab to
	// the new session. With a captured native session id we reattach that exact
	// conversation (`--resume <id>`), which is per-conversation and never collides,
	// so any number of same-harness tabs resume independently. Without an id (short
	// or fast-exiting tabs, or harnesses whose id lands late) we fall back to the
	// cwd `--continue` that reattaches the harness's most recent conversation — the
	// first dead tab of a harness only; further same-harness tabs launch fresh so
	// they never collide on one shared log. The main handler persists the new
	// terminalId, so invalidating re-derives the tab against the live PTY.
	useEffect(() => {
		const api = window.ensemblr;
		if (!api) {
			return;
		}
		const resumed = autoResumedTabIdsRef.current;
		const resumedHarnessIds = resumedHarnessIdsRef.current;
		for (const session of sessionTabs) {
			if (
				session.kind !== 'terminal' ||
				!session.terminalId ||
				!session.harnessId ||
				resumed.has(session.id)
			) {
				continue;
			}
			resumed.add(session.id);
			const { agentSessionId, harnessId, id: chatTabId, terminalId } = session;
			void api
				.terminalSnapshot({ terminalId })
				.then((snapshot) => {
					if (snapshot.session) {
						return;
					}
					// Exact-conversation resume when the native id was captured; it never
					// collides on a shared log. Without an id, fall back to the cwd
					// `--continue` — but only the first dead tab of a harness, since two
					// concurrent `--continue` would corrupt one shared log; extras launch
					// fresh. This mirrors the pre-exact-resume behavior so a tab whose id
					// never persisted still reattaches instead of opening a blank session.
					const cwdContinue =
						!agentSessionId && !resumedHarnessIds.has(harnessId);
					if (cwdContinue) {
						resumedHarnessIds.add(harnessId);
					}
					return api
						.resumeAgentHarness({
							chatTabId,
							fresh: !agentSessionId && !cwdContinue,
							harnessId,
							sessionId: agentSessionId ?? undefined,
							workspaceId,
						})
						.then((result) => {
							if (result.session) {
								invalidateChatTabs();
							} else {
								resumed.delete(chatTabId);
								if (cwdContinue) {
									resumedHarnessIds.delete(harnessId);
								}
							}
						});
				})
				.catch(() => {
					resumed.delete(chatTabId);
				});
		}
	}, [invalidateChatTabs, sessionTabs, workspaceId]);

	/** Persists a drag-and-drop tab order when it differs from the current model. */
	const reorderSessionTabs = useCallback(
		(sessionIds: string[]) => {
			const currentIds = sessionTabs.map((session) => session.id);
			const currentIdSet = new Set(currentIds);
			const nextIds = sessionIds.filter((sessionId) =>
				currentIdSet.has(sessionId),
			);

			if (
				nextIds.length !== currentIds.length ||
				areStringArraysEqual(nextIds, currentIds)
			) {
				return;
			}

			reorderChatTabsMutation.mutate(nextIds);
		},
		[reorderChatTabsMutation, sessionTabs],
	);

	/**
	 * ⌘/Ctrl+W policy for the active tab; see `decideActiveClose` for the branch
	 * rationale. The `reset` branch opens a fresh chat FIRST so the min-one-chat
	 * invariant never breaks, selects it, then closes the previously-sole chat.
	 */
	const closeActiveOrReset = useCallback(() => {
		const decision = decideActiveClose(sessionTabs, effectiveActiveSession);
		if (decision.kind === 'noop') {
			return;
		}
		if (decision.kind === 'close') {
			closeSessionTab(decision.activeId);
			return;
		}
		void openSessionTab().then((opened) => {
			if (!opened) {
				return;
			}
			onSessionTabChange(opened.chatTabId);
			void closeSessionTabAsync(decision.activeId);
		});
	}, [
		closeSessionTab,
		closeSessionTabAsync,
		effectiveActiveSession,
		onSessionTabChange,
		openSessionTab,
		sessionTabs,
	]);

	/**
	 * Reopens a previously-closed tab and selects it. A restored terminal (harness)
	 * tab has no live PTY, so it respawns the harness — reattaching the exact
	 * conversation via its persisted native session id — and repoints the tab. If
	 * the same conversation is already open, it focuses that tab instead of
	 * spawning a second PTY against one shared session log.
	 */
	const restoreSessionTab = useCallback(
		(chatTabId: string) => {
			void restoreChatTab({ chatTabId }).then((result) => {
				const tab = result.tab;
				if (!tab) {
					invalidateChatTabs();
					return;
				}
				if (tab.kind !== 'terminal') {
					invalidateChatTabs();
					onSessionTabChange(tab.id);
					return;
				}
				resumeRestoredTerminalTab(tab, {
					claimTab: (id) => autoResumedTabIdsRef.current.add(id),
					closeTab: closeSessionTabAsync,
					invalidate: invalidateChatTabs,
					releaseTab: (id) => autoResumedTabIdsRef.current.delete(id),
					selectTab: onSessionTabChange,
					sessionTabs,
					workspaceId,
				});
			});
		},
		[
			closeSessionTabAsync,
			invalidateChatTabs,
			onSessionTabChange,
			sessionTabs,
			workspaceId,
		],
	);

	return {
		closeActiveOrReset,
		closedSessions,
		closeSessionTab,
		closeSessionTabAsync,
		effectiveActiveSession,
		openCommentPreviewTab,
		openFilePreviewTab,
		openSessionTab,
		openTerminalTab,
		openTurnDiffTab,
		openWorkspaceFileDiffTab,
		reorderSessionTabs,
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

/**
 * Extracts the final path segment from a slash-separated path.
 * @param path - The path to reduce, with any trailing slashes ignored
 * @returns The last segment, or the trimmed path when it has no separator
 */
function basenameOf(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	return trimmed.split('/').at(-1) ?? trimmed;
}

/**
 * Tab title for a file diff, tagging the short hash when scoped to a commit. The
 * diff glyph on the tab already signals the kind, so the title is just the file
 * name (no "Diff:" prefix).
 */
function diffTabTitle(filePath: string, scope?: WorkspaceGitDiffScope): string {
	const name = basenameOf(filePath);
	if (scope?.kind === 'commit') {
		return `${name} (${scope.commitHash.slice(0, 7)})`;
	}
	return name;
}

/** Shared identity fields every session-tab model carries, derived from the row. */
type SessionTabBaseFields = {
	chatTabId: string;
	id: string;
	label: string;
	piSessionId: string | null;
	status: SessionTabModel['status'];
	summary: string;
	updatedLabel: string;
};

/** Reads a metadata field as a string, falling back when it is absent or non-string. */
function metadataString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

/**
 * Resolves the live label a terminal tab should show from a lifecycle snapshot.
 * Codex and Vibe do not put their conversation title in the OSC window title
 * (Codex uses the cwd, Vibe a static "Vibe"), so main reads it from the harness
 * session log and delivers it as `agentTitle`; for those harnesses prefer it and
 * ignore the OSC title. Every other harness titles from the OSC escape, stripping
 * the leading spinner glyph (which still drives the busy flag elsewhere). Returns
 * null when the title is empty or still just the harness label.
 * @param harnessId - The tab's harness id, used to pick the title source.
 * @param harnessLabel - The default harness label to treat as "no real title".
 * @param session - The lifecycle snapshot carrying the OSC and agent titles.
 * @returns The label to adopt, or null to fall back to the harness label.
 */
function resolveLiveTerminalTitle(
	harnessId: string,
	harnessLabel: string,
	session: { agentTitle: string | null; title: string },
): string | null {
	const candidate = harnessConversationTitleSource(harnessId)
		? (session.agentTitle ?? '').trim()
		: stripHarnessTitleDecoration(session.title);
	return candidate && candidate !== harnessLabel ? candidate : null;
}

/** Builds the `diff` variant, carrying its optional file path, turn id, and scope. */
function toDiffSessionTab(
	base: SessionTabBaseFields,
	tab: ChatTabWire,
): SessionTabModel {
	const diffScope = parseWorkspaceGitDiffScope(tab.metadata.diffScope);
	return {
		...base,
		...(diffScope ? { diffScope } : {}),
		filePath: metadataString(tab.metadata.filePath, '') || null,
		kind: 'diff',
		turnId: metadataString(tab.metadata.turnId, '') || null,
	};
}

/** Builds the `terminal` variant, carrying its backing PTY id and harness identity. */
function toTerminalSessionTab(
	base: SessionTabBaseFields,
	tab: ChatTabWire,
): SessionTabModel {
	return {
		...base,
		agentSessionId: metadataString(tab.metadata.agentSessionId, '') || null,
		harnessId: metadataString(tab.metadata.harnessId, ''),
		harnessLabel: metadataString(tab.metadata.harnessLabel, base.label),
		kind: 'terminal',
		terminalId: metadataString(tab.metadata.terminalId, ''),
	};
}

/** Builds the `document` variant, carrying its optional inline-comment preview. */
function toDocumentSessionTab(
	base: SessionTabBaseFields,
	tab: ChatTabWire,
): SessionTabModel {
	const commentPreview = parseCommentPreview(tab.metadata.commentPreview);
	return {
		...base,
		...(commentPreview ? { commentPreview } : {}),
		filePath: metadataString(tab.metadata.filePath, '') || null,
		kind: 'document',
	};
}

/** Maps an open chat-tab wire row into a renderer-facing `SessionTabModel`. */
function toSessionTabModel(
	tab: ChatTabWire,
	piSession: PiSessionSnapshotWire | undefined,
): SessionTabModel {
	const base: SessionTabBaseFields = {
		chatTabId: tab.id,
		id: tab.id,
		label: tab.title,
		piSessionId: tab.piSessionId,
		status: deriveTabStatus(piSession),
		summary: '',
		updatedLabel: '',
	};
	switch (tab.kind) {
		case 'chat':
			return { ...base, kind: 'chat' };
		case 'diff':
			return toDiffSessionTab(base, tab);
		case 'terminal':
			return toTerminalSessionTab(base, tab);
		case 'document':
			return toDocumentSessionTab(base, tab);
		default:
			return {
				...base,
				filePath: metadataString(tab.metadata.filePath, '') || null,
				kind: tab.kind,
			};
	}
}

const COMMENT_PREVIEW_PROVIDERS: ReadonlySet<string> = new Set([
	'github',
	'github-actions',
	'linear',
	'local',
]);

/**
 * Defensively parses the inline comment payload carried on a `document` tab's
 * metadata (untyped wire `Record<string, unknown>`). Returns `undefined` for
 * regular document tabs or malformed payloads so hydration degrades gracefully.
 */
function parseCommentPreview(
	value: unknown,
): CommentPreviewPayload | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const { detail, id, provider } = record;
	if (
		typeof id !== 'string' ||
		typeof detail !== 'string' ||
		typeof provider !== 'string' ||
		!COMMENT_PREVIEW_PROVIDERS.has(provider)
	) {
		return undefined;
	}
	return {
		...(typeof record.author === 'string' ? { author: record.author } : {}),
		detail,
		id,
		...(typeof record.isResolved === 'boolean'
			? { isResolved: record.isResolved }
			: {}),
		...(typeof record.prNumber === 'number'
			? { prNumber: record.prNumber }
			: {}),
		provider: provider as CommentPreviewPayload['provider'],
		...(typeof record.url === 'string' ? { url: record.url } : {}),
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
	const base: SessionTabBaseFields = {
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
	// Terminal (harness) tabs keep their harness identity so the history row shows
	// the harness icon and a restore can reattach the exact conversation. The
	// backing PTY is gone once closed, so `terminalId` is cleared here: the stored
	// metadata still carries the dead id, so blank it before building the model to
	// keep "has a live PTY" (`terminalId.length > 0`) honest for history rows.
	if (entry.tab.kind === 'terminal') {
		const closedTab: ChatTabWire = {
			...entry.tab,
			metadata: { ...entry.tab.metadata, terminalId: '' },
		};
		return toTerminalSessionTab(base, closedTab);
	}
	return { ...base, kind: 'chat' };
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
