import type { ReactNode } from 'react';

import { SidebarProvider } from '@/renderer/components/ui/sidebar';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { useRouteProfilerMount } from '@/renderer/lib/instrumentation';
import { useProjectNavigationState } from '@/renderer/state/workspace';
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
