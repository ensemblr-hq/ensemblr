import type { ComponentType } from 'react';

import { useRouteProfilerMount } from '@/renderer/lib/instrumentation/route-profiler';
import { useSessionTabState } from '@/renderer/state/workspace';
import type { WorkspaceMainContentState } from '@/renderer/types/components';
import type { WorkbenchShellProps } from '@/renderer/types/workbench-shell';
import { WorkbenchPanelLayout } from './panel-layout';
import { WorkbenchLayoutProvider } from './shell-contexts';
import { useDockController } from './use-dock-controller';
import { useRightSidebarController } from './use-right-sidebar-controller';

/**
 * Active-workspace shell content — owns review/dock collapse state, viewport
 * syncing, and session-tab navigation.
 */
export function WorkspaceWorkbenchContent({
	activeProject,
	activeReviewTab,
	activeSession,
	activeWorkspace,
	composer,
	dockActions,
	dockTabId,
	onDockTabChange,
	onReviewTabChange,
	onSessionTabChange,
	MainContent,
}: Pick<
	WorkbenchShellProps,
	| 'activeProject'
	| 'activeReviewTab'
	| 'activeSession'
	| 'activeWorkspace'
	| 'composer'
	| 'dockActions'
	| 'dockTabId'
	| 'onDockTabChange'
	| 'onReviewTabChange'
	| 'onSessionTabChange'
> & {
	MainContent: ComponentType<WorkspaceMainContentState>;
}) {
	useRouteProfilerMount('WorkspaceWorkbenchContent');

	const rightSidebar = useRightSidebarController();
	const dock = useDockController();
	const sessionNavigation = useSessionTabState({
		activeSession,
		activeWorkspace,
		onSessionTabChange,
	});
	const mainContentState: WorkspaceMainContentState = {
		activeSession: sessionNavigation.effectiveActiveSession,
		activeWorkspace,
		closedSessions: sessionNavigation.closedSessions,
		composer,
		onSessionTabChange,
		onSessionTabClose: sessionNavigation.closeSessionTab,
		onSessionTabOpen: sessionNavigation.openSessionTab,
		onSessionTabRestore: sessionNavigation.restoreSessionTab,
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
