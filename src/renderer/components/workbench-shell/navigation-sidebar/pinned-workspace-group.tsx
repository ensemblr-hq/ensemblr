import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
} from '@/renderer/components/ui/sidebar';
import type {
	ProjectShellModel,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { ProjectNavigationState } from '@/renderer/types/workbench-shell';

import { WorkspaceSidebarItem } from '../workspace-sidebar-item/workspace-sidebar-item';

/** Sidebar group rendering user-pinned workspaces above the project list. */
export function PinnedWorkspaceGroup({
	activeProject,
	activeWorkspace,
	onWorkspaceSelect,
	projectNavigation,
	resolveWorkspaceRouteSearch,
}: {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projectNavigation: ProjectNavigationState;
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
}) {
	const {
		pinnedWorkspaceEntries,
		pinnedWorkspaceIdSet,
		toggleWorkspacePinned,
	} = projectNavigation;

	if (!pinnedWorkspaceEntries.length) {
		return null;
	}

	return (
		<SidebarGroup className='gap-1 py-1.5'>
			<SidebarGroupLabel className='h-7 justify-between pr-7'>
				<span className='truncate'>Pinned</span>
			</SidebarGroupLabel>
			<SidebarGroupContent>
				<div className='flex w-full min-w-0 flex-col gap-1'>
					{pinnedWorkspaceEntries.map(({ project, workspace }) => (
						<WorkspaceSidebarItem
							isActive={
								activeProject?.id === project.id &&
								activeWorkspace?.id === workspace.id
							}
							isPinned={pinnedWorkspaceIdSet.has(workspace.id)}
							key={workspace.id}
							onPinToggle={() => toggleWorkspacePinned(workspace.id)}
							onSelect={() => onWorkspaceSelect(project.id, workspace.id)}
							routeSearch={resolveWorkspaceRouteSearch(workspace)}
							workspace={workspace}
						/>
					))}
				</div>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
