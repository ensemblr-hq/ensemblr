import { StatusBadge } from '@/renderer/components/status-badge';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarRail,
	SidebarTrigger,
} from '@/renderer/components/ui/sidebar';
import { healthTone } from '@/renderer/lib/workbench';
import type {
	AddProjectActionId,
	AddProjectMenuModel,
	ProjectShellModel,
	RecentProject,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	ProjectNavigationState,
	WorkbenchActiveView,
	WorkbenchHealth,
	WorkbenchStaticNavigationTarget,
} from '@/renderer/types/workbench-shell';

import { PinnedWorkspaceGroup } from './pinned-workspace-group';
import { ProjectNavigationGroups } from './project-navigation-groups';
import { SidebarPrimaryNavigation } from './sidebar-primary-navigation';

/** Off-canvas workbench sidebar housing primary nav, pins, projects, and health. */
export function WorkspaceNavigationSidebar({
	activeProject,
	activeView,
	activeWorkspace,
	addProjectMenu,
	health,
	onAddProject,
	onOpenRecentProject,
	onStaticNavigationSelect,
	onWorkspaceSelect,
	projectNavigation,
	projects,
	resolveWorkspaceRouteSearch,
}: {
	activeProject: ProjectShellModel | null;
	activeView: WorkbenchActiveView;
	activeWorkspace: WorkspaceShellModel | null;
	addProjectMenu?: AddProjectMenuModel;
	health: WorkbenchHealth;
	onAddProject?: (action: AddProjectActionId) => void;
	onOpenRecentProject?: (recent: RecentProject) => void;
	onStaticNavigationSelect: (target: WorkbenchStaticNavigationTarget) => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projectNavigation: ProjectNavigationState;
	projects: ProjectShellModel[];
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
}) {
	const activeNavigationProject =
		activeView === 'workspace' ? activeProject : null;
	const activeNavigationWorkspace =
		activeView === 'workspace' ? activeWorkspace : null;

	return (
		<Sidebar className='border-sidebar-border' collapsible='offcanvas'>
			<SidebarHeader className='h-12 border-sidebar-border border-b p-0'>
				<div className='macos-traffic-light-spacer flex h-full shrink-0 items-center justify-end px-2'>
					<SidebarTrigger />
				</div>
			</SidebarHeader>

			<SidebarContent>
				<SidebarPrimaryNavigation
					activeView={activeView}
					onStaticNavigationSelect={onStaticNavigationSelect}
				/>
				<PinnedWorkspaceGroup
					activeProject={activeNavigationProject}
					activeWorkspace={activeNavigationWorkspace}
					onWorkspaceSelect={onWorkspaceSelect}
					projectNavigation={projectNavigation}
					resolveWorkspaceRouteSearch={resolveWorkspaceRouteSearch}
				/>
				<ProjectNavigationGroups
					activeProject={activeNavigationProject}
					activeWorkspace={activeNavigationWorkspace}
					addProjectMenu={addProjectMenu}
					onAddProject={onAddProject}
					onOpenRecentProject={onOpenRecentProject}
					onStaticNavigationSelect={onStaticNavigationSelect}
					onWorkspaceSelect={onWorkspaceSelect}
					projectNavigation={projectNavigation}
					resolveWorkspaceRouteSearch={resolveWorkspaceRouteSearch}
				/>
			</SidebarContent>

			<SidebarHealthFooter health={health} projects={projects} />
			<SidebarRail />
		</Sidebar>
	);
}

/** Bottom-of-sidebar footer showing health badge, repo/workspace counts and detail. */
function SidebarHealthFooter({
	health,
	projects,
}: {
	health: WorkbenchHealth;
	projects: ProjectShellModel[];
}) {
	const repositoryCount = projects.length;
	const workspaceCount = projects.reduce(
		(count, project) => count + project.workspaces.length,
		0,
	);

	return (
		<SidebarFooter className='border-sidebar-border border-t p-2'>
			<div className='flex flex-col gap-1 rounded-md px-2 py-1.5'>
				<StatusBadge tone={healthTone[health.state]}>
					{health.label}
				</StatusBadge>
				<div className='flex items-center gap-2 font-mono text-muted-foreground text-xxs leading-4'>
					<span>{repositoryCount} repos</span>
					<span>{workspaceCount} workspaces</span>
				</div>
				<p className='line-clamp-2 text-muted-foreground text-xxs leading-4'>
					{health.detail}
				</p>
			</div>
		</SidebarFooter>
	);
}
