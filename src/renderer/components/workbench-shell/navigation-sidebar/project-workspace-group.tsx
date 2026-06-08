import {
	SidebarGroup,
	SidebarGroupContent,
} from '@/renderer/components/ui/sidebar';
import { cn } from '@/renderer/lib/utils';
import type {
	ProjectShellModel,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkbenchStaticNavigationTarget } from '@/renderer/types/workbench-shell';

import { ProjectSidebarHeader } from '../project-sidebar/project-sidebar-header';
import { WorkspaceSidebarItem } from '../workspace-sidebar-item/workspace-sidebar-item';

/** Collapsible per-project workspace group rendered inside the reorder list. */
export function ProjectWorkspaceGroup({
	activeProject,
	activeWorkspace,
	isCollapsed,
	onCreateFromSourceSelect,
	onCreateWorkspaceSelect,
	onProjectArchiveSelect,
	onProjectBrowseArchiveSelect,
	onProjectDeleteSelect,
	onProjectToggle,
	onStaticNavigationSelect,
	onWorkspaceArchiveSelect,
	onWorkspaceDeleteSelect,
	onWorkspacePinToggle,
	onWorkspaceRenameSelect,
	onWorkspaceSelect,
	pinnedWorkspaceIdSet,
	project,
	resolveWorkspaceRouteSearch,
	workspaces,
}: {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	isCollapsed: boolean;
	onCreateFromSourceSelect: () => void;
	onCreateWorkspaceSelect: () => void;
	onProjectArchiveSelect?: () => void;
	onProjectBrowseArchiveSelect?: () => void;
	onProjectDeleteSelect?: () => void;
	onProjectToggle: () => void;
	onStaticNavigationSelect: (target: WorkbenchStaticNavigationTarget) => void;
	onWorkspaceArchiveSelect?: (workspace: WorkspaceShellModel) => void;
	onWorkspaceDeleteSelect?: (workspace: WorkspaceShellModel) => void;
	onWorkspacePinToggle: (workspaceId: string) => void;
	onWorkspaceRenameSelect?: (workspace: WorkspaceShellModel) => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	pinnedWorkspaceIdSet: Set<string>;
	project: ProjectShellModel;
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
	workspaces: WorkspaceShellModel[];
}) {
	return (
		<SidebarGroup
			aria-label={`Reorder repository ${project.name}`}
			className='gap-1 py-1.5'
		>
			<ProjectSidebarHeader
				isCollapsed={isCollapsed}
				onArchiveSelect={onProjectArchiveSelect}
				onBrowseArchiveSelect={onProjectBrowseArchiveSelect}
				onCreateFromSourceSelect={onCreateFromSourceSelect}
				onCreateWorkspaceSelect={onCreateWorkspaceSelect}
				onDeleteSelect={onProjectDeleteSelect}
				onRepositorySettingsSelect={() =>
					onStaticNavigationSelect({
						kind: 'repo-settings',
						repoId: project.id,
					})
				}
				onToggle={onProjectToggle}
				project={project}
				workspaceCount={workspaces.length}
			/>
			<SidebarGroupContent
				aria-hidden={isCollapsed}
				className={cn(
					'project-workspace-collapse',
					isCollapsed && 'is-collapsed',
				)}
			>
				<div className='project-workspace-collapse-inner'>
					<div
						className='flex w-full min-w-0 flex-col gap-1'
						onPointerDown={(event) => event.stopPropagation()}
					>
						{workspaces.map((workspace) => (
							<WorkspaceSidebarItem
								isActive={
									activeProject?.id === project.id &&
									activeWorkspace?.id === workspace.id
								}
								isPinned={pinnedWorkspaceIdSet.has(workspace.id)}
								key={workspace.id}
								onArchiveSelect={
									onWorkspaceArchiveSelect
										? () => onWorkspaceArchiveSelect(workspace)
										: undefined
								}
								onDeleteSelect={
									onWorkspaceDeleteSelect
										? () => onWorkspaceDeleteSelect(workspace)
										: undefined
								}
								onPinToggle={() => onWorkspacePinToggle(workspace.id)}
								onRenameSelect={
									onWorkspaceRenameSelect
										? () => onWorkspaceRenameSelect(workspace)
										: undefined
								}
								onSelect={() => onWorkspaceSelect(project.id, workspace.id)}
								routeSearch={resolveWorkspaceRouteSearch(workspace)}
								workspace={workspace}
							/>
						))}
					</div>
				</div>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
