import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { workspaceFilesQuery } from '@/renderer/api/ensemble-queries';
import { useSetupDiagnostics } from '@/renderer/components/workbench-shell/shell-contexts';
import { WorkspaceWorkbenchContent } from '@/renderer/components/workbench-shell/workspace-content';
import type { WorkspaceNavigationSelection } from '@/renderer/lib/workbench';
import {
	createPlaceholderSession,
	getComposerState,
} from '@/renderer/lib/workbench';
import { usePiComposerController } from '@/renderer/state/pi-composer';
import {
	useSessionTabState,
	useWorkspacePanelTabState,
} from '@/renderer/state/workspace';
import type { WorkspaceMainContentState } from '@/renderer/types/components';
import type {
	DockTabId,
	WorkbenchRouteSearch,
} from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';

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
	const panelTabs = useWorkspacePanelTabState({
		activeChatId: activeSession.id,
		activeWorkspace,
		search,
	});
	const activeReviewTab = panelTabs.activeReviewTab;
	const activeDockTab = panelTabs.activeDockTab;
	const { state: setupDiagnosticsState } = useSetupDiagnostics();
	const workspaceFilesQueryState = useQuery(
		workspaceFilesQuery(activeWorkspace.pathLabel ?? null),
	);
	const remoteWorkspaceFiles = useMemo(
		() => workspaceFilesQueryState.data?.files ?? [],
		[workspaceFilesQueryState.data?.files],
	);
	const mergedWorkspaceFiles = useMemo(() => {
		if (remoteWorkspaceFiles.length === 0) {
			return activeWorkspace.workspaceFiles;
		}
		return remoteWorkspaceFiles.map((entry) => ({
			id: `wsfile:${entry.path}`,
			kind: entry.kind,
			name: entry.name,
			path: entry.path,
		}));
	}, [remoteWorkspaceFiles, activeWorkspace.workspaceFiles]);
	const piComposer = usePiComposerController({
		chatTabId: activeSession.chatTabId,
		currentPiSessionId: activeSession.piSessionId,
		workspaceCwd: activeWorkspace.pathLabel,
		workspaceId: activeWorkspace.id,
	});
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
		workspaceFiles: mergedWorkspaceFiles,
	});
	const dockActions = useMemo<WorkbenchDockActions>(
		() => ({
			onNewTerminal: () => undefined,
			onOpenRunPort: () => undefined,
			onOpenSetupScripts: () => undefined,
			onRunScript: () => undefined,
			onRunSetupScript: () => undefined,
			onStopRunScript: () => undefined,
		}),
		[],
	);

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
		<WorkspaceWorkbenchContent
			activeProject={activeProject}
			activeReviewTab={activeReviewTab}
			activeWorkspace={activeWorkspace}
			composer={composer}
			dockActions={dockActions}
			dockTabId={activeDockTab}
			onDockTabChange={(dock: DockTabId) => updateSearch({ dock })}
			onReviewTabChange={(review) => updateSearch({ review })}
			onSessionTabChange={(nextChatId) =>
				navigateToWorkspaceChat({ nextChatId })
			}
			sessionNavigation={sessionNavigation}
			MainContent={WorkspaceMainContentOutlet}
		/>
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
