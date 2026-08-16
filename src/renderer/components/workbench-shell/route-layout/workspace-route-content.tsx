import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useCallback, useMemo } from 'react';
import { settingsResolutionQuery } from '@/renderer/api/ensemblr';
import { CloseRunningChatDialog } from '@/renderer/components/workbench-shell/conversation-panel/close-running-chat-dialog';
import { useSetupDiagnostics } from '@/renderer/components/workbench-shell/shell-contexts';
import { WorkspaceWorkbenchContent } from '@/renderer/components/workbench-shell/workspace-content';
import { useAskAgentSetupScript } from '@/renderer/hooks/workbench-shell/composer/use-ask-agent-setup-script';
import { useAgentControlFocus } from '@/renderer/hooks/workbench-shell/route-layout/use-agent-control-focus';
import { useGuardedSessionClose } from '@/renderer/hooks/workbench-shell/route-layout/use-guarded-session-close';
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
import { useAgentComposerController } from '@/renderer/state/composer';
import { repoSettingsOverrideAtomFamily } from '@/renderer/state/preferences';
import { usePublishActiveChat } from '@/renderer/state/unread';
import {
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
	const agentComposer = useAgentComposerController({
		chatTabId: activeSession.chatTabId,
		currentAgentSessionId: activeSession.agentSessionId,
		isResolvingChatTab: sessionNavigation.isResolvingActiveSession,
		masterPrompt: resolveActionPreference(
			repoOverrides.actionPreferences?.general ?? '',
			sharedActionPreference(settingsResolution, 'general'),
		),
		workspaceCwd: activeWorkspace.pathLabel,
		workspaceId: activeWorkspace.id,
	});
	usePublishActiveChat({
		agentSessionId:
			agentComposer.activeSessionId ?? activeSession.agentSessionId,
		chatTabId: activeSession.chatTabId,
		workspaceId: activeWorkspace.id,
	});
	const { closeGuard, guardedSessionNavigation } = useGuardedSessionClose({
		activeSessionId: activeSession.id,
		agentComposer,
		sessionNavigation,
		workspaceId: activeWorkspace.id,
	});
	const composer = getComposerState({
		activeAgentSessionId: agentComposer.activeSessionId,
		activeSession,
		availableModels: agentComposer.availableModels,
		availableThinkingLevels: agentComposer.availableThinkingLevels,
		contextUsage: agentComposer.contextUsage,
		isStreaming: agentComposer.isStreaming,
		lockedProvider: agentComposer.lockedProvider,
		modelId: agentComposer.modelId,
		onModelChange: agentComposer.onModelChange,
		onPlanModeChange: agentComposer.onPlanModeChange,
		onStop: agentComposer.onStop,
		onSubmit: agentComposer.onSubmit,
		onThinkingChange: agentComposer.onThinkingChange,
		planMode: agentComposer.planMode,
		planUsage: agentComposer.planUsage,
		setupDiagnostics: setupDiagnosticsState.setupDiagnostics,
		setupError: setupDiagnosticsState.setupDiagnosticsError,
		thinkingLevel: agentComposer.thinkingLevel,
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

	/**
	 * Applies an agent-control focus request for the window showing this
	 * workspace, ignoring requests targeting another workspace or carrying a dock
	 * id that is not a valid {@link DockTabId} (the payload is agent-supplied).
	 * @param payload - The focus request broadcast from the main process.
	 */
	function applyFocus(payload: FocusViewBroadcast) {
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
	}
	useAgentControlFocus(applyFocus);

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
