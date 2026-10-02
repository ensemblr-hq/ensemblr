import type { ReactNode } from 'react';

import { SidebarProvider } from '@/renderer/components/ui/sidebar';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { useRouteProfilerMount } from '@/renderer/lib/instrumentation';
import {
	useProjectNavigationState,
	useWatchTerminalActivity,
} from '@/renderer/state/workspace';
import type {
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkbenchShellProps } from '@/renderer/types/workbench-shell';

import { WorkspaceNavigationSidebar } from './navigation-sidebar/navigation-sidebar';

/** Workbench frame — sidebar + tooltip providers wrapping the main content. */
export function WorkbenchFrame({
	activeProject,
	activeView,
	activeWorkspace,
	addProjectMenu,
	children,
	health,
	onAddProject,
	onOpenRecentProject,
	onStaticNavigationSelect,
	onWorkspaceSelect,
	projects,
	resolveWorkspaceRouteSearch,
}: Pick<
	WorkbenchShellProps,
	| 'activeView'
	| 'addProjectMenu'
	| 'health'
	| 'onAddProject'
	| 'onOpenRecentProject'
	| 'onStaticNavigationSelect'
	| 'onWorkspaceSelect'
	| 'projects'
> & {
	activeProject: WorkbenchShellProps['activeProject'] | null;
	activeWorkspace: WorkbenchShellProps['activeWorkspace'] | null;
	children: ReactNode;
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
}) {
	useRouteProfilerMount('WorkbenchFrame');

	// Watch terminal activity here rather than in the workspace route: the frame
	// spans every workspace under the shell layout, so a row keeps its running
	// badge after the user navigates to a different one. It does unmount for
	// routes outside that layout (settings, onboarding, a route boundary), which
	// the watcher's own teardown and re-seed account for.
	useWatchTerminalActivity();
	const projectNavigation = useProjectNavigationState(projects);

	return (
		<TooltipProvider>
			<SidebarProvider>
				<WorkspaceNavigationSidebar
					activeProject={activeProject}
					activeView={activeView}
					activeWorkspace={activeWorkspace}
					addProjectMenu={addProjectMenu}
					health={health}
					onAddProject={onAddProject}
					onOpenRecentProject={onOpenRecentProject}
					onStaticNavigationSelect={onStaticNavigationSelect}
					onWorkspaceSelect={onWorkspaceSelect}
					projectNavigation={projectNavigation}
					projects={projects}
					resolveWorkspaceRouteSearch={resolveWorkspaceRouteSearch}
				/>
				{children}
			</SidebarProvider>
		</TooltipProvider>
	);
}
