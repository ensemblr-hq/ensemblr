import { Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { CloseRunningChatDialog } from '@/renderer/components/workbench-shell/conversation-panel/close-running-chat-dialog';
import { useSetupDiagnostics } from '@/renderer/components/workbench-shell/shell-contexts';
import { WorkspaceWorkbenchContent } from '@/renderer/components/workbench-shell/workspace-content';
import { useAskAgentSetupScript } from '@/renderer/hooks/workbench-shell/composer/use-ask-agent-setup-script';
import { useLiveWorkspaceModel } from '@/renderer/hooks/workbench-shell/route-layout/use-live-workspace-model';
import {
	createPlaceholderSession,
	getComposerState,
} from '@/renderer/lib/workbench';
import { useRegisterCloseAction } from '@/renderer/state/close-action';
import {
	usePiComposerController,
	useStopPiSession,
} from '@/renderer/state/composer';
import {
	resolveRunningCloseTarget,
	useCloseRunningChatGuard,
	useSessionTabState,
	useWorkspacePanelTabState,
} from '@/renderer/state/workspace';
import { useWorkspaceDockActions } from '@/renderer/state/workspace/dock-actions';
import { useWorkspaceTerminalSessions } from '@/renderer/state/workspace/terminal-sessions';
import type { WorkspaceMainContentState } from '@/renderer/types/components';
import type {
	DockTabId,
	WorkbenchRouteSearch,
	WorkspaceNavigationSelection,
} from '@/renderer/types/workbench';
import { WorkspaceMainContentProvider } from '../shell-contexts';

/** Workspace shell content — wires panel tabs, composer state, and navigation. */
export function WorkspaceRouteContent({
	chatId,
	search,
	selection,
}: {
	chatId?: string;
	search: WorkbenchRouteSearch;
	selection: WorkspaceNavigationSelection;
}) {
	const navigate = useNavigate();
	const activeProject = selection.project;
	const activeWorkspace = selection.workspace;
	const fallbackActiveSession =
		activeWorkspace.sessions[0] ?? createPlaceholderSession(activeWorkspace);
	const requestedActiveSession = chatId
		? {
				...fallbackActiveSession,
				chatTabId: chatId,
				id: chatId,
			}
		: fallbackActiveSession;
	const handleSessionTabChange = useCallback(
		(nextChatId: string) => {
			navigate({
				params: {
					chatId: nextChatId,
					projectId: activeProject.id,
					workspaceId: activeWorkspace.id,
				},
				search: search,
				to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
			});
		},
		[activeProject.id, activeWorkspace.id, navigate, search],
	);
	const sessionNavigation = useSessionTabState({
		activeSession: requestedActiveSession,
		activeWorkspace,
		bootstrap: true,
		onSessionTabChange: handleSessionTabChange,
	});
	const activeSession = sessionNavigation.effectiveActiveSession;
	const terminalSessions = useWorkspaceTerminalSessions(activeWorkspace.id);
	const { liveWorkspaceFiles, workspaceWithLiveDockTabs } =
		useLiveWorkspaceModel({ activeProject, activeWorkspace, terminalSessions });
	// Tab preference validation must see the LIVE dock tabs (terminal:<id>),
	// not the placeholder model, or terminal tab clicks bounce back to setup.
	const panelTabs = useWorkspacePanelTabState({
		activeChatId: activeSession.id,
		activeWorkspace: workspaceWithLiveDockTabs,
		search,
	});
	const activeReviewTab = panelTabs.activeReviewTab;
	const activeDockTab = panelTabs.activeDockTab;
	const { state: setupDiagnosticsState } = useSetupDiagnostics();
	const piComposer = usePiComposerController({
		chatTabId: activeSession.chatTabId,
		currentPiSessionId: activeSession.piSessionId,
		workspaceCwd: activeWorkspace.pathLabel,
		workspaceId: activeWorkspace.id,
	});
	// ⌘/Ctrl+W and tab-strip closes both flow through a running-chat guard. The
	// underlying close policy (close, no-op, or reset the sole chat) still lives
	// in `useSessionTabState` (see `decideActiveClose`); the guard only adds a
	// confirm-then-cancel step when the target tab's agent is mid-turn. Wired
	// here because this is the one place holding both the registered close action
	// and the composer's live streaming state.
	const closeGuard = useCloseRunningChatGuard();
	const stopPiSessionById = useStopPiSession(activeWorkspace.id);
	const stopFor = useCallback(
		(targetId: string, piSessionId: string | null) => async () => {
			// The active tab owns the live composer, so prefer its `onStop` (it also
			// clears the composer's optimistic pending session). Background tabs have
			// no live composer; cancel them by session id instead.
			if (targetId === activeSession.id) {
				await piComposer.onStop();
				return;
			}
			if (piSessionId) {
				await stopPiSessionById(piSessionId);
			}
		},
		[activeSession.id, piComposer.onStop, stopPiSessionById],
	);
	const requestActiveClose = useCallback(() => {
		closeGuard.requestClose({
			isRunning: piComposer.isStreaming,
			onClose: sessionNavigation.closeActiveOrReset,
			onStop: piComposer.onStop,
		});
	}, [
		closeGuard,
		piComposer.isStreaming,
		piComposer.onStop,
		sessionNavigation.closeActiveOrReset,
	]);
	useRegisterCloseAction(requestActiveClose);
	const requestTabClose = useCallback(
		(targetId: string) => {
			const target = resolveRunningCloseTarget({
				activeSessionId: activeSession.id,
				isActiveStreaming: piComposer.isStreaming,
				tabs: sessionNavigation.sessionTabs,
				targetId,
			});
			closeGuard.requestClose({
				isRunning: target.isRunning,
				onClose: () => sessionNavigation.closeSessionTab(targetId),
				onStop: stopFor(targetId, target.piSessionId),
			});
		},
		[
			activeSession.id,
			closeGuard,
			piComposer.isStreaming,
			sessionNavigation,
			stopFor,
		],
	);
	const guardedSessionNavigation = useMemo(
		() => ({ ...sessionNavigation, closeSessionTab: requestTabClose }),
		[requestTabClose, sessionNavigation],
	);
	const composer = getComposerState({
		activePiSessionId: piComposer.activeSessionId,
		activeSession,
		availableModels: piComposer.availableModels,
		availableThinkingLevels: piComposer.availableThinkingLevels,
		contextUsage: piComposer.contextUsage,
		isStreaming: piComposer.isStreaming,
		modelId: piComposer.modelId,
		onModelChange: piComposer.onModelChange,
		onStop: piComposer.onStop,
		onSubmit: piComposer.onSubmit,
		onThinkingChange: piComposer.onThinkingChange,
		setupDiagnostics: setupDiagnosticsState.setupDiagnostics,
		setupError: setupDiagnosticsState.setupDiagnosticsError,
		thinkingLevel: piComposer.thinkingLevel,
		workspaceCwd: activeWorkspace.pathLabel,
		workspaceFiles: liveWorkspaceFiles,
	});
	const askAgentSetupScript = useAskAgentSetupScript({
		activeChatTabId: activeSession.chatTabId,
		openSessionTab: sessionNavigation.openSessionTab,
		selectChat: handleSessionTabChange,
	});
	const dockActions = useWorkspaceDockActions({
		activeDockTab,
		askAgentSetupScript,
		closeTerminal: terminalSessions.closeTerminal,
		createTerminal: terminalSessions.createTerminal,
		repositoryId: activeProject.id,
		sessions: terminalSessions.sessions,
		updateSearch,
		workspaceId: activeWorkspace.id,
	});

	/** Navigates to the canonical chat route, preserving existing search state. */
	function navigateToWorkspaceChat({
		nextChatId,
		nextSearch,
	}: {
		nextChatId: string;
		nextSearch?: WorkbenchRouteSearch;
	}) {
		navigate({
			params: {
				chatId: nextChatId,
				projectId: activeProject.id,
				workspaceId: activeWorkspace.id,
			},
			search: {
				dock: activeDockTab,
				review: activeReviewTab,
				...nextSearch,
			},
			to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
		});
	}

	/** Persists tab changes to local prefs and forwards them to the URL. */
	function updateSearch(nextSearch: WorkbenchRouteSearch) {
		if (nextSearch.review) {
			panelTabs.setWorkspaceReviewTab(activeWorkspace.id, nextSearch.review);
		}
		if (nextSearch.dock) {
			panelTabs.setWorkspaceDockTab(activeWorkspace.id, nextSearch.dock);
		}

		navigateToWorkspaceChat({
			nextChatId: activeSession.id,
			nextSearch,
		});
	}

	return (
		<>
			<WorkspaceWorkbenchContent
				activeProject={activeProject}
				activeReviewTab={activeReviewTab}
				activeWorkspace={workspaceWithLiveDockTabs}
				composer={composer}
				dockActions={dockActions}
				dockTabId={activeDockTab}
				onDockTabChange={(dock: DockTabId) => updateSearch({ dock })}
				onReviewTabChange={(review) => updateSearch({ review })}
				onSessionTabChange={(nextChatId) =>
					navigateToWorkspaceChat({ nextChatId })
				}
				sessionNavigation={guardedSessionNavigation}
				MainContent={WorkspaceMainContentOutlet}
			/>
			<CloseRunningChatDialog
				onCancel={closeGuard.cancelClose}
				onConfirm={closeGuard.confirmClose}
				open={closeGuard.isConfirming}
			/>
		</>
	);
}

/** Provides workspace main-content state to the nested chat route via context. */
function WorkspaceMainContentOutlet(state: WorkspaceMainContentState) {
	return (
		<WorkspaceMainContentProvider value={state}>
			<Outlet />
		</WorkspaceMainContentProvider>
	);
}
