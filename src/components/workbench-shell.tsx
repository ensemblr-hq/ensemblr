import { Icon } from '@iconify/react';
import {
	ArchiveIcon,
	ArrowUpRightIcon,
	BotIcon,
	CheckCircle2Icon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	CircleDashedIcon,
	CircleEllipsisIcon,
	CircleIcon,
	CircleSlashIcon,
	CogIcon,
	CopyIcon,
	ExternalLinkIcon,
	EyeIcon,
	FileCodeIcon,
	FolderGit2Icon,
	FolderIcon,
	FolderPlusIcon,
	GitBranchIcon,
	GitMergeConflictIcon,
	GitMergeIcon,
	GitPullRequestArrowIcon,
	GitPullRequestCreateIcon,
	GitPullRequestDraftIcon,
	GlobeIcon,
	HistoryIcon,
	LinkIcon,
	ListIcon,
	ListTreeIcon,
	LoaderCircleIcon,
	type LucideIcon,
	MailIcon,
	MessageSquareIcon,
	MoreVerticalIcon,
	PanelRightCloseIcon,
	PanelRightOpenIcon,
	PencilIcon,
	PinIcon,
	PlayIcon,
	PlusIcon,
	RotateCcwIcon,
	SearchIcon,
	SquareIcon,
	SquareTerminalIcon,
	Trash2Icon,
	UserIcon,
	WrenchIcon,
	XIcon,
} from 'lucide-react';
import {
	type ComponentProps,
	Fragment,
	type ReactElement,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';

import { ReorderList } from '@/components/shadix-ui/components/reorder-list';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from '@/components/ui/command';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
} from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getWorkspaceFileIconName } from '@/renderer/workbench/file-icons';
import type {
	ComposerShellState,
	DockTabId,
	ProjectShellModel,
	ReviewFileSummary,
	ReviewPanelTab,
	SessionTabModel,
	WorkspaceFileSummary,
	WorkspaceOpenTarget,
	WorkspaceScriptSummary,
	WorkspaceShellModel,
} from '@/renderer/workbench/workbench-model';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc';

export interface WorkbenchHealth {
	detail: string;
	label: string;
	state: 'online' | 'pending' | 'unavailable';
}

interface WorkbenchShellProps {
	activeProject: ProjectShellModel;
	activeReviewTab: ReviewPanelTab;
	activeSession: SessionTabModel;
	activeView: 'dashboard' | 'history' | 'settings' | 'workspace';
	activeWorkspace: WorkspaceShellModel;
	composer: ComposerShellState;
	dockTabId: DockTabId;
	health: WorkbenchHealth;
	isSetupRefreshing: boolean;
	onDockTabChange: (tab: DockTabId) => void;
	onHistorySelect: () => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
	onSessionTabChange: (sessionId: string) => void;
	onSettingsSelect: () => void;
	onSetupRetry: () => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projects: ProjectShellModel[];
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	setupError: string | null;
}

type ChangesViewMode = 'folders' | 'list';

interface ReviewFileTreeNode {
	directories: ReviewFileTreeNode[];
	files: ReviewFileSummary[];
	name: string;
	path: string;
}

interface MutableReviewFileTreeNode extends ReviewFileTreeNode {
	directoryMap: Map<string, MutableReviewFileTreeNode>;
}

const healthTone: Record<WorkbenchHealth['state'], 'muted' | 'ok' | 'warning'> =
	{
		online: 'ok',
		pending: 'muted',
		unavailable: 'warning',
	};

const fileStatusLabel: Record<ReviewFileSummary['status'], string> = {
	added: 'A',
	deleted: 'D',
	modified: 'M',
	renamed: 'R',
	untracked: 'U',
};

function getReorderedShellItems<T extends { id: string }>(
	items: T[],
	reorderedElements: ReactElement[],
): T[] {
	const itemsById = new Map(items.map((item) => [item.id, item]));
	const nextItems = reorderedElements
		.map((element) => normalizeReorderElementKey(element.key))
		.map((id) => (id ? itemsById.get(id) : undefined))
		.filter((item): item is T => Boolean(item));

	if (nextItems.length !== items.length) {
		return items;
	}

	return nextItems;
}

function normalizeReorderElementKey(key: ReactElement['key']) {
	if (key == null) {
		return null;
	}

	return String(key).replace(/^\.\$/, '').replace(/^\./, '');
}

export function WorkbenchShell({
	activeProject,
	activeReviewTab,
	activeSession,
	activeView,
	activeWorkspace,
	composer,
	dockTabId,
	health,
	onDockTabChange,
	onHistorySelect,
	onReviewTabChange,
	onSessionTabChange,
	onSettingsSelect,
	onWorkspaceSelect,
	projects,
	setupDiagnostics,
}: WorkbenchShellProps) {
	const rightSidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
	const dockPanelRef = useRef<PanelImperativeHandle | null>(null);
	const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false);
	const [isDockCollapsed, setIsDockCollapsed] = useState(false);
	const projectNavigation = useProjectNavigationState(projects);
	const sessionNavigation = useSessionTabState({
		activeSession,
		activeWorkspace,
		onSessionTabChange,
	});
	const collapseRightSidebar = () => {
		rightSidebarPanelRef.current?.collapse();
		setIsRightSidebarCollapsed(true);
	};
	const expandRightSidebar = () => {
		rightSidebarPanelRef.current?.expand();
		setIsRightSidebarCollapsed(false);
	};
	const toggleDockPanel = () => {
		if (dockPanelRef.current?.isCollapsed() || isDockCollapsed) {
			dockPanelRef.current?.expand();
			setIsDockCollapsed(false);
			return;
		}

		dockPanelRef.current?.collapse();
		setIsDockCollapsed(true);
	};

	return (
		<TooltipProvider>
			<SidebarProvider>
				<WorkspaceNavigationSidebar
					activeProject={activeProject}
					activeView={activeView}
					activeWorkspace={activeWorkspace}
					health={health}
					onHistorySelect={onHistorySelect}
					onSettingsSelect={onSettingsSelect}
					onWorkspaceSelect={onWorkspaceSelect}
					projectNavigation={projectNavigation}
				/>
				<WorkbenchPanelLayout
					activeProject={activeProject}
					activeReviewTab={activeReviewTab}
					activeSession={sessionNavigation.effectiveActiveSession}
					activeWorkspace={activeWorkspace}
					closedSessions={sessionNavigation.closedSessions}
					composer={composer}
					dockPanelRef={dockPanelRef}
					dockTabId={dockTabId}
					isDockCollapsed={isDockCollapsed}
					isRightSidebarCollapsed={isRightSidebarCollapsed}
					onDockResize={(isCollapsed) => setIsDockCollapsed(isCollapsed)}
					onDockTabChange={onDockTabChange}
					onDockToggle={toggleDockPanel}
					onReviewTabChange={onReviewTabChange}
					onRightSidebarCollapse={collapseRightSidebar}
					onRightSidebarOpen={expandRightSidebar}
					onRightSidebarResize={(isCollapsed) =>
						setIsRightSidebarCollapsed(isCollapsed)
					}
					onSessionTabChange={onSessionTabChange}
					onSessionTabClose={sessionNavigation.closeSessionTab}
					onSessionTabRestore={sessionNavigation.restoreSessionTab}
					rightSidebarPanelRef={rightSidebarPanelRef}
					sessionTabs={sessionNavigation.sessionTabs}
					setupDiagnostics={setupDiagnostics}
				/>
			</SidebarProvider>
		</TooltipProvider>
	);
}

interface WorkspaceEntry {
	project: ProjectShellModel;
	workspace: WorkspaceShellModel;
}

interface ProjectNavigationState {
	collapsedProjectIdSet: Set<string>;
	isProjectReorderLayoutAnimationDisabled: boolean;
	isProjectReorderPositionOnlyLayout: boolean;
	orderedProjects: ProjectShellModel[];
	pinnedWorkspaceEntries: WorkspaceEntry[];
	pinnedWorkspaceIdSet: Set<string>;
	reorderProjects: (reorderedElements: ReactElement[]) => void;
	toggleProjectCollapsed: (projectId: string) => void;
	toggleWorkspacePinned: (workspaceId: string) => void;
}

function useProjectNavigationState(
	projects: ProjectShellModel[],
): ProjectNavigationState {
	const projectCollapseMotionTimeoutRef = useRef<ReturnType<
		typeof setTimeout
	> | null>(null);
	const projectPinMotionTimeoutRef = useRef<ReturnType<
		typeof setTimeout
	> | null>(null);
	const [orderedProjects, setOrderedProjects] = useState(projects);
	const [collapsedProjectIds, setCollapsedProjectIds] = useState<string[]>([]);
	const [pinnedWorkspaceIds, setPinnedWorkspaceIds] = useState<string[]>([]);
	const [
		isProjectReorderPositionOnlyLayout,
		setIsProjectReorderPositionOnlyLayout,
	] = useState(false);
	const [
		isProjectReorderLayoutAnimationDisabled,
		setIsProjectReorderLayoutAnimationDisabled,
	] = useState(false);
	const collapsedProjectIdSet = new Set(collapsedProjectIds);
	const pinnedWorkspaceIdSet = new Set(pinnedWorkspaceIds);
	const workspaceEntriesById = new Map(
		orderedProjects.flatMap((project) =>
			project.workspaces.map(
				(workspace) => [workspace.id, { project, workspace }] as const,
			),
		),
	);
	const pinnedWorkspaceEntries = pinnedWorkspaceIds
		.map((workspaceId) => workspaceEntriesById.get(workspaceId))
		.filter((entry): entry is WorkspaceEntry => Boolean(entry));

	useEffect(() => {
		setOrderedProjects(projects);
		setCollapsedProjectIds((currentProjectIds) => {
			const projectIds = new Set(projects.map((project) => project.id));
			const nextProjectIds = currentProjectIds.filter((projectId) =>
				projectIds.has(projectId),
			);

			return nextProjectIds.length === currentProjectIds.length
				? currentProjectIds
				: nextProjectIds;
		});
		setPinnedWorkspaceIds((currentWorkspaceIds) => {
			const workspaceIds = new Set(
				projects.flatMap((project) =>
					project.workspaces.map((workspace) => workspace.id),
				),
			);
			const nextWorkspaceIds = currentWorkspaceIds.filter((workspaceId) =>
				workspaceIds.has(workspaceId),
			);

			return nextWorkspaceIds.length === currentWorkspaceIds.length
				? currentWorkspaceIds
				: nextWorkspaceIds;
		});
	}, [projects]);
	useEffect(
		() => () => {
			if (projectCollapseMotionTimeoutRef.current) {
				clearTimeout(projectCollapseMotionTimeoutRef.current);
			}
			if (projectPinMotionTimeoutRef.current) {
				clearTimeout(projectPinMotionTimeoutRef.current);
			}
		},
		[],
	);

	const reorderProjects = (reorderedElements: ReactElement[]) => {
		setOrderedProjects((currentProjects) =>
			getReorderedShellItems(currentProjects, reorderedElements),
		);
	};
	const activatePositionOnlyProjectReorderLayout = () => {
		if (projectCollapseMotionTimeoutRef.current) {
			clearTimeout(projectCollapseMotionTimeoutRef.current);
		}

		setIsProjectReorderPositionOnlyLayout(true);
		projectCollapseMotionTimeoutRef.current = setTimeout(() => {
			setIsProjectReorderPositionOnlyLayout(false);
			projectCollapseMotionTimeoutRef.current = null;
		}, 180);
	};
	const toggleProjectCollapsed = (projectId: string) => {
		activatePositionOnlyProjectReorderLayout();
		setCollapsedProjectIds((currentProjectIds) =>
			currentProjectIds.includes(projectId)
				? currentProjectIds.filter(
						(currentProjectId) => currentProjectId !== projectId,
					)
				: [...currentProjectIds, projectId],
		);
	};
	const disableProjectReorderLayoutAnimation = () => {
		if (projectPinMotionTimeoutRef.current) {
			clearTimeout(projectPinMotionTimeoutRef.current);
		}

		setIsProjectReorderLayoutAnimationDisabled(true);
		projectPinMotionTimeoutRef.current = setTimeout(() => {
			setIsProjectReorderLayoutAnimationDisabled(false);
			projectPinMotionTimeoutRef.current = null;
		}, 180);
	};
	const toggleWorkspacePinned = (workspaceId: string) => {
		disableProjectReorderLayoutAnimation();
		setPinnedWorkspaceIds((currentWorkspaceIds) =>
			currentWorkspaceIds.includes(workspaceId)
				? currentWorkspaceIds.filter(
						(currentWorkspaceId) => currentWorkspaceId !== workspaceId,
					)
				: [...currentWorkspaceIds, workspaceId],
		);
	};

	return {
		collapsedProjectIdSet,
		isProjectReorderLayoutAnimationDisabled,
		isProjectReorderPositionOnlyLayout,
		orderedProjects,
		pinnedWorkspaceEntries,
		pinnedWorkspaceIdSet,
		reorderProjects,
		toggleProjectCollapsed,
		toggleWorkspacePinned,
	};
}

interface SessionTabState {
	closedSessions: SessionTabModel[];
	closeSessionTab: (sessionId: string) => void;
	effectiveActiveSession: SessionTabModel;
	restoreSessionTab: (sessionId: string) => void;
	sessionTabs: SessionTabModel[];
}

function useSessionTabState({
	activeSession,
	activeWorkspace,
	onSessionTabChange,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	onSessionTabChange: (sessionId: string) => void;
}): SessionTabState {
	const [closedSessionIdsByWorkspace, setClosedSessionIdsByWorkspace] =
		useState<Record<string, string[]>>({});
	const closedSessionIds =
		closedSessionIdsByWorkspace[activeWorkspace.id] ?? [];
	const visibleSessions = activeWorkspace.sessions.filter(
		(session) => !closedSessionIds.includes(session.id),
	);
	const closedSessions = activeWorkspace.sessions.filter((session) =>
		closedSessionIds.includes(session.id),
	);
	const sessionTabs = visibleSessions.length
		? visibleSessions
		: activeWorkspace.sessions;
	const effectiveActiveSession =
		sessionTabs.find((session) => session.id === activeSession.id) ??
		sessionTabs[0] ??
		activeSession;

	const closeSessionTab = (sessionId: string) => {
		if (sessionTabs.length <= 1) {
			return;
		}

		const closingIndex = sessionTabs.findIndex(
			(session) => session.id === sessionId,
		);
		const nextSession =
			sessionTabs[closingIndex + 1] ??
			sessionTabs[closingIndex - 1] ??
			sessionTabs.find((session) => session.id !== sessionId);

		setClosedSessionIdsByWorkspace((current) => {
			const workspaceClosedIds = current[activeWorkspace.id] ?? [];

			if (workspaceClosedIds.includes(sessionId)) {
				return current;
			}

			return {
				...current,
				[activeWorkspace.id]: [...workspaceClosedIds, sessionId],
			};
		});

		if (activeSession.id === sessionId && nextSession) {
			onSessionTabChange(nextSession.id);
		}
	};
	const restoreSessionTab = (sessionId: string) => {
		setClosedSessionIdsByWorkspace((current) => {
			const workspaceClosedIds = current[activeWorkspace.id] ?? [];
			const nextWorkspaceClosedIds = workspaceClosedIds.filter(
				(closedSessionId) => closedSessionId !== sessionId,
			);

			return {
				...current,
				[activeWorkspace.id]: nextWorkspaceClosedIds,
			};
		});
		onSessionTabChange(sessionId);
	};

	return {
		closedSessions,
		closeSessionTab,
		effectiveActiveSession,
		restoreSessionTab,
		sessionTabs,
	};
}

function WorkspaceNavigationSidebar({
	activeProject,
	activeView,
	activeWorkspace,
	health,
	onHistorySelect,
	onSettingsSelect,
	onWorkspaceSelect,
	projectNavigation,
}: {
	activeProject: ProjectShellModel;
	activeView: WorkbenchShellProps['activeView'];
	activeWorkspace: WorkspaceShellModel;
	health: WorkbenchHealth;
	onHistorySelect: () => void;
	onSettingsSelect: () => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projectNavigation: ProjectNavigationState;
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

			<SidebarHealthFooter health={health} />
			<SidebarRail />
		</Sidebar>
	);
}

function SidebarPrimaryNavigation({
	activeView,
	onHistorySelect,
	onSettingsSelect,
}: {
	activeView: WorkbenchShellProps['activeView'];
	onHistorySelect: () => void;
	onSettingsSelect: () => void;
}) {
	return (
		<>
			<SidebarGroup className='min-h-[2.9375rem] justify-center py-1'>
				<SidebarGroupContent>
					<SidebarMenu className='gap-1'>
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
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
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
								activeProject.id === project.id &&
								activeWorkspace.id === workspace.id
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
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
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
					<span className='truncate'>Projects</span>
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
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
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
			aria-label={`Reorder project ${project.name}`}
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
									activeProject.id === project.id &&
									activeWorkspace.id === workspace.id
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

function SidebarHealthFooter({ health }: { health: WorkbenchHealth }) {
	return (
		<SidebarFooter className='border-sidebar-border border-t p-2'>
			<div className='flex flex-col gap-1 rounded-md px-2 py-1.5'>
				<StatusBadge tone={healthTone[health.state]}>
					{health.label}
				</StatusBadge>
				<p className='line-clamp-2 text-[0.6875rem] text-muted-foreground leading-4'>
					{health.detail}
				</p>
			</div>
		</SidebarFooter>
	);
}

function WorkbenchPanelLayout({
	activeProject,
	activeReviewTab,
	activeSession,
	activeWorkspace,
	closedSessions,
	composer,
	dockPanelRef,
	dockTabId,
	isDockCollapsed,
	isRightSidebarCollapsed,
	onDockResize,
	onDockTabChange,
	onDockToggle,
	onReviewTabChange,
	onRightSidebarCollapse,
	onRightSidebarOpen,
	onRightSidebarResize,
	onSessionTabChange,
	onSessionTabClose,
	onSessionTabRestore,
	rightSidebarPanelRef,
	sessionTabs,
	setupDiagnostics,
}: {
	activeProject: ProjectShellModel;
	activeReviewTab: ReviewPanelTab;
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	closedSessions: SessionTabModel[];
	composer: ComposerShellState;
	dockPanelRef: RefObject<PanelImperativeHandle | null>;
	dockTabId: DockTabId;
	isDockCollapsed: boolean;
	isRightSidebarCollapsed: boolean;
	onDockResize: (isCollapsed: boolean) => void;
	onDockTabChange: (tab: DockTabId) => void;
	onDockToggle: () => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
	onRightSidebarCollapse: () => void;
	onRightSidebarOpen: () => void;
	onRightSidebarResize: (isCollapsed: boolean) => void;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabRestore: (sessionId: string) => void;
	rightSidebarPanelRef: RefObject<PanelImperativeHandle | null>;
	sessionTabs: SessionTabModel[];
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
}) {
	return (
		<SidebarInset className='flex h-svh min-h-svh overflow-hidden bg-background text-foreground'>
			<ResizablePanelGroup className='min-h-0 flex-1' orientation='horizontal'>
				<MainConversationPanel
					activeProject={activeProject}
					activeSession={activeSession}
					activeWorkspace={activeWorkspace}
					closedSessions={closedSessions}
					composer={composer}
					isRightSidebarCollapsed={isRightSidebarCollapsed}
					onRightSidebarCollapse={onRightSidebarCollapse}
					onRightSidebarOpen={onRightSidebarOpen}
					onSessionTabChange={onSessionTabChange}
					onSessionTabClose={onSessionTabClose}
					onSessionTabRestore={onSessionTabRestore}
					sessionTabs={sessionTabs}
					setupDiagnostics={setupDiagnostics}
				/>
				<ResizableHandle className='hidden lg:flex' />
				<ReviewDockPanel
					activeReviewTab={activeReviewTab}
					activeWorkspace={activeWorkspace}
					dockPanelRef={dockPanelRef}
					dockTabId={dockTabId}
					isDockCollapsed={isDockCollapsed}
					onDockResize={onDockResize}
					onDockTabChange={onDockTabChange}
					onDockToggle={onDockToggle}
					onReviewTabChange={onReviewTabChange}
					onRightSidebarResize={onRightSidebarResize}
					rightSidebarPanelRef={rightSidebarPanelRef}
				/>
			</ResizablePanelGroup>
		</SidebarInset>
	);
}

function MainConversationPanel({
	activeProject,
	activeSession,
	activeWorkspace,
	closedSessions,
	composer,
	isRightSidebarCollapsed,
	onRightSidebarCollapse,
	onRightSidebarOpen,
	onSessionTabChange,
	onSessionTabClose,
	onSessionTabRestore,
	sessionTabs,
	setupDiagnostics,
}: {
	activeProject: ProjectShellModel;
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	closedSessions: SessionTabModel[];
	composer: ComposerShellState;
	isRightSidebarCollapsed: boolean;
	onRightSidebarCollapse: () => void;
	onRightSidebarOpen: () => void;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabRestore: (sessionId: string) => void;
	sessionTabs: SessionTabModel[];
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
}) {
	return (
		<ResizablePanel defaultSize='66%' minSize='32rem'>
			<div className='flex h-full min-w-0 flex-col overflow-hidden'>
				<WorkbenchHeader
					activeProject={activeProject}
					activeWorkspace={activeWorkspace}
					isRightSidebarCollapsed={isRightSidebarCollapsed}
					onRightSidebarCollapse={onRightSidebarCollapse}
					onRightSidebarOpen={onRightSidebarOpen}
				/>
				<section className='flex min-h-0 flex-1 flex-col overflow-hidden'>
					<SessionTabs
						activeSession={activeSession}
						closedSessions={closedSessions}
						onSessionTabClose={onSessionTabClose}
						onSessionTabChange={onSessionTabChange}
						onSessionTabRestore={onSessionTabRestore}
						sessions={sessionTabs}
					/>
					<ScrollArea className='min-h-0 flex-1'>
						<WorkspaceTimeline
							activeSession={activeSession}
							composer={composer}
							setupDiagnostics={setupDiagnostics}
							workspace={activeWorkspace}
						/>
					</ScrollArea>
					<ComposerPanel composer={composer} />
				</section>
			</div>
		</ResizablePanel>
	);
}

function ReviewDockPanel({
	activeReviewTab,
	activeWorkspace,
	dockPanelRef,
	dockTabId,
	isDockCollapsed,
	onDockResize,
	onDockTabChange,
	onDockToggle,
	onReviewTabChange,
	onRightSidebarResize,
	rightSidebarPanelRef,
}: {
	activeReviewTab: ReviewPanelTab;
	activeWorkspace: WorkspaceShellModel;
	dockPanelRef: RefObject<PanelImperativeHandle | null>;
	dockTabId: DockTabId;
	isDockCollapsed: boolean;
	onDockResize: (isCollapsed: boolean) => void;
	onDockTabChange: (tab: DockTabId) => void;
	onDockToggle: () => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
	onRightSidebarResize: (isCollapsed: boolean) => void;
	rightSidebarPanelRef: RefObject<PanelImperativeHandle | null>;
}) {
	return (
		<ResizablePanel
			className='hidden min-w-0 lg:flex'
			collapsedSize='0rem'
			collapsible
			defaultSize='34%'
			maxSize='68%'
			minSize='22rem'
			onResize={(size) => {
				onRightSidebarResize(size.asPercentage <= 1);
			}}
			panelRef={rightSidebarPanelRef}
		>
			<aside className='flex h-full w-full min-w-0 flex-col bg-card'>
				<RightSidebarHeader activeWorkspace={activeWorkspace} />
				<ResizablePanelGroup className='min-h-0 flex-1' orientation='vertical'>
					<ResizablePanel className='min-h-0' defaultSize='62%' minSize='8rem'>
						<ReviewPanel
							activeTab={activeReviewTab}
							onTabChange={onReviewTabChange}
							workspace={activeWorkspace}
						/>
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel
						className='min-h-0'
						collapsedSize='2.25rem'
						collapsible
						defaultSize='18rem'
						groupResizeBehavior='preserve-pixel-size'
						maxSize='70%'
						minSize='9rem'
						onResize={(size) => {
							onDockResize(size.inPixels <= 40);
						}}
						panelRef={dockPanelRef}
					>
						<DockPanel
							activeTab={dockTabId}
							isCollapsed={isDockCollapsed}
							onTabChange={onDockTabChange}
							onToggleCollapsed={onDockToggle}
							workspace={activeWorkspace}
						/>
					</ResizablePanel>
				</ResizablePanelGroup>
			</aside>
		</ResizablePanel>
	);
}

function WorkspaceSidebarItem({
	isActive,
	isPinned,
	onPinToggle,
	onSelect,
	workspace,
}: {
	isActive: boolean;
	isPinned: boolean;
	onPinToggle: () => void;
	onSelect: () => void;
	workspace: WorkspaceShellModel;
}) {
	const sidebarIcon = getWorkspaceSidebarIcon(workspace);
	const WorkspaceIcon = sidebarIcon.icon;
	const hasDiffStats =
		workspace.changeSummary.additions > 0 ||
		workspace.changeSummary.deletions > 0;

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div className='group/workspace-sidebar-item relative min-w-0'>
					<SidebarMenuButton
						aria-label={`Open workspace ${workspace.name}`}
						className='h-auto min-h-12 items-start gap-2 py-2'
						isActive={isActive}
						onClick={onSelect}
						tooltip={workspace.name}
					>
						<div className='mt-0.5 grid size-5 shrink-0 place-items-center'>
							<WorkspaceIcon
								aria-hidden='true'
								className={cn(
									'size-3.5',
									sidebarIcon.className,
									sidebarIcon.isSpinning && 'animate-spin',
								)}
							/>
						</div>
						<div className='min-w-0 flex-1'>
							<div className='flex min-w-0 items-start justify-between gap-2'>
								<span className='truncate font-medium text-[0.8125rem]'>
									{workspace.name}
								</span>
								{hasDiffStats ? (
									<WorkspaceDiffStats workspace={workspace} />
								) : null}
							</div>
							<div className='mt-1 flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-muted-foreground'>
								<span className='truncate'>{workspace.branchName}</span>
							</div>
						</div>
					</SidebarMenuButton>
					<Button
						aria-label={`Archive workspace ${workspace.name}`}
						className='absolute right-1.5 bottom-1.5 size-6 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 group-hover/workspace-sidebar-item:opacity-100'
						onClick={(event) => {
							event.stopPropagation();
						}}
						onPointerDown={(event) => event.stopPropagation()}
						size='icon-xs'
						type='button'
						variant='ghost'
					>
						<ArchiveIcon aria-hidden='true' />
					</Button>
				</div>
			</ContextMenuTrigger>
			<WorkspaceContextMenuContent
				isPinned={isPinned}
				onPinToggle={onPinToggle}
				workspace={workspace}
			/>
		</ContextMenu>
	);
}

function WorkspaceDiffStats({ workspace }: { workspace: WorkspaceShellModel }) {
	return (
		<div className='flex shrink-0 items-center gap-1.5 font-mono text-[0.6875rem] leading-4'>
			{workspace.changeSummary.additions > 0 ? (
				<span className='text-status-ok'>
					+{workspace.changeSummary.additions}
				</span>
			) : null}
			{workspace.changeSummary.deletions > 0 ? (
				<span className='text-status-danger'>
					-{workspace.changeSummary.deletions}
				</span>
			) : null}
		</div>
	);
}

function getWorkspaceSidebarIcon(workspace: WorkspaceShellModel): {
	className: string;
	icon: LucideIcon;
	isSpinning?: boolean;
} {
	if (
		workspace.pullRequest.status === 'blocked' ||
		workspace.checks.status === 'blocked'
	) {
		return {
			className: 'text-status-danger',
			icon: GitMergeConflictIcon,
		};
	}

	if (workspace.pullRequest.status === 'ready-to-merge') {
		return {
			className: 'text-status-ok',
			icon: GitPullRequestArrowIcon,
		};
	}

	if (
		workspace.pullRequest.status === 'agent-working' ||
		workspace.status === 'working'
	) {
		return {
			className: 'text-muted-foreground',
			icon: LoaderCircleIcon,
			isSpinning: true,
		};
	}

	if (
		workspace.pullRequest.status === 'checking' ||
		workspace.checks.status === 'pending'
	) {
		return {
			className: 'text-status-warning',
			icon: CircleEllipsisIcon,
		};
	}

	return {
		className: 'text-muted-foreground',
		icon: GitBranchIcon,
	};
}

function WorkspaceContextMenuContent({
	isPinned,
	onPinToggle,
	workspace,
}: {
	isPinned: boolean;
	onPinToggle: () => void;
	workspace: WorkspaceShellModel;
}) {
	return (
		<ContextMenuContent
			aria-label={`${workspace.name} workspace actions`}
			className='w-56 bg-muted p-1'
		>
			<ContextMenuGroup>
				<SidebarContextMenuItem>
					<MailIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Mark as unread</span>
					<ContextMenuShortcut>R</ContextMenuShortcut>
				</SidebarContextMenuItem>
				<SidebarContextMenuItem onSelect={onPinToggle}>
					<PinIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>{isPinned ? 'Unpin' : 'Pin'}</span>
					<ContextMenuShortcut>P</ContextMenuShortcut>
				</SidebarContextMenuItem>
				<ContextMenuSub>
					<ContextMenuSubTrigger className='h-8 gap-2 px-2 text-[0.8125rem]'>
						<CircleDashedIcon
							aria-hidden='true'
							className='text-muted-foreground'
						/>
						<span className='min-w-0 flex-1'>Set status</span>
					</ContextMenuSubTrigger>
					<ContextMenuSubContent className='w-48 bg-muted p-1'>
						<ContextMenuGroup>
							<WorkspaceStatusMenuItem
								icon={CircleDashedIcon}
								iconClassName='text-muted-foreground'
								label='Backlog'
							/>
							<WorkspaceStatusMenuItem
								icon={CircleIcon}
								iconClassName='text-status-warning'
								label='In progress'
							/>
							<WorkspaceStatusMenuItem
								icon={CheckCircle2Icon}
								iconClassName='text-status-ok'
								isSelected
								label='In review'
							/>
							<WorkspaceStatusMenuItem
								icon={CheckCircle2Icon}
								iconClassName='text-muted-foreground'
								label='Done'
							/>
							<WorkspaceStatusMenuItem
								icon={CircleSlashIcon}
								iconClassName='text-muted-foreground'
								label='Canceled'
							/>
						</ContextMenuGroup>
					</ContextMenuSubContent>
				</ContextMenuSub>
				<SidebarContextMenuItem>
					<PencilIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Rename</span>
				</SidebarContextMenuItem>
			</ContextMenuGroup>
			<ContextMenuSeparator />
			<ContextMenuGroup>
				<SidebarContextMenuItem>
					<ArchiveIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Archive</span>
					<ContextMenuShortcut>⌘⇧A</ContextMenuShortcut>
				</SidebarContextMenuItem>
			</ContextMenuGroup>
		</ContextMenuContent>
	);
}

function WorkspaceStatusMenuItem({
	icon: StatusIcon,
	iconClassName,
	isSelected = false,
	label,
}: {
	icon: LucideIcon;
	iconClassName: string;
	isSelected?: boolean;
	label: string;
}) {
	return (
		<SidebarContextMenuItem>
			<StatusIcon aria-hidden='true' className={iconClassName} />
			<span className='min-w-0 flex-1'>{label}</span>
			{isSelected ? (
				<CheckIcon
					aria-hidden='true'
					className='ml-auto text-muted-foreground'
				/>
			) : null}
		</SidebarContextMenuItem>
	);
}

function SidebarContextMenuItem({
	className,
	...props
}: ComponentProps<typeof ContextMenuItem>) {
	return (
		<ContextMenuItem
			className={cn('h-8 gap-2 px-2 text-[0.8125rem]', className)}
			{...props}
		/>
	);
}

const recentProjectPaths = [
	'~/Projects/Boundary/haartz-next',
	'~/Projects/Boundary/weho-pride',
	'~/Projects/Personal/viteflow',
	'~/Projects/Personal/nixfiles',
	'~/Projects/Freelance/plated',
	'~/Projects/Personal/insane-forms',
	'~/Projects/Boundary/fullsteam-portal',
];

function ProjectCreationMenu() {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarGroupAction
					aria-label='Open project creation menu'
					className='top-2 size-6 [&>svg]:size-3.5'
					type='button'
				>
					<FolderPlusIcon aria-hidden='true' />
				</SidebarGroupAction>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-80 p-1'>
				<DropdownMenuItem className='h-9 gap-2 px-2 text-sm'>
					<FolderIcon
						aria-hidden='true'
						className='size-4 shrink-0 text-muted-foreground'
					/>
					<span className='min-w-0 flex-1 truncate'>Open project</span>
				</DropdownMenuItem>
				<DropdownMenuItem className='h-9 gap-2 px-2 text-sm'>
					<GlobeIcon
						aria-hidden='true'
						className='size-4 shrink-0 text-muted-foreground'
					/>
					<span className='min-w-0 flex-1 truncate'>Open GitHub project</span>
				</DropdownMenuItem>
				<DropdownMenuItem className='h-9 gap-2 px-2 text-sm'>
					<FolderPlusIcon
						aria-hidden='true'
						className='size-4 shrink-0 text-muted-foreground'
					/>
					<span className='min-w-0 flex-1 truncate'>Quick start</span>
				</DropdownMenuItem>
				<DropdownMenuLabel className='px-2 pt-3 pb-1 text-muted-foreground text-xs'>
					Recents
				</DropdownMenuLabel>
				{recentProjectPaths.map((path) => (
					<DropdownMenuItem
						className='h-8 gap-2 px-2 text-[0.8125rem]'
						key={path}
					>
						<FolderIcon
							aria-hidden='true'
							className='size-4 shrink-0 text-muted-foreground'
						/>
						<span className='min-w-0 flex-1 truncate'>{path}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ProjectSidebarHeader({
	isCollapsed,
	onRepositorySettingsSelect,
	onToggle,
	project,
	workspaceCount,
}: {
	isCollapsed: boolean;
	onRepositorySettingsSelect: () => void;
	onToggle: () => void;
	project: ProjectShellModel;
	workspaceCount: number;
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<SidebarGroupLabel className='group/project-toggle h-7 justify-between pr-7 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'>
					<span className='flex min-w-0 items-center gap-2'>
						<button
							aria-expanded={!isCollapsed}
							aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} project ${
								project.name
							}`}
							className='relative size-4 shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring'
							onClick={(event) => {
								event.stopPropagation();
								onToggle();
							}}
							onPointerDownCapture={(event) => event.stopPropagation()}
							type='button'
						>
							<span className='pointer-events-none absolute inset-0'>
								<ProjectAvatar
									className='transition-opacity group-hover/project-toggle:opacity-0'
									project={project}
									size='sm'
								/>
							</span>
							<ChevronDownIcon
								aria-hidden='true'
								className={cn(
									'absolute inset-0 m-auto size-4 opacity-0 transition-[opacity,transform] group-hover/project-toggle:opacity-100',
									isCollapsed ? '-rotate-90' : 'rotate-0',
								)}
							/>
						</button>
						<span className='flex min-w-0 items-baseline gap-1.5'>
							<span className='truncate'>{project.name}</span>
							{isCollapsed ? (
								<span className='shrink-0 font-mono text-muted-foreground text-xs'>
									{workspaceCount}
								</span>
							) : null}
						</span>
					</span>
				</SidebarGroupLabel>
			</ContextMenuTrigger>
			<ProjectContextMenuContent
				onRepositorySettingsSelect={onRepositorySettingsSelect}
				project={project}
			/>
		</ContextMenu>
	);
}

function ProjectContextMenuContent({
	onRepositorySettingsSelect,
	project,
}: {
	onRepositorySettingsSelect: () => void;
	project: ProjectShellModel;
}) {
	return (
		<ContextMenuContent
			aria-label={`${project.name} project actions`}
			className='w-56 bg-muted p-1'
		>
			<ContextMenuGroup>
				<ProjectContextMenuItem>
					<PlusIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>New workspace</span>
					<ContextMenuShortcut>⌘N</ContextMenuShortcut>
				</ProjectContextMenuItem>
				<ProjectContextMenuItem>
					<LinkIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Create from...</span>
					<ContextMenuShortcut>⌘⇧N</ContextMenuShortcut>
				</ProjectContextMenuItem>
				<ProjectContextMenuItem onSelect={onRepositorySettingsSelect}>
					<CogIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Repository settings</span>
					<ContextMenuShortcut>⌘,</ContextMenuShortcut>
				</ProjectContextMenuItem>
			</ContextMenuGroup>
			<ContextMenuSeparator />
			<ContextMenuGroup>
				<ProjectContextMenuItem variant='destructive'>
					<Trash2Icon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Remove repository</span>
				</ProjectContextMenuItem>
			</ContextMenuGroup>
		</ContextMenuContent>
	);
}

function ProjectContextMenuItem({
	className,
	...props
}: ComponentProps<typeof ContextMenuItem>) {
	return (
		<ContextMenuItem
			className={cn('h-8 gap-2 px-2 text-[0.8125rem]', className)}
			{...props}
		/>
	);
}

function ProjectAvatar({
	className,
	project,
	size,
}: {
	className?: string;
	project: ProjectShellModel;
	size: 'md' | 'sm';
}) {
	const [hasImageError, setHasImageError] = useState(false);
	const avatarUrl = project.owner.avatarUrl;
	const showImage = Boolean(avatarUrl) && !hasImageError;
	const sizeClassName = size === 'md' ? 'size-6' : 'size-4';
	const iconClassName = size === 'md' ? 'size-3.5' : 'size-2.5';

	return (
		<span
			className={cn(
				'grid shrink-0 place-items-center overflow-hidden rounded-sm bg-muted text-muted-foreground',
				sizeClassName,
				className,
			)}
		>
			{showImage ? (
				<img
					alt={`${project.owner.name} avatar`}
					className='size-full object-cover'
					draggable={false}
					onError={() => setHasImageError(true)}
					src={avatarUrl}
				/>
			) : (
				<FolderGit2Icon aria-hidden='true' className={iconClassName} />
			)}
		</span>
	);
}

function WorkbenchHeader({
	activeProject,
	activeWorkspace,
	isRightSidebarCollapsed,
	onRightSidebarCollapse,
	onRightSidebarOpen,
}: {
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
	isRightSidebarCollapsed: boolean;
	onRightSidebarCollapse: () => void;
	onRightSidebarOpen: () => void;
}) {
	const RightSidebarToggleIcon = isRightSidebarCollapsed
		? PanelRightOpenIcon
		: PanelRightCloseIcon;

	return (
		<header className='native-toolbar flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b px-3'>
			<div className='flex min-w-0 items-center gap-2'>
				<SidebarTrigger className='sidebar-collapsed-trigger' />
				<div className='flex min-w-0 items-center gap-2'>
					<ProjectAvatar project={activeProject} size='md' />
					<div className='min-w-0'>
						<div className='flex min-w-0 items-center gap-1.5 text-[0.8125rem]'>
							<span className='truncate font-medium'>{activeProject.name}</span>
							<span className='text-muted-foreground'>/</span>
							<span className='truncate font-medium'>
								{activeWorkspace.branchName}
							</span>
						</div>
						<p className='truncate text-[0.6875rem] text-muted-foreground'>
							{activeWorkspace.pathLabel}
						</p>
					</div>
				</div>
			</div>
			<div className='flex shrink-0 items-center gap-2'>
				<OpenWorkspaceMenu workspace={activeWorkspace} />
				<Button
					onClick={
						isRightSidebarCollapsed
							? onRightSidebarOpen
							: onRightSidebarCollapse
					}
					size='icon-sm'
					variant='ghost'
				>
					<RightSidebarToggleIcon />
					<span className='sr-only'>
						{isRightSidebarCollapsed
							? 'Open review sidebar'
							: 'Collapse review sidebar'}
					</span>
				</Button>
			</div>
		</header>
	);
}

function OpenWorkspaceMenu({ workspace }: { workspace: WorkspaceShellModel }) {
	const openTargets = workspace.openTargets.filter(
		(target) => target.installed || target.kind === 'utility',
	);
	const primaryTarget =
		openTargets.find((target) => target.isPrimary) ??
		openTargets.find((target) => target.kind !== 'utility') ??
		openTargets[0];

	if (!primaryTarget) {
		return null;
	}

	return (
		<div className='flex h-7 shrink-0 overflow-hidden rounded-md border border-border bg-background'>
			<Button
				aria-label={`Open current workspace in ${primaryTarget.label}`}
				className='size-7 rounded-none border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
				size='icon-sm'
				type='button'
				variant='ghost'
			>
				<OpenTargetIcon className='size-4' target={primaryTarget} />
			</Button>
			<div className='my-1 w-px bg-border' />
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label='Open current workspace app options'
						className='size-7 rounded-none border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
						size='icon-sm'
						type='button'
						variant='ghost'
					>
						<ChevronDownIcon aria-hidden='true' className='size-3.5' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-64 p-1'>
					{openTargets.map((target) => (
						<DropdownMenuItem
							className='h-8 gap-2.5 px-2 text-[0.8125rem]'
							key={target.id}
						>
							<OpenTargetIcon className='size-4' target={target} />
							<span className='min-w-0 flex-1 truncate'>{target.label}</span>
							{target.shortcutLabel ? (
								<span className='shrink-0 text-muted-foreground text-xs'>
									{target.shortcutLabel}
								</span>
							) : null}
							<span className='w-3.5 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
								{target.numberShortcutLabel}
							</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function OpenTargetIcon({
	className,
	target,
}: {
	className?: string;
	target: WorkspaceOpenTarget;
}) {
	const iconClassName = cn('shrink-0', className);

	if (target.iconName.startsWith('vscode-icons:')) {
		return (
			<Icon
				aria-hidden='true'
				className={iconClassName}
				icon={target.iconName}
			/>
		);
	}

	switch (target.iconName) {
		case 'lucide:copy':
			return <CopyIcon aria-hidden='true' className={iconClassName} />;
		case 'lucide:file-code':
			return <FileCodeIcon aria-hidden='true' className={iconClassName} />;
		case 'lucide:folder':
			return <FolderIcon aria-hidden='true' className={iconClassName} />;
		case 'lucide:github':
			return <GitBranchIcon aria-hidden='true' className={iconClassName} />;
		case 'lucide:square-terminal':
			return (
				<SquareTerminalIcon aria-hidden='true' className={iconClassName} />
			);
		case 'lucide:wrench':
			return <WrenchIcon aria-hidden='true' className={iconClassName} />;
		default:
			return <SquareIcon aria-hidden='true' className={iconClassName} />;
	}
}

function RightSidebarHeader({
	activeWorkspace,
}: {
	activeWorkspace: WorkspaceShellModel;
}) {
	const pullRequest = activeWorkspace.pullRequest;
	const headerTone = getPullRequestHeaderTone(pullRequest.status);
	const isMergeReady = headerTone === 'ready';
	const isInFlight =
		pullRequest.status === 'agent-working' || pullRequest.status === 'checking';
	const pullRequestNumber = pullRequest.number;
	const hasPullRequestNumber = typeof pullRequestNumber === 'number';
	const hasWorkspaceChanges = activeWorkspace.changeSummary.files > 0;
	const shouldShowHeaderLabel =
		hasPullRequestNumber || headerTone !== 'neutral';

	return (
		<header
			className='native-toolbar right-sidebar-header flex h-12 w-full shrink-0 items-center gap-3 border-border border-b px-3'
			data-pr-tone={headerTone}
		>
			<div className='flex min-w-0 flex-1 items-center gap-2.5'>
				{hasPullRequestNumber ? (
					<PullRequestNumberButton
						number={pullRequestNumber}
						tone={headerTone}
					/>
				) : null}
				{shouldShowHeaderLabel ? (
					<p
						className={cn(
							'min-w-0 truncate font-semibold text-sm leading-none',
							headerTone === 'ready' && 'text-status-ok',
							headerTone === 'pending' && 'text-foreground',
							headerTone === 'blocked' && 'text-status-danger',
							headerTone === 'neutral' && 'text-muted-foreground',
						)}
					>
						{getPullRequestHeaderLabel(pullRequest)}
					</p>
				) : null}
			</div>
			<div className='ml-auto flex shrink-0 items-center justify-end'>
				{isMergeReady ? (
					<Button
						className='h-7 rounded-md bg-status-ok px-2.5 text-primary-foreground hover:bg-status-ok/90'
						size='sm'
					>
						<GitMergeIcon data-icon='inline-start' />
						Merge
					</Button>
				) : isInFlight && hasPullRequestNumber ? (
					<div
						aria-label='Pull request activity in progress'
						className='grid size-7 place-items-center text-muted-foreground'
						role='status'
					>
						<LoaderCircleIcon
							aria-hidden='true'
							className='size-4 animate-spin'
						/>
					</div>
				) : hasWorkspaceChanges && !hasPullRequestNumber ? (
					<CreatePullRequestMenu />
				) : headerTone !== 'neutral' ? (
					<Button size='icon-sm' variant='ghost'>
						<MoreVerticalIcon />
						<span className='sr-only'>Open pull request menu</span>
					</Button>
				) : null}
			</div>
		</header>
	);
}

function PullRequestNumberButton({
	number,
	tone,
}: {
	number: number;
	tone: 'blocked' | 'neutral' | 'pending' | 'ready';
}) {
	return (
		<Button
			aria-label={`Open pull request #${number}`}
			className={cn(
				'h-6.5 rounded-sm border px-1.75 font-semibold text-xs',
				tone === 'ready' &&
					'border-status-ok/35 bg-status-ok/10 text-status-ok hover:bg-status-ok/15',
				tone === 'pending' &&
					'border-status-warning/35 bg-status-warning/10 text-foreground hover:bg-status-warning/15',
				tone === 'blocked' &&
					'border-status-danger/35 bg-status-danger/10 text-status-danger hover:bg-status-danger/15',
				tone === 'neutral' &&
					'border-border bg-transparent text-muted-foreground hover:bg-muted/70',
			)}
			size='sm'
			variant='outline'
		>
			<span className='font-mono tabular-nums'>#{number}</span>
			<ArrowUpRightIcon aria-hidden='true' className='size-3.5' />
		</Button>
	);
}

function CreatePullRequestMenu() {
	const [isOpen, setIsOpen] = useState(false);
	const closeMenu = () => setIsOpen(false);

	return (
		<div className='flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-border bg-background'>
			<Button
				className='h-7 rounded-none border-0 bg-transparent px-2.5'
				size='sm'
				variant='ghost'
			>
				<GitPullRequestCreateIcon data-icon='inline-start' />
				Create PR
			</Button>
			<span aria-hidden='true' className='h-4 w-px shrink-0 bg-border' />
			<Popover onOpenChange={setIsOpen} open={isOpen}>
				<PopoverTrigger asChild>
					<Button
						aria-label='Open create pull request options'
						className='size-7 rounded-none border-0 bg-transparent'
						size='icon-sm'
						variant='ghost'
					>
						<ChevronDownIcon aria-hidden='true' />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align='end'
					className='w-64 overflow-hidden p-0'
					onOpenAutoFocus={(event) => event.preventDefault()}
				>
					<Command>
						<CommandInput placeholder='Create PR action...' />
						<CommandList>
							<CommandEmpty>No PR actions found.</CommandEmpty>
							<CommandGroup heading='Pull request'>
								<CommandItem onSelect={closeMenu} value='create draft pr'>
									<GitPullRequestDraftIcon aria-hidden='true' />
									<span>Create draft PR</span>
									<CommandShortcut>Draft</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={closeMenu} value='create pr manually'>
									<ExternalLinkIcon aria-hidden='true' />
									<span>Create PR manually</span>
									<CommandShortcut>Web</CommandShortcut>
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function getPullRequestHeaderTone(
	status: WorkspaceShellModel['pullRequest']['status'],
): 'blocked' | 'neutral' | 'pending' | 'ready' {
	if (status === 'ready-to-merge') {
		return 'ready';
	}

	if (status === 'checking') {
		return 'pending';
	}

	if (status === 'blocked') {
		return 'blocked';
	}

	return 'neutral';
}

function getPullRequestHeaderLabel({
	label,
	status,
}: WorkspaceShellModel['pullRequest']) {
	if (status === 'idle' || status === 'agent-working') {
		return 'Working...';
	}

	return label;
}

function SessionTabs({
	activeSession,
	closedSessions,
	onSessionTabClose,
	onSessionTabChange,
	onSessionTabRestore,
	sessions,
}: {
	activeSession: SessionTabModel;
	closedSessions: SessionTabModel[];
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabRestore: (sessionId: string) => void;
	sessions: SessionTabModel[];
}) {
	const canCloseTabs = sessions.length > 1;

	return (
		<div className='flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b bg-background px-3'>
			<div className='flex min-w-0 flex-1 items-center gap-1.5'>
				<div className='no-scrollbar flex min-w-0 gap-1 overflow-x-auto'>
					{sessions.map((session) => {
						const isActive = session.id === activeSession.id;
						const SessionIcon =
							session.status === 'working'
								? LoaderCircleIcon
								: MessageSquareIcon;

						return (
							<div
								className={cn(
									'group/session-tab relative flex h-12 min-w-[7.5rem] flex-none items-center overflow-hidden border-transparent border-b-2 text-xs transition-colors',
									isActive
										? 'border-primary bg-muted/50 text-foreground'
										: 'text-muted-foreground hover:text-foreground',
								)}
								key={session.id}
							>
								<button
									className='flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left'
									onClick={() => onSessionTabChange(session.id)}
									type='button'
								>
									<span className='grid size-3.5 shrink-0 place-items-center'>
										<SessionIcon
											aria-hidden='true'
											className={cn(
												'size-3.5',
												session.status === 'working' && 'animate-spin',
											)}
										/>
									</span>
									<span className='truncate'>{session.label}</span>
								</button>
								{canCloseTabs ? (
									<>
										<span
											aria-hidden='true'
											className={cn(
												'pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l to-transparent opacity-0 transition-opacity group-hover/session-tab:opacity-100',
												isActive
													? 'from-muted via-muted/90'
													: 'from-background via-background/90',
											)}
										/>
										<button
											aria-label={`Close ${session.label} tab`}
											className='absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-sm opacity-0 transition-all hover:bg-transparent hover:text-foreground focus-visible:opacity-100 group-hover/session-tab:opacity-100'
											onClick={(event) => {
												event.stopPropagation();
												onSessionTabClose(session.id);
											}}
											type='button'
										>
											<XIcon aria-hidden='true' className='size-3' />
										</button>
									</>
								) : null}
							</div>
						);
					})}
				</div>
				<div className='flex shrink-0 items-center gap-1'>
					<Button size='icon-sm' variant='ghost'>
						<PlusIcon />
						<span className='sr-only'>New chat tab</span>
					</Button>
				</div>
			</div>
			<ClosedSessionHistoryMenu
				closedSessions={closedSessions}
				onSessionTabRestore={onSessionTabRestore}
			/>
		</div>
	);
}

function ClosedSessionHistoryMenu({
	closedSessions,
	onSessionTabRestore,
}: {
	closedSessions: SessionTabModel[];
	onSessionTabRestore: (sessionId: string) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size='icon-sm' variant='ghost'>
					<HistoryIcon />
					<span className='sr-only'>Open closed chat tabs</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-72 p-1'>
				{closedSessions.length ? (
					closedSessions.map((session) => (
						<DropdownMenuItem
							className='h-10 gap-2 px-2 text-[0.8125rem]'
							key={session.id}
							onSelect={() => onSessionTabRestore(session.id)}
						>
							<MessageSquareIcon
								aria-hidden='true'
								className='size-4 shrink-0 text-muted-foreground'
							/>
							<span className='min-w-0 flex-1 truncate font-medium'>
								{session.label}
							</span>
							<span className='shrink-0 text-muted-foreground text-xs'>
								{session.updatedLabel}
							</span>
							<RotateCcwIcon
								aria-hidden='true'
								className='size-3.5 shrink-0 text-muted-foreground'
							/>
						</DropdownMenuItem>
					))
				) : (
					<DropdownMenuItem
						className='h-9 px-2 text-muted-foreground text-xs'
						disabled
					>
						No closed chat tabs
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function WorkspaceTimeline({
	activeSession,
	composer,
	setupDiagnostics,
	workspace,
}: {
	activeSession: SessionTabModel;
	composer: ComposerShellState;
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	workspace: WorkspaceShellModel;
}) {
	return (
		<div className='mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5'>
			{setupDiagnostics?.status !== 'ready' ? (
				<section className='flex flex-col gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-3'>
					<div className='flex items-start gap-2'>
						<CircleDashedIcon
							aria-hidden='true'
							className='mt-0.5 size-4 shrink-0 text-status-warning'
						/>
						<div className='min-w-0'>
							<p className='font-medium text-sm'>
								Setup keeps the shell in place
							</p>
							<p className='mt-1 text-muted-foreground text-xs leading-5'>
								The workbench remains visible while setup diagnostics block the
								composer. Use the setup dock to inspect remediation.
							</p>
						</div>
					</div>
				</section>
			) : null}

			<AgentChatThread
				activeSession={activeSession}
				composer={composer}
				workspace={workspace}
			/>
		</div>
	);
}

function AgentChatThread({
	activeSession,
	composer,
	workspace,
}: {
	activeSession: SessionTabModel;
	composer: ComposerShellState;
	workspace: WorkspaceShellModel;
}) {
	return (
		<section aria-label='Mock agent chat' className='flex flex-col gap-5'>
			<ChatMessage
				author='You'
				body={[
					`Can you update ${workspace.name} so the sidebar feels closer to Conductor?`,
					'Start with the project groups, pinned workspaces, and workspace actions.',
				]}
				speaker='user'
				time='14:31'
			/>
			<ChatMessage
				author='Pi'
				body={[
					`I am working in ${workspace.branchName}. I will keep the sidebar data model local to the shell fixture and preserve the existing project ordering.`,
				]}
				speaker='assistant'
				time='14:32'
				tools={[
					{
						detail: 'Read workbench-shell.tsx and sidebar primitives',
						icon: SearchIcon,
						label: 'Inspecting layout',
						status: 'done',
					},
					{
						detail: 'Project collapse, context menus, and pinned rows',
						icon: FileCodeIcon,
						label: 'Editing sidebar',
						status: 'done',
					},
				]}
			/>
			<ChatMessage
				author='You'
				body={[
					'Pin should move a workspace out of Projects, and the row motion should stay calm.',
				]}
				speaker='user'
				time='14:38'
			/>
			<ChatMessage
				author='Pi'
				body={[
					'Pinned workspaces now render above Projects, project counts ignore pinned rows, and pinning briefly disables reorder layout motion while the list reflows.',
				]}
				speaker='assistant'
				time='14:39'
				tools={[
					{
						detail: 'bun run check',
						icon: SquareTerminalIcon,
						label: 'Biome and Tailwind',
						status: 'done',
					},
					{
						detail: 'bun run test:renderer',
						icon: CheckCircle2Icon,
						label: 'Renderer tests',
						status: 'done',
					},
					{
						detail: 'bun run typecheck',
						icon: CheckCircle2Icon,
						label: 'TypeScript',
						status: 'done',
					},
				]}
			/>
			<ChatMessage
				author='Pi'
				body={[
					`Current thread: ${activeSession.label}. I am mocking this chat pane with agent messages, tool activity, and verification output so the composer has a real conversation target.`,
				]}
				speaker='assistant'
				status={composer.disabled ? 'blocked' : 'working'}
				time='now'
				tools={[
					{
						detail: composer.disabled
							? 'Waiting for setup diagnostics to clear'
							: 'Replacing timeline cards with chat transcript',
						icon: composer.disabled ? CircleDashedIcon : LoaderCircleIcon,
						label: composer.disabled
							? 'Composer blocked'
							: 'Chat mock in progress',
						status: composer.disabled ? 'pending' : 'running',
					},
				]}
			/>
		</section>
	);
}

function ChatMessage({
	author,
	body,
	speaker,
	status,
	time,
	tools = [],
}: {
	author: string;
	body: string[];
	speaker: 'assistant' | 'user';
	status?: 'blocked' | 'working';
	time: string;
	tools?: ChatToolActivity[];
}) {
	const isUser = speaker === 'user';
	const AvatarIcon = isUser ? UserIcon : BotIcon;

	return (
		<div className={cn('flex gap-3', isUser && 'justify-end')}>
			{isUser ? null : (
				<ChatAvatar
					icon={AvatarIcon}
					isWorking={status === 'working'}
					tone={status === 'blocked' ? 'warning' : 'muted'}
				/>
			)}
			<div
				className={cn(
					'flex min-w-0 max-w-[min(38rem,100%)] flex-col gap-1.5',
					isUser && 'items-end',
				)}
			>
				<div className='flex items-center gap-2 text-muted-foreground text-xs'>
					<span className='font-medium text-foreground'>{author}</span>
					<span>{time}</span>
				</div>
				<div
					className={cn(
						'rounded-md px-3 py-2 text-[0.8125rem] leading-5',
						isUser
							? 'bg-primary/15 text-foreground'
							: 'border border-border bg-pane text-foreground',
					)}
				>
					<div className='flex flex-col gap-2'>
						{body.map((paragraph) => (
							<p key={paragraph}>{paragraph}</p>
						))}
					</div>
					{tools.length ? <ChatToolList tools={tools} /> : null}
				</div>
			</div>
			{isUser ? <ChatAvatar icon={AvatarIcon} tone='primary' /> : null}
		</div>
	);
}

function ChatAvatar({
	icon: AvatarIcon,
	isWorking = false,
	tone,
}: {
	icon: LucideIcon;
	isWorking?: boolean;
	tone: 'muted' | 'primary' | 'warning';
}) {
	return (
		<div
			className={cn(
				'mt-5 grid size-7 shrink-0 place-items-center rounded-full border',
				tone === 'primary' &&
					'border-primary/30 bg-primary/15 text-primary-foreground',
				tone === 'warning' &&
					'border-status-warning/30 bg-status-warning/10 text-status-warning',
				tone === 'muted' && 'border-border bg-pane text-muted-foreground',
			)}
		>
			<AvatarIcon
				aria-hidden='true'
				className={cn('size-3.5', isWorking && 'animate-pulse')}
			/>
		</div>
	);
}

interface ChatToolActivity {
	detail: string;
	icon: LucideIcon;
	label: string;
	status: 'done' | 'pending' | 'running';
}

function ChatToolList({ tools }: { tools: ChatToolActivity[] }) {
	return (
		<div className='mt-3 flex flex-col gap-1.5'>
			{tools.map((tool) => {
				const ToolIcon = tool.icon;

				return (
					<div
						className='flex min-w-0 items-center gap-2 rounded-sm bg-muted/45 px-2 py-1.5 text-xs'
						key={`${tool.label}-${tool.detail}`}
					>
						<ToolIcon
							aria-hidden='true'
							className={cn(
								'size-3.5 shrink-0',
								tool.status === 'done' && 'text-status-ok',
								tool.status === 'pending' && 'text-status-warning',
								tool.status === 'running' &&
									'animate-spin text-muted-foreground',
							)}
						/>
						<span className='min-w-0 flex-1 truncate font-medium'>
							{tool.label}
						</span>
						<span className='min-w-0 max-w-72 truncate text-muted-foreground'>
							{tool.detail}
						</span>
					</div>
				);
			})}
		</div>
	);
}

function ComposerPanel({ composer }: { composer: ComposerShellState }) {
	return (
		<footer className='shrink-0 border-border border-t bg-background p-3'>
			<div className='rounded-md border border-border bg-pane p-2'>
				<Textarea
					aria-label='Pi composer'
					className='min-h-24 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0'
					disabled={composer.disabled}
					placeholder={composer.placeholder}
				/>
				<div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
					<div className='flex flex-wrap items-center gap-1.5'>
						<StatusBadge tone='muted'>{composer.modelLabel}</StatusBadge>
						<StatusBadge tone='muted'>{composer.thinkingLabel}</StatusBadge>
						{composer.disabledReason ? (
							<StatusBadge
								className='min-w-0 max-w-full truncate'
								tone='warning'
							>
								{composer.disabledReason}
							</StatusBadge>
						) : null}
					</div>
					<div className='flex items-center gap-1.5'>
						<Button disabled={composer.disabled} size='sm' variant='outline'>
							<FileCodeIcon data-icon='inline-start' />
							Attach
						</Button>
						<Button disabled={composer.disabled} size='sm'>
							Send
						</Button>
					</div>
				</div>
			</div>
		</footer>
	);
}

function ReviewPanel({
	activeTab,
	onTabChange,
	workspace,
}: {
	activeTab: ReviewPanelTab;
	onTabChange: (tab: ReviewPanelTab) => void;
	workspace: WorkspaceShellModel;
}) {
	const [changesViewMode, setChangesViewMode] =
		useState<ChangesViewMode>('list');
	const [isFileSearchOpen, setIsFileSearchOpen] = useState(false);
	const reviewTabs: Array<{
		count?: number;
		id: ReviewPanelTab;
		label: string;
	}> = [
		{ id: 'files', label: 'All files' },
		{
			count: workspace.changeSummary.files,
			id: 'changes',
			label: 'Changes',
		},
		{ id: 'checks', label: 'Checks' },
	];

	useEffect(() => {
		if (activeTab !== 'files') {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				!(event.metaKey || event.ctrlKey) ||
				event.key.toLowerCase() !== 'p'
			) {
				return;
			}

			event.preventDefault();
			setIsFileSearchOpen(true);
		};

		window.addEventListener('keydown', handleKeyDown);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [activeTab]);

	return (
		<Tabs
			className='review-panel h-full min-h-0 gap-0 border-border border-b'
			onValueChange={(value) => onTabChange(value as ReviewPanelTab)}
			value={activeTab}
		>
			<div className='flex h-12 shrink-0 items-center justify-between gap-2 overflow-hidden border-border border-b px-3'>
				<div className='no-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden'>
					<div className='flex w-max min-w-full items-center gap-1'>
						{reviewTabs.map((tab) => (
							<ReviewTabButton
								count={tab.count}
								isActive={activeTab === tab.id}
								key={tab.id}
								label={tab.label}
								onSelect={() => onTabChange(tab.id)}
							/>
						))}
					</div>
				</div>
				<ReviewPanelActions
					activeTab={activeTab}
					changesViewMode={changesViewMode}
					onChangesViewModeToggle={() =>
						setChangesViewMode((current) =>
							current === 'list' ? 'folders' : 'list',
						)
					}
					onFileSearchOpen={() => setIsFileSearchOpen(true)}
					workspace={workspace}
				/>
			</div>
			<TabsContent className='min-h-0 overflow-hidden' value='files'>
				<AllFilesList files={workspace.workspaceFiles} />
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='changes'>
				<ReviewFileList
					files={workspace.reviewFiles}
					viewMode={changesViewMode}
				/>
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='checks'>
				<ChecksPanel workspace={workspace} />
			</TabsContent>
			<AllFilesSearchDialog
				files={workspace.workspaceFiles}
				onOpenChange={setIsFileSearchOpen}
				open={isFileSearchOpen}
			/>
		</Tabs>
	);
}

function ReviewPanelActions({
	activeTab,
	changesViewMode,
	onChangesViewModeToggle,
	onFileSearchOpen,
	workspace,
}: {
	activeTab: ReviewPanelTab;
	changesViewMode: ChangesViewMode;
	onChangesViewModeToggle: () => void;
	onFileSearchOpen: () => void;
	workspace: WorkspaceShellModel;
}) {
	if (activeTab === 'checks') {
		return <div className='w-0 shrink-0' />;
	}

	const ChangesViewIcon =
		changesViewMode === 'folders' ? ListIcon : ListTreeIcon;

	return (
		<div className='flex shrink-0 items-center gap-0.5'>
			{activeTab === 'changes' ? (
				<>
					<Button
						className='text-accent-strong hover:text-foreground'
						size='xs'
						variant='ghost'
					>
						<EyeIcon data-icon='inline-start' />
						<span className='review-panel-action-label'>Review</span>
					</Button>
					<Button
						aria-pressed={changesViewMode === 'folders'}
						className={cn(
							changesViewMode === 'folders' && 'bg-muted text-foreground',
						)}
						onClick={onChangesViewModeToggle}
						size='icon-sm'
						variant='ghost'
					>
						<ChangesViewIcon />
						<span className='sr-only'>
							{changesViewMode === 'folders'
								? 'Show changes as list'
								: 'Show changes as folders'}
						</span>
					</Button>
					<ChangesOverflowMenu workspace={workspace} />
				</>
			) : activeTab === 'files' ? (
				<Button onClick={onFileSearchOpen} size='icon-sm' variant='ghost'>
					<SearchIcon />
					<span className='sr-only'>Search files</span>
				</Button>
			) : (
				<Button size='icon-sm' variant='ghost'>
					<MoreVerticalIcon />
					<span className='sr-only'>Open review menu</span>
				</Button>
			)}
		</div>
	);
}

function ChangesOverflowMenu({
	workspace,
}: {
	workspace: WorkspaceShellModel;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size='icon-sm' variant='ghost'>
					<MoreVerticalIcon />
					<span className='sr-only'>Open changes menu</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-80 p-0'>
				<div className='p-1'>
					<DropdownMenuItem className='h-9 px-2 text-sm'>
						<span className='min-w-0 flex-1 truncate'>All changes</span>
						<CheckIcon aria-hidden='true' className='size-4' />
					</DropdownMenuItem>
					<DropdownMenuItem className='items-start px-2 py-2'>
						<div className='min-w-0 flex-1'>
							<div className='truncate font-medium text-sm'>
								Uncommitted changes
							</div>
							<div className='text-muted-foreground text-xs'>
								{workspace.changeSummary.files} files changed
							</div>
						</div>
						<DropdownMenuShortcut>⌥U</DropdownMenuShortcut>
					</DropdownMenuItem>
				</div>
				<DropdownMenuSeparator className='my-0' />
				<div className='p-1'>
					<DropdownMenuItem className='items-start px-2 py-2'>
						<div className='min-w-0'>
							<div className='truncate font-medium text-sm'>
								Refine right sidebar PR header states
							</div>
							<div className='truncate text-muted-foreground text-xs'>
								0dc9887 • Philipp Soldunov • 29m ago
							</div>
						</div>
					</DropdownMenuItem>
					<DropdownMenuItem className='items-start px-2 py-2'>
						<div className='min-w-0'>
							<div className='truncate font-medium text-sm'>
								THE-102 rework workbench shell
							</div>
							<div className='truncate text-muted-foreground text-xs'>
								4339956 • Philipp Soldunov • 1h ago
							</div>
						</div>
					</DropdownMenuItem>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ReviewTabButton({
	count,
	isActive,
	label,
	onSelect,
}: {
	count?: number;
	isActive: boolean;
	label: string;
	onSelect: () => void;
}) {
	return (
		<button
			aria-pressed={isActive}
			className={cn(
				'flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-xs transition-colors',
				isActive
					? 'bg-muted font-medium text-foreground'
					: 'text-muted-foreground hover:text-foreground',
			)}
			onClick={onSelect}
			type='button'
		>
			<span>{label}</span>
			{typeof count === 'number' ? (
				<span className='shrink-0 font-mono text-muted-foreground tabular-nums'>
					{count}
				</span>
			) : null}
		</button>
	);
}

function ReviewFileList({
	files,
	viewMode,
}: {
	files: ReviewFileSummary[];
	viewMode: ChangesViewMode;
}) {
	const visibleFiles = files.filter((file) => file.additions || file.deletions);

	return (
		<ScrollArea className='h-full'>
			<div className='flex flex-col gap-1 p-3'>
				{visibleFiles.length ? (
					viewMode === 'folders' ? (
						<ReviewFileTree files={visibleFiles} />
					) : (
						visibleFiles.map((file) => (
							<ReviewFileButton file={file} key={file.id} showPath />
						))
					)
				) : (
					<div className='rounded-md border border-border bg-pane px-3 py-4 text-muted-foreground text-xs leading-5'>
						File state will appear here when the Git workspace service is wired.
					</div>
				)}
			</div>
		</ScrollArea>
	);
}

function ReviewFileTree({ files }: { files: ReviewFileSummary[] }) {
	const [collapsedDirectoryPaths, setCollapsedDirectoryPaths] = useState<
		Set<string>
	>(() => new Set());
	const tree = buildReviewFileTree(files);
	const toggleDirectory = (path: string) => {
		setCollapsedDirectoryPaths((current) => {
			const next = new Set(current);

			if (next.has(path)) {
				next.delete(path);
				return next;
			}

			next.add(path);
			return next;
		});
	};

	return (
		<>
			{tree.files.map((file) => (
				<ReviewFileButton file={file} key={file.id} showPath />
			))}
			{tree.directories.map((directory) => (
				<ReviewDirectoryBranch
					collapsedDirectoryPaths={collapsedDirectoryPaths}
					key={directory.path}
					level={0}
					node={directory}
					onDirectoryToggle={toggleDirectory}
				/>
			))}
		</>
	);
}

function ReviewDirectoryBranch({
	collapsedDirectoryPaths,
	level,
	node,
	onDirectoryToggle,
}: {
	collapsedDirectoryPaths: Set<string>;
	level: number;
	node: ReviewFileTreeNode;
	onDirectoryToggle: (path: string) => void;
}) {
	const compactDirectory = getCompactReviewDirectory(node);
	const isCollapsed = collapsedDirectoryPaths.has(compactDirectory.node.path);

	return (
		<Fragment>
			<ReviewFolderRow
				isCollapsed={isCollapsed}
				labelParts={compactDirectory.labelParts}
				level={level}
				onToggle={() => onDirectoryToggle(compactDirectory.node.path)}
				path={compactDirectory.node.path}
			/>
			{isCollapsed ? null : (
				<>
					{compactDirectory.node.directories.map((directory) => (
						<ReviewDirectoryBranch
							collapsedDirectoryPaths={collapsedDirectoryPaths}
							key={directory.path}
							level={level + 1}
							node={directory}
							onDirectoryToggle={onDirectoryToggle}
						/>
					))}
					{compactDirectory.node.files.map((file) => (
						<ReviewFileButton
							file={file}
							key={file.id}
							level={level + 1}
							showPath={false}
						/>
					))}
				</>
			)}
		</Fragment>
	);
}

function ReviewFolderRow({
	isCollapsed,
	labelParts,
	level,
	onToggle,
	path,
}: {
	isCollapsed: boolean;
	labelParts: string[];
	level: number;
	onToggle: () => void;
	path: string;
}) {
	const FolderChevronIcon = isCollapsed ? ChevronRightIcon : ChevronDownIcon;
	const folderIconName = getWorkspaceFileIconName({
		kind: 'directory',
		name: labelParts[0] ?? path,
	});

	return (
		<button
			aria-expanded={!isCollapsed}
			aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${path}`}
			className={cn(
				'flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
				reviewFileIndentClassName(level),
			)}
			onClick={onToggle}
			type='button'
		>
			<FolderChevronIcon aria-hidden='true' className='size-3 shrink-0' />
			<Icon
				aria-hidden='true'
				className='size-3.5 shrink-0'
				icon={folderIconName}
			/>
			<span className='min-w-0 truncate font-mono'>
				{labelParts.map((label, index) => (
					<Fragment key={`${label}-${index}`}>
						{index > 0 ? (
							<span className='px-1 text-muted-foreground/70'>/</span>
						) : null}
						<span>{label}</span>
					</Fragment>
				))}
			</span>
		</button>
	);
}

function ReviewFileButton({
	file,
	level = 0,
	showPath,
}: {
	file: ReviewFileSummary;
	level?: number;
	showPath: boolean;
}) {
	const fileName = getReviewFileName(file.path);

	return (
		<button
			aria-label={`Open ${file.path} diff`}
			className={cn(
				'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
				reviewFileIndentClassName(level),
			)}
			type='button'
		>
			<div className='flex min-w-0 items-center gap-2 text-xs'>
				<Icon
					aria-hidden='true'
					className='size-3.5 shrink-0'
					icon={getWorkspaceFileIconName({ kind: 'file', name: fileName })}
				/>
				{showPath ? (
					<ReviewFilePath path={file.path} />
				) : (
					<span className='min-w-0 truncate'>{fileName}</span>
				)}
			</div>
			<ReviewFileStats file={file} />
		</button>
	);
}

function ReviewFilePath({ path }: { path: string }) {
	const directory = getReviewFileDirectory(path);
	const fileName = getReviewFileName(path);

	return (
		<span className='min-w-0 truncate'>
			{directory ? (
				<span className='text-muted-foreground'>{directory}/</span>
			) : null}
			<span>{fileName}</span>
		</span>
	);
}

function ReviewFileStats({ file }: { file: ReviewFileSummary }) {
	const statusLabel =
		file.status === 'modified' ? null : fileStatusLabel[file.status];

	return (
		<div className='flex min-w-0 max-w-28 shrink-0 items-center justify-end gap-1 font-mono text-[0.6875rem] tabular-nums'>
			{statusLabel ? (
				<span className='truncate text-muted-foreground'>{statusLabel}</span>
			) : null}
			{file.additions > 0 ? (
				<span className='shrink-0 text-status-ok'>+{file.additions}</span>
			) : null}
			{file.deletions > 0 ? (
				<span className='shrink-0 text-status-danger'>-{file.deletions}</span>
			) : null}
		</div>
	);
}

function buildReviewFileTree(
	files: ReviewFileSummary[],
): MutableReviewFileTreeNode {
	const root = createReviewFileTreeNode('', '');

	for (const file of files) {
		const pathParts = file.path.split('/').filter(Boolean);
		const fileName = pathParts.pop();

		if (!fileName) {
			continue;
		}

		let currentNode = root;

		for (const directoryName of pathParts) {
			const directoryPath = currentNode.path
				? `${currentNode.path}/${directoryName}`
				: directoryName;
			let nextNode = currentNode.directoryMap.get(directoryName);

			if (!nextNode) {
				nextNode = createReviewFileTreeNode(directoryName, directoryPath);
				currentNode.directoryMap.set(directoryName, nextNode);
				currentNode.directories.push(nextNode);
			}

			currentNode = nextNode;
		}

		currentNode.files.push(file);
	}

	return root;
}

function createReviewFileTreeNode(
	name: string,
	path: string,
): MutableReviewFileTreeNode {
	return {
		directories: [],
		directoryMap: new Map(),
		files: [],
		name,
		path,
	};
}

function getCompactReviewDirectory(node: ReviewFileTreeNode): {
	labelParts: string[];
	node: ReviewFileTreeNode;
} {
	const labelParts = [node.name];
	let compactNode = node;

	while (
		compactNode.files.length === 0 &&
		compactNode.directories.length === 1
	) {
		compactNode = compactNode.directories[0];
		labelParts.push(compactNode.name);
	}

	return { labelParts, node: compactNode };
}

function getReviewFileDirectory(path: string) {
	const lastSeparatorIndex = path.lastIndexOf('/');

	return lastSeparatorIndex === -1 ? '' : path.slice(0, lastSeparatorIndex);
}

function getReviewFileName(path: string) {
	const lastSeparatorIndex = path.lastIndexOf('/');

	return lastSeparatorIndex === -1 ? path : path.slice(lastSeparatorIndex + 1);
}

function reviewFileIndentClassName(level: number) {
	if (level <= 0) {
		return '';
	}

	if (level === 1) {
		return 'pl-6';
	}

	if (level === 2) {
		return 'pl-10';
	}

	if (level === 3) {
		return 'pl-14';
	}

	return 'pl-16';
}

function AllFilesList({ files }: { files: WorkspaceFileSummary[] }) {
	return (
		<ScrollArea className='h-full'>
			<ul className='flex flex-col gap-0.5 p-2.5'>
				{files.length ? (
					files.map((file) => (
						<li key={file.id}>
							<button
								aria-label={getWorkspaceFileActionLabel(file)}
								className='flex min-h-7 w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-0.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
								type='button'
							>
								<WorkspaceFileIcon file={file} />
								<span className='min-w-0 truncate font-mono text-xs leading-none'>
									{file.name}
								</span>
							</button>
						</li>
					))
				) : (
					<li className='rounded-md border border-border bg-pane px-3 py-4 text-muted-foreground text-xs leading-5'>
						Repository files will appear here when the workspace file service is
						wired.
					</li>
				)}
			</ul>
		</ScrollArea>
	);
}

function AllFilesSearchDialog({
	files,
	onOpenChange,
	open,
}: {
	files: WorkspaceFileSummary[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const searchableFiles = files.filter((file) => file.kind === 'file');
	const closeSearch = () => {
		onOpenChange(false);
	};

	return (
		<CommandDialog
			className='top-20 max-w-xl translate-y-0 shadow-2xl sm:max-w-xl'
			description='Open a repository file from the All files tab.'
			onOpenChange={onOpenChange}
			open={open}
			title='Search files'
		>
			<Command className='rounded-xl border-0'>
				<CommandInput placeholder='Search files' />
				<CommandList className='max-h-80'>
					<CommandEmpty>No files match your search.</CommandEmpty>
					<CommandGroup heading='Files'>
						{searchableFiles.map((file) => (
							<CommandItem
								aria-label={`Open ${file.path} preview`}
								className='min-h-10'
								key={file.id}
								onSelect={closeSearch}
								value={`${file.name} ${file.path}`}
							>
								<WorkspaceFileIcon file={file} />
								<div className='min-w-0 flex-1'>
									<div className='truncate text-xs'>{file.name}</div>
									{file.path !== file.name ? (
										<div className='truncate text-[0.6875rem] text-muted-foreground'>
											{file.path}
										</div>
									) : null}
								</div>
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</Command>
		</CommandDialog>
	);
}

function getWorkspaceFileActionLabel(file: WorkspaceFileSummary) {
	return file.kind === 'directory'
		? `Open ${file.name} directory`
		: `Open ${file.name} preview`;
}

function WorkspaceFileIcon({ file }: { file: WorkspaceFileSummary }) {
	return (
		<Icon
			aria-hidden='true'
			className='size-3.5 shrink-0'
			icon={getWorkspaceFileIconName(file)}
		/>
	);
}

function ChecksPanel({ workspace }: { workspace: WorkspaceShellModel }) {
	const pullRequest = workspace.pullRequest;

	if (typeof pullRequest.number !== 'number') {
		return <ChecksEmptyState workspace={workspace} />;
	}

	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'>
				<section className='flex min-w-0 flex-col gap-2'>
					<h2 className='min-w-0 truncate font-semibold text-sm'>
						{pullRequest.title}
					</h2>
					<div className='flex min-w-0 flex-col gap-2 text-muted-foreground text-xs leading-4'>
						{pullRequest.description.map((paragraph) => (
							<p className='min-w-0 break-words' key={paragraph}>
								{paragraph}
							</p>
						))}
					</div>
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Git status' />
					<PullRequestStatusRow status={pullRequest.gitStatus} />
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Checks' />
					{pullRequest.checks.map((check) => (
						<PullRequestCheckRow check={check} key={check.id} />
					))}
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader
						actionLabel={
							pullRequest.comments.length ? 'Add all to chat' : undefined
						}
						label='Comments'
					/>
					{pullRequest.comments.length ? (
						pullRequest.comments.map((comment) => (
							<PullRequestCommentRow comment={comment} key={comment.id} />
						))
					) : (
						<p className='text-muted-foreground text-xs'>No comments yet</p>
					)}
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader actionLabel='+ Add' label='Your todos' />
					{pullRequest.todos.length ? (
						pullRequest.todos.map((todo) => (
							<div
								className='flex min-h-7 min-w-0 items-center gap-2 px-1'
								key={todo.id}
							>
								<CircleIcon
									aria-hidden='true'
									className='size-3 shrink-0 text-muted-foreground'
								/>
								<span className='min-w-0 truncate text-xs'>{todo.label}</span>
							</div>
						))
					) : (
						<p className='text-muted-foreground text-xs'>No todos yet</p>
					)}
				</section>
			</div>
		</ScrollArea>
	);
}

function ChecksEmptyState({ workspace }: { workspace: WorkspaceShellModel }) {
	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'>
				<section className='flex min-w-0 flex-col gap-2'>
					<h2 className='font-semibold text-muted-foreground text-sm'>
						PR title
					</h2>
					<p className='text-muted-foreground text-xs'>PR description</p>
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Git status' />
					<ChecksActionRow actionLabel='Create PR' label='No PR open' />
					<ChecksActionRow
						actionLabel='Commit and push'
						label={`${workspace.changeSummary.files} uncommitted changes`}
					/>
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader actionLabel='+ Add' label='Your todos' />
					<p className='text-muted-foreground text-xs'>No todos yet</p>
				</section>
			</div>
		</ScrollArea>
	);
}

function ChecksSectionHeader({
	actionLabel,
	label,
}: {
	actionLabel?: string;
	label: string;
}) {
	return (
		<div className='flex min-h-6 min-w-0 items-center justify-between gap-2'>
			<h3 className='font-semibold text-muted-foreground text-xs'>{label}</h3>
			{actionLabel ? (
				<Button
					className='h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground'
					size='xs'
					variant='ghost'
				>
					{actionLabel}
				</Button>
			) : null}
		</div>
	);
}

function PullRequestStatusRow({
	status,
}: {
	status: WorkspaceShellModel['pullRequest']['gitStatus'];
}) {
	return (
		<div className='flex min-h-7 min-w-0 items-center justify-between gap-2 px-1'>
			<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
				<CircleIcon
					aria-hidden='true'
					className='size-3 shrink-0 text-muted-foreground'
				/>
				<span className='min-w-0 truncate font-medium text-xs'>
					{status.label}
				</span>
			</div>
			{status.actionLabel ? (
				<Button
					className='h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground'
					size='xs'
					variant='ghost'
				>
					{status.actionLabel}
				</Button>
			) : null}
		</div>
	);
}

function ChecksActionRow({
	actionLabel,
	label,
}: {
	actionLabel: string;
	label: string;
}) {
	return (
		<div className='flex min-h-7 min-w-0 items-center justify-between gap-2 px-1'>
			<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
				<CircleIcon
					aria-hidden='true'
					className='size-3 shrink-0 text-muted-foreground'
				/>
				<span className='min-w-0 truncate text-xs'>{label}</span>
			</div>
			<Button
				className='h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground'
				size='xs'
				variant='ghost'
			>
				{actionLabel}
			</Button>
		</div>
	);
}

function PullRequestCheckRow({
	check,
}: {
	check: WorkspaceShellModel['pullRequest']['checks'][number];
}) {
	return (
		<div className='flex min-h-7 min-w-0 items-center justify-between gap-2 px-1'>
			<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
				<PullRequestCheckStatusIcon status={check.status} />
				<ProviderMark provider={check.provider} />
				<div className='flex min-w-0 items-center gap-2'>
					<span className='min-w-0 truncate font-medium text-xs'>
						{check.label}
					</span>
					{check.durationLabel ? (
						<span className='shrink-0 text-muted-foreground text-xs'>
							{check.durationLabel}
						</span>
					) : null}
				</div>
			</div>
			<Button className='size-6' size='icon-xs' variant='ghost'>
				<ExternalLinkIcon />
				<span className='sr-only'>Open check</span>
			</Button>
		</div>
	);
}

function PullRequestCommentRow({
	comment,
}: {
	comment: WorkspaceShellModel['pullRequest']['comments'][number];
}) {
	return (
		<div className='flex min-h-7 min-w-0 items-center gap-2 overflow-hidden px-1'>
			<CircleIcon
				aria-hidden='true'
				className='size-3 shrink-0 text-muted-foreground'
			/>
			<ProviderMark provider={comment.provider} />
			<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
				<span className='max-w-28 shrink-0 truncate font-semibold text-xs'>
					{comment.provider}
				</span>
				<span className='min-w-0 truncate text-muted-foreground text-xs'>
					{comment.detail}
				</span>
			</div>
		</div>
	);
}

function PullRequestCheckStatusIcon({
	status,
}: {
	status: WorkspaceShellModel['pullRequest']['checks'][number]['status'];
}) {
	if (status === 'ready') {
		return (
			<CheckIcon
				aria-hidden='true'
				className='size-3 shrink-0 text-status-ok'
			/>
		);
	}

	if (status === 'pending') {
		return (
			<LoaderCircleIcon
				aria-hidden='true'
				className='size-3 shrink-0 animate-spin text-status-warning'
			/>
		);
	}

	return (
		<CircleDashedIcon
			aria-hidden='true'
			className='size-3 shrink-0 text-status-danger'
		/>
	);
}

function ProviderMark({
	provider,
}: {
	provider:
		| WorkspaceShellModel['pullRequest']['checks'][number]['provider']
		| WorkspaceShellModel['pullRequest']['comments'][number]['provider'];
}) {
	const isGithubProvider =
		provider === 'github' || provider === 'github-actions';

	return (
		<span
			className={cn(
				'grid size-3.5 shrink-0 place-items-center rounded-full',
				isGithubProvider
					? 'bg-foreground text-background'
					: 'bg-muted text-muted-foreground',
			)}
		>
			{isGithubProvider ? (
				<GitBranchIcon aria-hidden='true' className='size-2.5' />
			) : (
				<CircleSlashIcon aria-hidden='true' className='size-2.5' />
			)}
		</span>
	);
}

function DockPanel({
	activeTab,
	isCollapsed,
	onTabChange,
	onToggleCollapsed,
	workspace,
}: {
	activeTab: DockTabId;
	isCollapsed: boolean;
	onTabChange: (tab: DockTabId) => void;
	onToggleCollapsed: () => void;
	workspace: WorkspaceShellModel;
}) {
	const DockToggleIcon = isCollapsed ? ChevronUpIcon : ChevronDownIcon;

	return (
		<Tabs
			className='h-full min-h-0 gap-0 overflow-hidden'
			onValueChange={(value) => onTabChange(value as DockTabId)}
			value={activeTab}
		>
			<div className='flex h-9 shrink-0 items-center justify-between gap-2 overflow-hidden border-border border-b px-2'>
				<Button
					aria-label={
						isCollapsed ? 'Expand terminal area' : 'Collapse terminal area'
					}
					className='size-6 shrink-0 text-muted-foreground hover:text-foreground'
					onClick={(event) => {
						event.stopPropagation();
						onToggleCollapsed();
					}}
					size='icon-xs'
					type='button'
					variant='ghost'
				>
					<DockToggleIcon aria-hidden='true' />
				</Button>
				<div className='no-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden'>
					<TabsList
						className='h-7 w-max min-w-full justify-start gap-1 rounded-none bg-transparent p-0'
						variant='line'
					>
						{workspace.dockTabs.map((tab) => {
							const DockTabIcon =
								tab.id === 'terminal'
									? SquareTerminalIcon
									: tab.id === 'run'
										? PlayIcon
										: WrenchIcon;

							return (
								<Fragment key={tab.id}>
									<TabsTrigger
										className='h-7 flex-none px-2 text-xs [&_svg]:size-3.5'
										value={tab.id}
									>
										<DockTabIcon aria-hidden='true' />
										{tab.label}
									</TabsTrigger>
									{tab.id === 'terminal' ? (
										<Button
											className='size-6 flex-none text-muted-foreground hover:text-foreground'
											key='new-terminal'
											size='icon-xs'
											type='button'
											variant='ghost'
										>
											<PlusIcon aria-hidden='true' />
											<span className='sr-only'>New terminal</span>
										</Button>
									) : null}
								</Fragment>
							);
						})}
					</TabsList>
				</div>
				<div className='flex shrink-0 items-center gap-1'>
					<DockPanelActions workspace={workspace} />
				</div>
			</div>
			<TabsContent className='min-h-0 overflow-hidden' value='setup'>
				<SetupDockContent script={workspace.scripts.setup} />
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='run'>
				<RunDockContent script={workspace.scripts.run} />
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='terminal'>
				<LogDockContent
					lines={[
						'$ zsh',
						'Interactive PTY rendering is intentionally deferred to PID-037.',
						'This placeholder preserves the terminal tab contract.',
					]}
					title='Terminal'
				/>
			</TabsContent>
		</Tabs>
	);
}

function DockPanelActions({ workspace }: { workspace: WorkspaceShellModel }) {
	const { run, setup } = workspace.scripts;
	const hasSetupScript = setup.status !== 'missing';
	const hasRunScript = run.status !== 'missing';

	if (!(hasSetupScript || hasRunScript)) {
		return (
			<Button size='xs' variant='outline'>
				<WrenchIcon data-icon='inline-start' />
				Setup Scripts
			</Button>
		);
	}

	if (hasSetupScript && setup.status === 'not-run') {
		return (
			<Button size='xs' variant='outline'>
				<WrenchIcon data-icon='inline-start' />
				Run setup script
			</Button>
		);
	}

	if (hasRunScript && run.status === 'running') {
		return (
			<>
				{typeof run.port === 'number' ? (
					<Button size='xs' variant='outline'>
						<ExternalLinkIcon data-icon='inline-start' />
						Open :{run.port}
					</Button>
				) : null}
				<Button size='xs' variant='outline'>
					<SquareIcon data-icon='inline-start' />
					Stop
				</Button>
			</>
		);
	}

	if (hasRunScript) {
		return (
			<Button size='xs' variant='outline'>
				<PlayIcon data-icon='inline-start' />
				Run
			</Button>
		);
	}

	return (
		<Button size='xs' variant='outline'>
			<WrenchIcon data-icon='inline-start' />
			Setup Scripts
		</Button>
	);
}

function SetupDockContent({ script }: { script: WorkspaceScriptSummary }) {
	if (script.status === 'missing') {
		return (
			<ScriptEmptyState
				actionLabel='Setup Scripts'
				detail='Add a setup script to install dependencies or prepare each workspace before the first agent turn.'
				title='No setup script configured'
			/>
		);
	}

	if (script.status === 'not-run') {
		return (
			<ScriptEmptyState
				actionLabel='Run setup script'
				detail='Run the configured setup script before starting the dev server or relying on generated dependencies.'
				title='Setup script has not run'
			/>
		);
	}

	return (
		<LogDockContent lines={script.lines} title={script.command ?? 'Setup'} />
	);
}

function RunDockContent({ script }: { script: WorkspaceScriptSummary }) {
	if (script.status === 'missing') {
		return (
			<ScriptEmptyState
				actionLabel='Setup Scripts'
				detail='Add a run script for the normal dev server, watcher, worker, or local app command.'
				title='No run script configured'
			/>
		);
	}

	if (script.lines.length === 0) {
		return (
			<ScriptEmptyState
				actionLabel='Run'
				detail='Start the run script to stream dev server output here.'
				title='Run script is stopped'
			/>
		);
	}

	return (
		<LogDockContent lines={script.lines} title={script.command ?? 'Run'} />
	);
}

function ScriptEmptyState({
	actionLabel,
	detail,
	title,
}: {
	actionLabel: string;
	detail: string;
	title: string;
}) {
	return (
		<div className='flex h-full items-center justify-center bg-terminal p-4 text-terminal-foreground'>
			<div className='flex max-w-72 flex-col items-center gap-2 text-center'>
				<div className='grid size-8 place-items-center rounded-md border border-terminal-border bg-terminal-muted/10'>
					<SquareTerminalIcon aria-hidden='true' className='size-4' />
				</div>
				<div className='font-medium text-xs'>{title}</div>
				<p className='text-terminal-muted text-xs leading-5'>{detail}</p>
				<Button className='mt-1' size='xs' variant='outline'>
					{actionLabel}
				</Button>
			</div>
		</div>
	);
}

function LogDockContent({ lines, title }: { lines: string[]; title: string }) {
	return (
		<ScrollArea className='h-full bg-terminal text-terminal-foreground'>
			<div className='flex flex-col gap-1.5 p-3 font-mono text-xs leading-5'>
				<div className='mb-1 flex items-center gap-2 text-terminal-muted'>
					<SquareTerminalIcon aria-hidden='true' className='size-3.5' />
					<span>{title}</span>
				</div>
				{lines.map((line, index) => (
					<div className='flex gap-3' key={`${line}-${index}`}>
						<span className='select-none text-terminal-muted'>
							{String(index + 1).padStart(2, '0')}
						</span>
						<code>{line}</code>
					</div>
				))}
			</div>
		</ScrollArea>
	);
}
