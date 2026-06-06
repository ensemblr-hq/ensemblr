import {
	CircleHelpIcon,
	CogIcon,
	HistoryIcon,
	LayoutDashboardIcon,
	PlusIcon,
} from 'lucide-react';

import { ReorderList } from '@/renderer/components/shadix-ui/components/reorder-list';
import { StatusBadge } from '@/renderer/components/status-badge';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
} from '@/renderer/components/ui/sidebar';
import { cn } from '@/renderer/lib/utils';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	ProjectNavigationState,
	WorkbenchActiveView,
	WorkbenchHealth,
} from '@/renderer/types/workbench-shell';

import { ProjectCreationMenu, ProjectSidebarHeader } from './project-sidebar';
import { WorkspaceSidebarItem } from './workspace-sidebar-item';

const healthTone: Record<WorkbenchHealth['state'], 'muted' | 'ok' | 'warning'> =
	{
		online: 'ok',
		pending: 'muted',
		unavailable: 'warning',
	};

export function WorkspaceNavigationSidebar({
	activeProject,
	activeView,
	activeWorkspace,
	health,
	onDashboardSelect,
	onHelpSelect,
	onHistorySelect,
	onSettingsSelect,
	onWorkspaceSelect,
	projectNavigation,
	projects,
}: {
	activeProject: ProjectShellModel | null;
	activeView: WorkbenchActiveView;
	activeWorkspace: WorkspaceShellModel | null;
	health: WorkbenchHealth;
	onDashboardSelect: () => void;
	onHelpSelect: () => void;
	onHistorySelect: () => void;
	onSettingsSelect: () => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projectNavigation: ProjectNavigationState;
	projects: ProjectShellModel[];
}) {
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
					onDashboardSelect={onDashboardSelect}
					onHelpSelect={onHelpSelect}
					onHistorySelect={onHistorySelect}
					onSettingsSelect={onSettingsSelect}
				/>
				<PinnedWorkspaceGroup
					activeProject={activeProject}
					activeWorkspace={activeWorkspace}
					onWorkspaceSelect={onWorkspaceSelect}
					projectNavigation={projectNavigation}
				/>
				<ProjectNavigationGroups
					activeProject={activeProject}
					activeWorkspace={activeWorkspace}
					onSettingsSelect={onSettingsSelect}
					onWorkspaceSelect={onWorkspaceSelect}
					projectNavigation={projectNavigation}
				/>
			</SidebarContent>

			<SidebarHealthFooter health={health} projects={projects} />
			<SidebarRail />
		</Sidebar>
	);
}

function SidebarPrimaryNavigation({
	activeView,
	onDashboardSelect,
	onHelpSelect,
	onHistorySelect,
	onSettingsSelect,
}: {
	activeView: WorkbenchActiveView;
	onDashboardSelect: () => void;
	onHelpSelect: () => void;
	onHistorySelect: () => void;
	onSettingsSelect: () => void;
}) {
	return (
		<>
			<SidebarGroup className='min-h-11.75 justify-center py-1'>
				<SidebarGroupContent>
					<SidebarMenu className='gap-1'>
						<SidebarMenuItem>
							<SidebarMenuButton
								isActive={activeView === 'dashboard'}
								onClick={onDashboardSelect}
								tooltip='Dashboard'
							>
								<LayoutDashboardIcon aria-hidden='true' />
								<span>Dashboard</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								isActive={activeView === 'history'}
								onClick={onHistorySelect}
								tooltip='History'
							>
								<HistoryIcon aria-hidden='true' />
								<span>History</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								aria-label='Open app settings'
								isActive={activeView === 'settings'}
								onClick={onSettingsSelect}
								tooltip='Settings'
							>
								<CogIcon aria-hidden='true' />
								<span>Settings</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								aria-label='Open help'
								isActive={activeView === 'help'}
								onClick={onHelpSelect}
								tooltip='Help'
							>
								<CircleHelpIcon aria-hidden='true' />
								<span>Help</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>

			<SidebarSeparator className='mx-0 w-full' />
		</>
	);
}

function PinnedWorkspaceGroup({
	activeProject,
	activeWorkspace,
	onWorkspaceSelect,
	projectNavigation,
}: {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projectNavigation: ProjectNavigationState;
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
							workspace={workspace}
						/>
					))}
				</div>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

function ProjectNavigationGroups({
	activeProject,
	activeWorkspace,
	onSettingsSelect,
	onWorkspaceSelect,
	projectNavigation,
}: {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	onSettingsSelect: () => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projectNavigation: ProjectNavigationState;
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

	return (
		<>
			<SidebarGroup className='gap-1 py-1.5'>
				<SidebarGroupLabel className='h-7 justify-between pr-7'>
					<span className='truncate'>Repositories</span>
				</SidebarGroupLabel>
				<ProjectCreationMenu />
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
							onProjectToggle={() => toggleProjectCollapsed(project.id)}
							onSettingsSelect={onSettingsSelect}
							onWorkspacePinToggle={toggleWorkspacePinned}
							onWorkspaceSelect={onWorkspaceSelect}
							pinnedWorkspaceIdSet={pinnedWorkspaceIdSet}
							project={project}
							workspaces={visibleProjectWorkspaces}
						/>
					);
				})}
			</ReorderList>
		</>
	);
}

function ProjectWorkspaceGroup({
	activeProject,
	activeWorkspace,
	isCollapsed,
	onProjectToggle,
	onSettingsSelect,
	onWorkspacePinToggle,
	onWorkspaceSelect,
	pinnedWorkspaceIdSet,
	project,
	workspaces,
}: {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	isCollapsed: boolean;
	onProjectToggle: () => void;
	onSettingsSelect: () => void;
	onWorkspacePinToggle: (workspaceId: string) => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	pinnedWorkspaceIdSet: Set<string>;
	project: ProjectShellModel;
	workspaces: WorkspaceShellModel[];
}) {
	return (
		<SidebarGroup
			aria-label={`Reorder repository ${project.name}`}
			className='gap-1 py-1.5'
		>
			<ProjectSidebarHeader
				isCollapsed={isCollapsed}
				onRepositorySettingsSelect={onSettingsSelect}
				onToggle={onProjectToggle}
				project={project}
				workspaceCount={workspaces.length}
			/>
			<SidebarGroupAction
				aria-label={`Create workspace in ${project.name}`}
				className='top-2 size-6 [&>svg]:size-4'
				onPointerDown={(event) => event.stopPropagation()}
				type='button'
			>
				<PlusIcon aria-hidden='true' />
			</SidebarGroupAction>
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
								onPinToggle={() => onWorkspacePinToggle(workspace.id)}
								onSelect={() => onWorkspaceSelect(project.id, workspace.id)}
								workspace={workspace}
							/>
						))}
					</div>
				</div>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

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
				<div className='flex items-center gap-2 font-mono text-[0.6875rem] text-muted-foreground leading-4'>
					<span>{repositoryCount} repos</span>
					<span>{workspaceCount} workspaces</span>
				</div>
				<p className='line-clamp-2 text-[0.6875rem] text-muted-foreground leading-4'>
					{health.detail}
				</p>
			</div>
		</SidebarFooter>
	);
}
