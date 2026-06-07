import {
	CircleHelpIcon,
	HistoryIcon,
	LayoutDashboardIcon,
	SettingsIcon,
} from 'lucide-react';
import { type ReactElement, useState } from 'react';

import { ReorderList } from '@/renderer/components/shadix-ui/components/reorder-list';
import { StatusBadge } from '@/renderer/components/status-badge';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
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
	WorkbenchWorkspaceNavigationLinkTarget,
} from '@/renderer/types/workbench-shell';

import { CreateWorkspaceSourceDialog } from './create-workspace-source-dialog';
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
	addProjectMenu,
	health,
	onAddProject,
	onOpenRecentProject,
	onStaticNavigationSelect,
	onWorkspaceSelect,
	projectNavigation,
	projects,
	renderStaticNavigationLink,
	renderWorkspaceNavigationLink,
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
	renderStaticNavigationLink?: (
		target: WorkbenchStaticNavigationTarget,
		children: ReactElement,
	) => ReactElement;
	renderWorkspaceNavigationLink?: (
		target: WorkbenchWorkspaceNavigationLinkTarget,
		children: ReactElement,
	) => ReactElement;
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
					renderNavigationLink={renderStaticNavigationLink}
				/>
				<PinnedWorkspaceGroup
					activeProject={activeNavigationProject}
					activeWorkspace={activeNavigationWorkspace}
					onWorkspaceSelect={onWorkspaceSelect}
					projectNavigation={projectNavigation}
					renderNavigationLink={renderWorkspaceNavigationLink}
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
					renderWorkspaceNavigationLink={renderWorkspaceNavigationLink}
					resolveWorkspaceRouteSearch={resolveWorkspaceRouteSearch}
				/>
			</SidebarContent>

			<SidebarHealthFooter health={health} projects={projects} />
			<SidebarRail />
		</Sidebar>
	);
}

function SidebarPrimaryNavigation({
	activeView,
	onStaticNavigationSelect,
	renderNavigationLink,
}: {
	activeView: WorkbenchActiveView;
	onStaticNavigationSelect: (target: WorkbenchStaticNavigationTarget) => void;
	renderNavigationLink?: (
		target: WorkbenchStaticNavigationTarget,
		children: ReactElement,
	) => ReactElement;
}) {
	return (
		<>
			<SidebarGroup className='min-h-11.75 justify-center py-1'>
				<SidebarGroupContent>
					<SidebarMenu className='gap-1'>
						<StaticNavigationItem
							icon={<LayoutDashboardIcon aria-hidden='true' />}
							isActive={activeView === 'dashboard'}
							label='Dashboard'
							onSelect={onStaticNavigationSelect}
							renderNavigationLink={renderNavigationLink}
							target='dashboard'
						/>
						<StaticNavigationItem
							icon={<HistoryIcon aria-hidden='true' />}
							isActive={activeView === 'history'}
							label='History'
							onSelect={onStaticNavigationSelect}
							renderNavigationLink={renderNavigationLink}
							target='history'
						/>
						<StaticNavigationItem
							ariaLabel='Open app settings'
							icon={<SettingsIcon aria-hidden='true' />}
							isActive={activeView === 'settings'}
							label='Settings'
							onSelect={onStaticNavigationSelect}
							renderNavigationLink={renderNavigationLink}
							target='settings'
						/>
						<StaticNavigationItem
							ariaLabel='Open help'
							icon={<CircleHelpIcon aria-hidden='true' />}
							isActive={activeView === 'help'}
							label='Help'
							onSelect={onStaticNavigationSelect}
							renderNavigationLink={renderNavigationLink}
							target='help'
						/>
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>

			<SidebarSeparator className='mx-0 w-full' />
		</>
	);
}

function StaticNavigationItem({
	ariaLabel,
	icon,
	isActive,
	label,
	onSelect,
	renderNavigationLink,
	target,
}: {
	ariaLabel?: string;
	icon: ReactElement;
	isActive: boolean;
	label: string;
	onSelect: (target: WorkbenchStaticNavigationTarget) => void;
	renderNavigationLink?: (
		target: WorkbenchStaticNavigationTarget,
		children: ReactElement,
	) => ReactElement;
	target: WorkbenchStaticNavigationTarget;
}) {
	const content = (
		<>
			{icon}
			<span>{label}</span>
		</>
	);

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				aria-label={ariaLabel}
				asChild={Boolean(renderNavigationLink)}
				isActive={isActive}
				onClick={renderNavigationLink ? undefined : () => onSelect(target)}
				tooltip={label}
			>
				{renderNavigationLink ? renderNavigationLink(target, content) : content}
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

function PinnedWorkspaceGroup({
	activeProject,
	activeWorkspace,
	onWorkspaceSelect,
	projectNavigation,
	renderNavigationLink,
	resolveWorkspaceRouteSearch,
}: {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projectNavigation: ProjectNavigationState;
	renderNavigationLink?: (
		target: WorkbenchWorkspaceNavigationLinkTarget,
		children: ReactElement,
	) => ReactElement;
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
							renderNavigationLink={renderNavigationLink}
							routeSearch={resolveWorkspaceRouteSearch(workspace)}
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
	addProjectMenu,
	onAddProject,
	onOpenRecentProject,
	onStaticNavigationSelect,
	onWorkspaceSelect,
	projectNavigation,
	renderWorkspaceNavigationLink,
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
	renderWorkspaceNavigationLink?: (
		target: WorkbenchWorkspaceNavigationLinkTarget,
		children: ReactElement,
	) => ReactElement;
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
							renderWorkspaceNavigationLink={renderWorkspaceNavigationLink}
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

function ProjectWorkspaceGroup({
	activeProject,
	activeWorkspace,
	isCollapsed,
	onCreateFromSourceSelect,
	onProjectToggle,
	onStaticNavigationSelect,
	onWorkspacePinToggle,
	onWorkspaceSelect,
	pinnedWorkspaceIdSet,
	project,
	renderWorkspaceNavigationLink,
	resolveWorkspaceRouteSearch,
	workspaces,
}: {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	isCollapsed: boolean;
	onCreateFromSourceSelect: () => void;
	onProjectToggle: () => void;
	onStaticNavigationSelect: (target: WorkbenchStaticNavigationTarget) => void;
	onWorkspacePinToggle: (workspaceId: string) => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	pinnedWorkspaceIdSet: Set<string>;
	project: ProjectShellModel;
	renderWorkspaceNavigationLink?: (
		target: WorkbenchWorkspaceNavigationLinkTarget,
		children: ReactElement,
	) => ReactElement;
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
				onCreateFromSourceSelect={onCreateFromSourceSelect}
				onRepositorySettingsSelect={() => onStaticNavigationSelect('settings')}
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
								onPinToggle={() => onWorkspacePinToggle(workspace.id)}
								onSelect={() => onWorkspaceSelect(project.id, workspace.id)}
								renderNavigationLink={renderWorkspaceNavigationLink}
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
