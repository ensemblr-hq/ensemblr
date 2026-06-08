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
import { ProjectCreationMenu } from '../project-sidebar/project-creation-menu';
import {
	ProjectNavigationDialogs,
	useProjectNavigationDialogs,
} from './project-navigation-dialogs';
import { ProjectWorkspaceGroup } from './project-workspace-group';
import {
	useArchiveProjectAction,
	useArchiveWorkspaceAction,
	useCreateWorkspaceFromProject,
} from './use-project-navigation-actions';

/** Reorderable list of project groups plus the create-workspace dialog mount. */
export function ProjectNavigationGroups({
	activeProject,
	activeWorkspace,
	addProjectMenu,
	onAddProject,
	onOpenRecentProject,
	onStaticNavigationSelect,
	onWorkspaceRenameSelect,
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
	onWorkspaceRenameSelect?: (workspace: WorkspaceShellModel) => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projectNavigation: ProjectNavigationState;
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
}) {
	const {
		collapsedProjectIdSet,
		disableProjectReorderLayoutAnimation,
		isProjectReorderLayoutAnimationDisabled,
		isProjectReorderPositionOnlyLayout,
		orderedProjects,
		pinnedWorkspaceIdSet,
		reorderProjects,
		toggleProjectCollapsed,
		toggleWorkspacePinned,
	} = projectNavigation;

	const {
		controller,
		setArchiveProjectTarget,
		setArchiveWorkspaceTarget,
		setCreateSourceProject,
		state,
	} = useProjectNavigationDialogs();

	const handleWorkspaceArchived = useArchiveWorkspaceAction({
		activeProjectId: activeProject?.id ?? null,
		activeWorkspaceId: activeWorkspace?.id ?? null,
		disableProjectReorderLayoutAnimation,
		orderedProjects,
	});

	const handleProjectArchived = useArchiveProjectAction({
		activeProjectId: activeProject?.id ?? null,
		disableProjectReorderLayoutAnimation,
		orderedProjects,
	});

	const { create: handleCreateWorkspace } = useCreateWorkspaceFromProject({
		disableProjectReorderLayoutAnimation,
	});

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
							onCreateFromSourceSelect={() =>
								controller.openCreateSource(project)
							}
							onCreateWorkspaceSelect={() => {
								void handleCreateWorkspace(project);
							}}
							onProjectArchiveSelect={() =>
								controller.openArchiveProject(project)
							}
							onProjectToggle={() => toggleProjectCollapsed(project.id)}
							onStaticNavigationSelect={onStaticNavigationSelect}
							onWorkspacePinToggle={toggleWorkspacePinned}
							onWorkspaceRenameSelect={onWorkspaceRenameSelect}
							onWorkspaceArchiveSelect={(workspace) =>
								controller.openArchiveWorkspace(workspace)
							}
							onWorkspaceSelect={onWorkspaceSelect}
							pinnedWorkspaceIdSet={pinnedWorkspaceIdSet}
							project={project}
							resolveWorkspaceRouteSearch={resolveWorkspaceRouteSearch}
							workspaces={visibleProjectWorkspaces}
						/>
					);
				})}
			</ReorderList>

			<ProjectNavigationDialogs
				archiveProjectTarget={state.archiveProjectTarget}
				archiveWorkspaceTarget={state.archiveWorkspaceTarget}
				createSourceProject={state.createSourceProject}
				onProjectArchived={handleProjectArchived}
				onWorkspaceArchived={handleWorkspaceArchived}
				orderedProjects={orderedProjects}
				setArchiveProjectTarget={setArchiveProjectTarget}
				setArchiveWorkspaceTarget={setArchiveWorkspaceTarget}
				setCreateSourceProject={setCreateSourceProject}
			/>
		</>
	);
}
