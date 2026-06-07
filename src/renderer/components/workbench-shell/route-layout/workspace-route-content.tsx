import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useSetupDiagnostics } from '@/renderer/components/workbench-shell/contexts';
import { WorkspaceWorkbenchContent } from '@/renderer/components/workbench-shell/workspace-content';
import type { WorkspaceNavigationSelection } from '@/renderer/lib/workbench';
import {
	getComposerState,
	getPreferredSession,
} from '@/renderer/lib/workbench';
import { useWorkspacePanelTabState } from '@/renderer/state/workspace';
import type { WorkspaceMainContentState } from '@/renderer/types/components';
import type {
	DockTabId,
	WorkbenchRouteSearch,
} from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';

import { WorkspaceMainContentProvider } from './main-content-context';

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
	const activeSession = getPreferredSession(activeWorkspace, chatId);
	const panelTabs = useWorkspacePanelTabState({
		activeChatId: activeSession.id,
		activeWorkspace,
		search,
	});
	const activeReviewTab = panelTabs.activeReviewTab;
	const activeDockTab = panelTabs.activeDockTab;
	const { state: setupDiagnosticsState } = useSetupDiagnostics();
	const composer = getComposerState({
		activeSession,
		setupDiagnostics: setupDiagnosticsState.setupDiagnostics,
		setupError: setupDiagnosticsState.setupDiagnosticsError,
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
			activeSession={activeSession}
			activeWorkspace={activeWorkspace}
			composer={composer}
			dockActions={dockActions}
			dockTabId={activeDockTab}
			onDockTabChange={(dock: DockTabId) => updateSearch({ dock })}
			onReviewTabChange={(review) => updateSearch({ review })}
			onSessionTabChange={(nextChatId) =>
				navigateToWorkspaceChat({ nextChatId })
			}
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
