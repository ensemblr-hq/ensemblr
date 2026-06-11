import type { ComponentType } from 'react';

import { useRouteProfilerMount } from '@/renderer/lib/instrumentation';
import type { WorkspaceMainContentState } from '@/renderer/types/components';
import type {
	SessionTabActions,
	SessionTabState,
	WorkbenchShellProps,
} from '@/renderer/types/workbench-shell';
import { WorkbenchPanelLayout } from './panel-layout';
import { WorkbenchLayoutProvider } from './shell-contexts';
import { useDockController } from './use-dock-controller';
import { useRightSidebarController } from './use-right-sidebar-controller';

/**
 * Active-workspace shell content — owns review/dock collapse state and
 * viewport syncing. Session-tab state is owned by the route shell (the single
 * `useSessionTabState` instance) and passed in via `sessionNavigation`.
 */
export function WorkspaceWorkbenchContent({
	activeProject,
	activeReviewTab,
	activeWorkspace,
	composer,
	dockActions,
	dockTabId,
	onDockTabChange,
	onReviewTabChange,
	onSessionTabChange,
	sessionNavigation,
	MainContent,
}: Pick<
	WorkbenchShellProps,
	| 'activeProject'
	| 'activeReviewTab'
	| 'activeWorkspace'
	| 'composer'
	| 'dockActions'
	| 'dockTabId'
	| 'onDockTabChange'
	| 'onReviewTabChange'
	| 'onSessionTabChange'
> & {
	MainContent: ComponentType<WorkspaceMainContentState>;
	sessionNavigation: SessionTabState & SessionTabActions;
}) {
	useRouteProfilerMount('WorkspaceWorkbenchContent');

	const rightSidebar = useRightSidebarController();
	const dock = useDockController();
	const mainContentState: WorkspaceMainContentState = {
		activeSession: sessionNavigation.effectiveActiveSession,
		activeWorkspace,
		closedSessions: sessionNavigation.closedSessions,
		composer,
		onFilePreviewOpen: sessionNavigation.openFilePreviewTab,
		onSessionTabChange,
		onSessionTabClose: sessionNavigation.closeSessionTab,
		onSessionTabOpen: sessionNavigation.openSessionTab,
		onSessionTabRestore: sessionNavigation.restoreSessionTab,
		onTurnDiffOpen: sessionNavigation.openTurnDiffTab,
		sessionTabs: sessionNavigation.sessionTabs,
	};

	return (
		<WorkbenchLayoutProvider
			value={{
				state: {
					isDockCollapsed: dock.isDockCollapsed,
					isRightSidebarCollapsed: rightSidebar.isRightSidebarCollapsed,
					rightSidebarSizePercent: rightSidebar.rightSidebarSizePercent,
				},
				actions: {
					collapseRightSidebar: rightSidebar.collapseRightSidebar,
					expandRightSidebar: rightSidebar.expandRightSidebar,
					toggleDockPanel: dock.toggleDockPanel,
					handleDockResize: dock.handleDockResize,
					handleRightSidebarResize: rightSidebar.handleRightSidebarResize,
				},
				meta: {
					dockPanelRef: dock.dockPanelRef,
					rightSidebarPanelRef: rightSidebar.rightSidebarPanelRef,
				},
			}}
		>
			<WorkbenchPanelLayout
				activeProject={activeProject}
				activeReviewTab={activeReviewTab}
				activeWorkspace={activeWorkspace}
				dockActions={dockActions}
				dockTabId={dockTabId}
				mainContent={<MainContent {...mainContentState} />}
				onDockTabChange={onDockTabChange}
				onReviewTabChange={onReviewTabChange}
			/>
		</WorkbenchLayoutProvider>
	);
}
