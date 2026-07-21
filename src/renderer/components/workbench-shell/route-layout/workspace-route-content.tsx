import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { settingsResolutionQuery } from '@/renderer/api/ensemblr';
import { CloseRunningChatDialog } from '@/renderer/components/workbench-shell/conversation-panel/close-running-chat-dialog';
import { useSetupDiagnostics } from '@/renderer/components/workbench-shell/shell-contexts';
import { WorkspaceWorkbenchContent } from '@/renderer/components/workbench-shell/workspace-content';
import { useAskAgentSetupScript } from '@/renderer/hooks/workbench-shell/composer/use-ask-agent-setup-script';
import { useLiveWorkspaceModel } from '@/renderer/hooks/workbench-shell/route-layout/use-live-workspace-model';
import {
	createPlaceholderSession,
	getComposerState,
} from '@/renderer/lib/workbench';
import {
	resolveActionPreference,
	sharedActionPreference,
} from '@/renderer/lib/workbench/action-preference';
import { configuredPreviewUrls } from '@/renderer/lib/workbench/preview-urls';
import { isDockTab } from '@/renderer/lib/workbench/route-search';
import { useRegisterCloseAction } from '@/renderer/state/close-action';
import {
	usePiComposerController,
	useStopPiSession,
} from '@/renderer/state/composer';
import { repoSettingsOverrideAtomFamily } from '@/renderer/state/preferences';
import {
	resolveRunningCloseTarget,
	useCloseRunningChatGuard,
	usePublishWorkspaceDockActivity,
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
import type { FocusViewBroadcast } from '@/shared/agent-control';
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
	const { data: settingsResolution } = useQuery(
		settingsResolutionQuery({
			repositoryId: activeProject.id,
			repositoryPath: activeProject.pathLabel,
		}),
	);
	const { liveWorkspaceFiles, workspaceWithLiveDockTabs: liveWorkspace } =
		useLiveWorkspaceModel({ activeProject, activeWorkspace, terminalSessions });
	// Resolve the repo's configured preview URLs here (where the settings query
	// lives) and attach them to the model so the leaf dock components stay free
	// of data hooks and remain statically renderable.
	const workspaceWithLiveDockTabs = useMemo(
		() => ({
			...liveWorkspace,
			configuredPreviewUrls: configuredPreviewUrls(settingsResolution),
		}),
		[liveWorkspace, settingsResolution],
	);
	usePublishWorkspaceDockActivity({
		dockTabs: workspaceWithLiveDockTabs.dockTabs,
		workspaceId: activeWorkspace.id,
	});
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
	const repoOverrides = useAtomValue(
		repoSettingsOverrideAtomFamily(activeProject.id),
	);
	const piComposer = usePiComposerController({
		chatTabId: activeSession.chatTabId,
		currentPiSessionId: activeSession.piSessionId,
		masterPrompt: resolveActionPreference(
			repoOverrides.actionPreferences?.general ?? '',
			sharedActionPreference(settingsResolution, 'general'),
		),
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

	// An agent-control focus request (main → renderer) brings a tab, dock
	// terminal, or review panel to the foreground. A ref holds the latest apply
	// closure so the subscription is registered once yet always calls the current
	// navigation setters. Applied only for the window showing this workspace.
	/**
	 * Applies an agent-control focus request for the window showing this
	 * workspace, ignoring requests targeting another workspace or carrying a dock
	 * id that is not a valid {@link DockTabId} (the payload is agent-supplied).
	 * @param payload - The focus request broadcast from the main process.
	 */
	const applyFocus = (payload: FocusViewBroadcast) => {
		if (payload.workspaceId !== activeWorkspace.id) {
			return;
		}
		const { target } = payload;
		if (target.kind === 'tab') {
			navigateToWorkspaceChat({ nextChatId: target.chatTabId });
			return;
		}
		if (target.kind === 'dock') {
			if (isDockTab(target.dock)) {
				updateSearch({ dock: target.dock });
			}
			return;
		}
		updateSearch({ review: target.panel });
	};
	const applyFocusRef = useRef(applyFocus);
	useEffect(() => {
		applyFocusRef.current = applyFocus;
	});
	useEffect(
		() =>
			window.ensemblr?.onAgentControlFocusView((payload) =>
				applyFocusRef.current(payload),
			),
		[],
	);

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
