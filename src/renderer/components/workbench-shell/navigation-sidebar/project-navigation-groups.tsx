import { useQueryClient } from '@tanstack/react-query';

import { prefetchWorkspaceSources } from '@/renderer/api/ensemblr';
import { ReorderList } from '@/renderer/components/ui/reorder-list';
import {
	SidebarGroup,
	SidebarGroupLabel,
} from '@/renderer/components/ui/sidebar';
import {
	useArchiveBrowseChange,
	useArchiveProjectAction,
	useCreateWorkspaceFromProject,
} from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-project-navigation-actions';
import { useRemoveWorkspaceAction } from '@/renderer/hooks/workbench-shell/use-remove-workspace-action';
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
		setBrowseArchiveProject,
		setCreateSourceProject,
		setDeleteProjectTarget,
		setDeleteWorkspaceTarget,
		state,
	} = useProjectNavigationDialogs();

	// Lifecycle archive + destructive delete share the same post-action cache
	// invalidation + navigation fallback. The dialogs decide which IPC ran; the
	// callback only sees the workspace/project id that disappeared from the
	// active surface.
	const handleWorkspaceLifecycleAction = useRemoveWorkspaceAction({
		activeWorkspaceId: activeWorkspace?.id ?? null,
	});

	const handleProjectLifecycleAction = useArchiveProjectAction({
		activeProjectId: activeProject?.id ?? null,
		orderedProjects,
	});

	const { create: handleCreateWorkspace, creatingProjectIds } =
		useCreateWorkspaceFromProject();

	const queryClient = useQueryClient();
	const handleArchiveBrowseChange = useArchiveBrowseChange();

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
				itemClassName='bg-transparent'
				onReorderFinish={reorderProjects}
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
							isCreatingWorkspace={creatingProjectIds.has(project.id)}
							key={project.id}
							onCreateFromSourcePrefetch={() =>
								prefetchWorkspaceSources(queryClient, project.id)
							}
							onCreateFromSourceSelect={() =>
								controller.openCreateSource(project)
							}
							onCreateWorkspaceSelect={() => {
								void handleCreateWorkspace(project);
							}}
							onProjectArchiveSelect={() =>
								controller.openArchiveProject(project)
							}
							onProjectBrowseArchiveSelect={() =>
								controller.openBrowseArchive(project)
							}
							onProjectDeleteSelect={() =>
								controller.openDeleteProject(project)
							}
							onProjectToggle={() => toggleProjectCollapsed(project.id)}
							onStaticNavigationSelect={onStaticNavigationSelect}
							onWorkspacePinToggle={toggleWorkspacePinned}
							onWorkspaceRenameSelect={onWorkspaceRenameSelect}
							onWorkspaceArchiveSelect={(workspace) =>
								controller.openArchiveWorkspace(workspace)
							}
							onWorkspaceDeleteSelect={(workspace) =>
								controller.openDeleteWorkspace(workspace)
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
				browseArchiveProject={state.browseArchiveProject}
				createSourceProject={state.createSourceProject}
				deleteProjectTarget={state.deleteProjectTarget}
				deleteWorkspaceTarget={state.deleteWorkspaceTarget}
				onArchiveBrowseChange={handleArchiveBrowseChange}
				onCreateWorkspaceFromSource={(project, seed) => {
					void handleCreateWorkspace(project, seed);
				}}
				onOpenWorkspace={(project, workspaceId) => {
					onWorkspaceSelect(project.id, workspaceId);
				}}
				onProjectArchived={handleProjectLifecycleAction}
				onProjectDeleted={handleProjectLifecycleAction}
				onWorkspaceArchived={handleWorkspaceLifecycleAction}
				onWorkspaceDeleted={handleWorkspaceLifecycleAction}
				orderedProjects={orderedProjects}
				setArchiveProjectTarget={setArchiveProjectTarget}
				setArchiveWorkspaceTarget={setArchiveWorkspaceTarget}
				setBrowseArchiveProject={setBrowseArchiveProject}
				setCreateSourceProject={setCreateSourceProject}
				setDeleteProjectTarget={setDeleteProjectTarget}
				setDeleteWorkspaceTarget={setDeleteWorkspaceTarget}
			/>
		</>
	);
}
