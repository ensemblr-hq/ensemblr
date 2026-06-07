import { useState } from 'react';

import { ReorderList } from '@/renderer/components/shadix-ui/components/reorder-list';
import {
	SidebarGroup,
	SidebarGroupLabel,
} from '@/renderer/components/ui/sidebar';
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
	WorkbenchStaticNavigationTarget,
} from '@/renderer/types/workbench-shell';

import { CreateWorkspaceSourceDialog } from '../create-workspace-source-dialog';
import { ProjectCreationMenu } from '../project-sidebar/project-creation-menu';
import { ProjectWorkspaceGroup } from './project-workspace-group';

/** Reorderable list of project groups plus the create-workspace dialog mount. */
export function ProjectNavigationGroups({
	activeProject,
	activeWorkspace,
	addProjectMenu,
	onAddProject,
	onOpenRecentProject,
	onStaticNavigationSelect,
	onWorkspaceSelect,
	projectNavigation,
	resolveWorkspaceRouteSearch,
}: {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	addProjectMenu?: AddProjectMenuModel;
	onAddProject?: (action: AddProjectActionId) => void;
	onOpenRecentProject?: (recent: RecentProject) => void;
	onStaticNavigationSelect: (target: WorkbenchStaticNavigationTarget) => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projectNavigation: ProjectNavigationState;
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
}) {
	const {
		collapsedProjectIdSet,
		isProjectReorderLayoutAnimationDisabled,
		isProjectReorderPositionOnlyLayout,
		orderedProjects,
		pinnedWorkspaceIdSet,
		reorderProjects,
		toggleProjectCollapsed,
		toggleWorkspacePinned,
	} = projectNavigation;
	const [createSourceProject, setCreateSourceProject] =
		useState<ProjectShellModel | null>(null);

	return (
		<>
			<SidebarGroup className='gap-1 py-1.5'>
				<SidebarGroupLabel className='h-7 justify-between pr-7'>
					<span className='truncate'>Repositories</span>
				</SidebarGroupLabel>
				<ProjectCreationMenu
					model={addProjectMenu ?? { actions: [], recents: [] }}
					onSelectAction={onAddProject}
					onSelectRecent={onOpenRecentProject}
				/>
			</SidebarGroup>

			<ReorderList
				className='gap-0'
				disableLayoutAnimation={isProjectReorderLayoutAnimationDisabled}
				itemClassName='bg-transparent'
				onReorderFinish={reorderProjects}
				usePositionOnlyLayoutAnimation={isProjectReorderPositionOnlyLayout}
			>
				{orderedProjects.map((project) => {
					const isProjectCollapsed = collapsedProjectIdSet.has(project.id);
					const visibleProjectWorkspaces = project.workspaces.filter(
						(workspace) => !pinnedWorkspaceIdSet.has(workspace.id),
					);

					return (
						<ProjectWorkspaceGroup
							activeProject={activeProject}
							activeWorkspace={activeWorkspace}
							isCollapsed={isProjectCollapsed}
							key={project.id}
							onCreateFromSourceSelect={() => setCreateSourceProject(project)}
							onProjectToggle={() => toggleProjectCollapsed(project.id)}
							onStaticNavigationSelect={onStaticNavigationSelect}
							onWorkspacePinToggle={toggleWorkspacePinned}
							onWorkspaceSelect={onWorkspaceSelect}
							pinnedWorkspaceIdSet={pinnedWorkspaceIdSet}
							project={project}
							resolveWorkspaceRouteSearch={resolveWorkspaceRouteSearch}
							workspaces={visibleProjectWorkspaces}
						/>
					);
				})}
			</ReorderList>

			<CreateWorkspaceSourceDialog
				onOpenChange={(open) => {
					if (!open) {
						setCreateSourceProject(null);
					}
				}}
				open={createSourceProject !== null}
				project={createSourceProject}
				projects={orderedProjects}
			/>
		</>
	);
}
