import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtomCallback } from 'jotai/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
	agentSessionsForWorkspaceQuery,
	closeChatTab,
	ensemblrQueryKeys,
	listChatTabsQuery,
	listClosedChatTabsWithSummaryQuery,
	openChatTab,
	removeOpenChatTabFromCache,
	reorderChatTabs,
	restoreChatTab,
	writeOpenedChatTabToCache,
	writeReorderedChatTabsToCache,
} from '@/renderer/api/ensemblr-queries';
import { useAgentSessionStatusInvalidation } from '@/renderer/hooks/workspace/use-agent-session-status-invalidation';
import { useWorkspaceAgentBusy } from '@/renderer/hooks/workspace/use-workspace-agent-busy';
import { areStringArraysEqual } from '@/renderer/lib/ordered-ids';
import {
	forgetComposerDraft,
	useDropComposerSubmits,
} from '@/renderer/state/composer';
import { useConversationScrollOffsets } from '@/renderer/state/conversation-scroll';
import { forgetChatOverrides } from '@/renderer/state/preferences';
import type { LiveTerminalTitle } from '@/renderer/state/workspace/terminal-tab-title';
import type {
	PullRequestCommentSummary,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	SessionTabPlacement,
	SessionTabState,
} from '@/renderer/types/workbench-shell';
import type { AgentSessionSnapshotWire } from '@/shared/ipc/contracts/agent-session';
import type {
	ChatTabWire,
	CloseChatTabRequest,
	ClosedChatTabEntryWire,
	ListChatTabsResult,
	OpenChatTabRequest,
} from '@/shared/ipc/contracts/chat-tab';
import { parseWorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';
import { useWorkspaceChatBootstrap } from './chat-tab-bootstrap';
import { useChatTabOpenMutations } from './chat-tab-open-mutations';
import { parseCommentPreview } from './comment-preview-tab';
import { usePreviewTabSlot } from './preview-tab-slot';
import { sessionVisitOrderByWorkspaceAtom } from './selection-atoms';
import { decideActiveClose } from './session-tab-close';
import { useSessionTabCloseFlow } from './session-tab-close-flow';
import { resolveInsertAnchorId } from './session-tab-insert-anchor';
import { useSessionTabModels } from './session-tab-models';
import { useSessionTabOpeners } from './session-tab-openers';
import { useSessionTabReorder } from './session-tab-reorder';
import { useTerminalTabLiveTitles } from './terminal-tab-live-titles';
import {
	readHarnessSessionId,
	resumeRestoredTerminalTab,
} from './terminal-tab-restore';
import { useTerminalTabAutoResume } from './terminal-tab-resume';

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
	/** True while the routed tab has no row in the list yet, so its session is unknown. */
	isResolvingActiveSession: boolean;
	openSessionTab: (options?: {
		placement?: SessionTabPlacement;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	openCommentPreviewTab: (input: {
		comment: PullRequestCommentSummary;
		preview?: boolean;
		prNumber?: number;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	openFilePreviewTab: (input: {
		filePath: string;
		preview?: boolean;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	openTurnDiffTab: (input: {
		label: string;
		preview?: boolean;
		turnId: string;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	openTerminalTab: (input: {
		harnessId: string;
		harnessLabel: string;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	openWorkspaceFileDiffTab: (input: {
		filePath: string;
		preview?: boolean;
	}) => Promise<OpenSessionTabHandlerResult | null>;
	pinSessionTab: (chatTabId: string) => void;
	closeSessionTabAsync: (
		chatTabId: string,
	) => Promise<CloseSessionTabHandlerResult>;
	closeActiveOrReset: () => void;
} {
	const workspaceId = activeWorkspace.id;
	const { t } = useTranslation();
	const readSessionVisits = useAtomCallback(
		useCallback((get) => get(sessionVisitOrderByWorkspaceAtom), []),
	);
	const queryClient = useQueryClient();
	const scrollOffsets = useConversationScrollOffsets();
	const dropComposerSubmits = useDropComposerSubmits();
	// Live window titles agent harnesses emit via OSC escapes, keyed by their
	// backing terminal id, so a running agent's own conversation title surfaces
	// on its tab (falling back to the harness label until one arrives). Display
	// and full forms travel as one value so a tab's label and its tooltip can
	// never be sourced from different titles.
	const [terminalTitles, setTerminalTitles] = useState<
		Record<string, LiveTerminalTitle>
	>({});
	// Latest live title and native session id per terminal, mirrored into refs so
	// the close path can stamp them onto the archived tab without re-subscribing.
	// Keyed by backing terminal id.
	const terminalTitlesRef = useRef<Record<string, LiveTerminalTitle>>({});
	const terminalSessionIdsRef = useRef<Record<string, string>>({});
	// Agent-terminal busy state, inferred from the spinner glyph a harness
	// animates in its OSC title. Owned by a workspace-scoped hook so the same
	// signal drives both this tab strip and the workspace sidebar/card rows.
	const { busyTerminalIds } = useWorkspaceAgentBusy(workspaceId);

	const {
		closedSessions,
		effectiveActiveSession,
		isResolvingActiveSession,
		sessionTabs,
		hasSettledTabList,
		openTabCount,
	} = useSessionTabModels({
		activeSession,
		activeWorkspace,
		busyTerminalIds,
		terminalTitles,
	});

	const insertAnchorTabId = resolveInsertAnchorId(
		sessionTabs,
		effectiveActiveSession.id,
	);

	const { invalidateChatTabs, openAuxiliaryTabMutation, openChatTabMutation } =
		useChatTabOpenMutations({ insertAnchorTabId, workspaceId });

	useWorkspaceChatBootstrap({
		enabled: bootstrap,
		hasSettledTabList,
		invalidateChatTabs,
		onSessionTabChange,
		openChatTab: openChatTabMutation.mutate,
		openTabCount,
		workspaceId,
	});

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
				scrollOffsets.forget(chatTabId);
			}
			// Queued auto-submits are not restorable the way a draft is: they drain
			// only through a mounted composer, which a closed tab no longer has. Drop
			// them either way and say so, rather than leave a chore the user was told
			// had been handed over sitting undeliverable.
			const droppedSubmits = dropComposerSubmits(chatTabId);
			if (droppedSubmits > 0) {
				toast.warning(
					t('errors:chat-tab.dropped-submits.title', {
						count: droppedSubmits,
						defaultValue_one: 'Cancelled a queued action for the closed chat.',
						defaultValue_other:
							'Cancelled {{count}} queued actions for the closed chat.',
					}),
				);
			}
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.closedChatTabsWithSummary(workspaceId),
			});
		},
	});

	const { pinSessionTab, reorderSessionTabs } = useSessionTabReorder({
		invalidateChatTabs,
		sessionTabs,
		workspaceId,
	});

	const {
		openCommentPreviewTab,
		openFilePreviewTab,
		openSessionTab,
		openTerminalTab,
		openTurnDiffTab,
		openWorkspaceFileDiffTab,
	} = useSessionTabOpeners({
		insertAnchorTabId,
		openAuxiliaryTab: openAuxiliaryTabMutation.mutateAsync,
		openChatTab: openChatTabMutation.mutateAsync,
		workspaceId,
	});

	const { closeSessionTab, closeSessionTabAsync } = useSessionTabCloseFlow({
		activeSessionId: activeSession.id,
		closeChatTab: closeMutation.mutateAsync,
		onSessionTabChange,
		readVisitOrder: () => readSessionVisits()[workspaceId],
		sessionTabs,
		terminalSessionIdsRef,
		terminalTitlesRef,
	});

	// Map of live terminal-tab PTYs to their tab id and harness label, so a
	// harness that exits can auto-close its tab and a live OSC title can be
	// distinguished from the initial harness-label title.
	useTerminalTabLiveTitles({
		closeSessionTab,
		sessionTabs,
		setTerminalTitles,
		terminalSessionIdsRef,
		terminalTitlesRef,
	});

	const { claimTab, releaseTab } = useTerminalTabAutoResume({
		closeSessionTabAsync,
		invalidateChatTabs,
		sessionTabs,
		workspaceId,
	});

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
					claimTab,
					closeTab: closeSessionTabAsync,
					invalidate: invalidateChatTabs,
					releaseTab,
					selectTab: onSessionTabChange,
					sessionTabs,
					workspaceId,
				});
			});
		},
		[
			claimTab,
			closeSessionTabAsync,
			invalidateChatTabs,
			onSessionTabChange,
			releaseTab,
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
		isResolvingActiveSession,
		openCommentPreviewTab,
		openFilePreviewTab,
		openSessionTab,
		openTerminalTab,
		openTurnDiffTab,
		openWorkspaceFileDiffTab,
		pinSessionTab,
		reorderSessionTabs,
		restoreSessionTab,
		sessionTabs,
	};
}
