import {
	ActivityIcon,
	CheckCircle2Icon,
	ChevronDownIcon,
	CircleDashedIcon,
	CogIcon,
	ExternalLinkIcon,
	EyeIcon,
	FileCodeIcon,
	FileSearchIcon,
	FolderIcon,
	GitBranchIcon,
	GitMergeIcon,
	GitPullRequestCreateIcon,
	GitPullRequestDraftIcon,
	HistoryIcon,
	LayoutDashboardIcon,
	ListTreeIcon,
	LoaderCircleIcon,
	MessageSquareIcon,
	MoreVerticalIcon,
	PanelRightCloseIcon,
	PanelRightOpenIcon,
	PlayIcon,
	PlusIcon,
	RefreshCwIcon,
	SquareIcon,
	SquareTerminalIcon,
	WrenchIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';

import { SetupDiagnosticsCompact } from '@/components/setup-diagnostics';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
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
import type {
	ComposerShellState,
	DockTabId,
	ProjectShellModel,
	ReviewFileSummary,
	ReviewPanelTab,
	SessionTabModel,
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
	onDashboardSelect: () => void;
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

const healthTone: Record<WorkbenchHealth['state'], 'muted' | 'ok' | 'warning'> =
	{
		online: 'ok',
		pending: 'muted',
		unavailable: 'warning',
	};

const statusTone: Record<
	WorkspaceShellModel['status'],
	'danger' | 'info' | 'muted' | 'ok' | 'warning'
> = {
	idle: 'muted',
	'needs-setup': 'warning',
	review: 'info',
	working: 'ok',
};

const fileStatusLabel: Record<ReviewFileSummary['status'], string> = {
	added: 'A',
	deleted: 'D',
	modified: 'M',
	renamed: 'R',
	untracked: 'U',
};

export function WorkbenchShell({
	activeProject,
	activeReviewTab,
	activeSession,
	activeView,
	activeWorkspace,
	composer,
	dockTabId,
	health,
	isSetupRefreshing,
	onDashboardSelect,
	onDockTabChange,
	onHistorySelect,
	onReviewTabChange,
	onSessionTabChange,
	onSettingsSelect,
	onSetupRetry,
	onWorkspaceSelect,
	projects,
	setupDiagnostics,
	setupError,
}: WorkbenchShellProps) {
	const rightSidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
	const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false);
	const collapseRightSidebar = () => {
		rightSidebarPanelRef.current?.collapse();
		setIsRightSidebarCollapsed(true);
	};
	const expandRightSidebar = () => {
		rightSidebarPanelRef.current?.expand();
		setIsRightSidebarCollapsed(false);
	};

	return (
		<TooltipProvider>
			<SidebarProvider>
				<Sidebar className='border-sidebar-border' collapsible='offcanvas'>
					<SidebarHeader className='h-12 border-sidebar-border border-b p-0'>
						<div className='macos-traffic-light-spacer flex h-full shrink-0 items-center justify-end px-2'>
							<SidebarTrigger />
						</div>
					</SidebarHeader>

					<SidebarContent>
						<SidebarGroup className='py-1'>
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
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>

						<SidebarSeparator />

						{projects.map((project) => (
							<SidebarGroup className='gap-1 py-1.5' key={project.id}>
								<SidebarGroupLabel className='h-7 justify-between pr-7'>
									<span className='truncate'>{project.name}</span>
								</SidebarGroupLabel>
								<SidebarGroupAction
									aria-label={`Create workspace in ${project.name}`}
									type='button'
								>
									<PlusIcon aria-hidden='true' />
								</SidebarGroupAction>
								<SidebarGroupContent>
									<SidebarMenu className='gap-1'>
										{project.workspaces.map((workspace) => (
											<WorkspaceSidebarItem
												isActive={
													activeProject.id === project.id &&
													activeWorkspace.id === workspace.id
												}
												key={workspace.id}
												onSelect={() =>
													onWorkspaceSelect(project.id, workspace.id)
												}
												workspace={workspace}
											/>
										))}
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						))}
					</SidebarContent>

					<SidebarFooter className='border-sidebar-border border-t p-2'>
						<div className='flex flex-col gap-1 rounded-md px-2 py-1.5'>
							<StatusBadge tone={healthTone[health.state]}>
								{health.label}
							</StatusBadge>
							<p className='line-clamp-2 text-[0.6875rem] text-muted-foreground leading-4'>
								{health.detail}
							</p>
						</div>
						<div className='flex items-center justify-end gap-2 px-2'>
							<Button onClick={onSettingsSelect} size='icon-sm' variant='ghost'>
								<CogIcon />
								<span className='sr-only'>Open app settings</span>
							</Button>
						</div>
					</SidebarFooter>
					<SidebarRail />
				</Sidebar>

				<SidebarInset className='flex h-svh min-h-svh overflow-hidden bg-background text-foreground'>
					<ResizablePanelGroup
						className='min-h-0 flex-1'
						orientation='horizontal'
					>
						<ResizablePanel defaultSize='66%' minSize='32rem'>
							<div className='flex h-full min-w-0 flex-col overflow-hidden'>
								<WorkbenchHeader
									activeProject={activeProject}
									activeWorkspace={activeWorkspace}
									isRightSidebarCollapsed={isRightSidebarCollapsed}
									onRightSidebarCollapse={collapseRightSidebar}
									onRightSidebarOpen={expandRightSidebar}
								/>
								<section className='flex min-h-0 flex-1 flex-col overflow-hidden'>
									<SessionTabs
										activeSession={activeSession}
										onSessionTabChange={onSessionTabChange}
										sessions={activeWorkspace.sessions}
									/>
									<ScrollArea className='min-h-0 flex-1'>
										<WorkspaceTimeline
											activeSession={activeSession}
											activeView={activeView}
											composer={composer}
											setupDiagnostics={setupDiagnostics}
											workspace={activeWorkspace}
										/>
									</ScrollArea>
									<ComposerPanel composer={composer} />
								</section>
							</div>
						</ResizablePanel>
						<ResizableHandle className='hidden lg:flex' />
						<ResizablePanel
							className='hidden min-w-0 lg:flex'
							collapsedSize='0rem'
							collapsible
							defaultSize='34%'
							maxSize='68%'
							minSize='22rem'
							onResize={(size) => {
								setIsRightSidebarCollapsed(size.asPercentage <= 1);
							}}
							panelRef={rightSidebarPanelRef}
						>
							<aside className='flex h-full w-full min-w-0 flex-col bg-card'>
								<RightSidebarHeader activeWorkspace={activeWorkspace} />
								<ReviewPanel
									activeTab={activeReviewTab}
									onTabChange={onReviewTabChange}
									workspace={activeWorkspace}
								/>
								<DockPanel
									activeTab={dockTabId}
									isSetupRefreshing={isSetupRefreshing}
									onSetupRetry={onSetupRetry}
									onTabChange={onDockTabChange}
									setupDiagnostics={setupDiagnostics}
									setupError={setupError}
									workspace={activeWorkspace}
								/>
							</aside>
						</ResizablePanel>
					</ResizablePanelGroup>
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}

function WorkspaceSidebarItem({
	isActive,
	onSelect,
	workspace,
}: {
	isActive: boolean;
	onSelect: () => void;
	workspace: WorkspaceShellModel;
}) {
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				className='h-auto min-h-12 items-start gap-2 py-2'
				isActive={isActive}
				onClick={onSelect}
				tooltip={workspace.name}
			>
				<div className='mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm bg-sidebar-accent'>
					<GitBranchIcon
						aria-hidden='true'
						className={cn(
							'size-3',
							workspace.status === 'working'
								? 'text-status-ok'
								: 'text-muted-foreground',
						)}
					/>
				</div>
				<div className='min-w-0 flex-1'>
					<div className='flex min-w-0 items-center justify-between gap-2'>
						<span className='truncate font-medium text-[0.8125rem]'>
							{workspace.name}
						</span>
						<StatusBadge tone={statusTone[workspace.status]}>
							{workspace.changeSummary.files}
						</StatusBadge>
					</div>
					<div className='mt-1 flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-muted-foreground'>
						<span className='truncate'>{workspace.branchName}</span>
					</div>
					<div className='mt-1 flex items-center gap-1.5 font-mono text-[0.6875rem]'>
						<span className='text-status-ok'>
							+{workspace.changeSummary.additions}
						</span>
						<span className='text-status-danger'>
							-{workspace.changeSummary.deletions}
						</span>
					</div>
				</div>
			</SidebarMenuButton>
		</SidebarMenuItem>
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
					<div className='grid size-6 shrink-0 place-items-center rounded-sm bg-muted'>
						<FolderIcon aria-hidden='true' className='size-3.5' />
					</div>
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

function RightSidebarHeader({
	activeWorkspace,
}: {
	activeWorkspace: WorkspaceShellModel;
}) {
	const pullRequest = activeWorkspace.pullRequest;
	const isIdle = pullRequest.status === 'idle';
	const isMergeReady = pullRequest.status === 'ready-to-merge';
	const StatusIcon = getPullRequestStatusIcon(pullRequest.status);

	return (
		<header
			className={cn(
				'native-toolbar flex h-12 w-full shrink-0 items-center gap-3 border-border border-b px-3',
				isMergeReady && 'border-status-ok/30 bg-status-ok/10',
				pullRequest.status === 'blocked' &&
					'border-status-danger/30 bg-status-danger/10',
				pullRequest.status === 'checking' &&
					'border-status-warning/30 bg-status-warning/10',
			)}
		>
			<div className='flex min-w-0 flex-1 items-center gap-2'>
				{isIdle ? null : (
					<div
						className={cn(
							'grid size-6 shrink-0 place-items-center rounded-sm border border-border bg-pane text-muted-foreground',
							isMergeReady && 'border-status-ok/30 text-status-ok',
							pullRequest.status === 'blocked' &&
								'border-status-danger/30 text-status-danger',
							pullRequest.status === 'checking' &&
								'border-status-warning/30 text-status-warning',
						)}
					>
						<StatusIcon
							aria-hidden='true'
							className={cn(
								'size-3.5',
								pullRequest.status === 'checking' && 'animate-spin',
							)}
						/>
					</div>
				)}
				{isIdle ? null : (
					<div className='min-w-0'>
						<p className='truncate font-medium text-xs'>{pullRequest.label}</p>
						<p className='truncate text-[0.6875rem] text-muted-foreground'>
							{pullRequest.detail}
						</p>
					</div>
				)}
			</div>
			<div className='ml-auto flex shrink-0 items-center justify-end'>
				<PullRequestHeaderAction pullRequest={pullRequest} />
			</div>
		</header>
	);
}

function PullRequestHeaderAction({
	pullRequest,
}: {
	pullRequest: WorkspaceShellModel['pullRequest'];
}) {
	if (pullRequest.status === 'ready-to-merge') {
		return (
			<Button
				className='bg-status-ok text-primary-foreground hover:bg-status-ok/90'
				size='sm'
			>
				<GitMergeIcon data-icon='inline-start' />
				Merge
			</Button>
		);
	}

	if (pullRequest.status === 'checking') {
		return (
			<Button disabled size='sm' variant='outline'>
				<LoaderCircleIcon className='animate-spin' data-icon='inline-start' />
				Checking
			</Button>
		);
	}

	if (pullRequest.status === 'agent-working') {
		return (
			<Button disabled size='sm' variant='outline'>
				<FileSearchIcon data-icon='inline-start' />
				Working
			</Button>
		);
	}

	if (pullRequest.status === 'blocked') {
		return (
			<Button disabled size='sm' variant='destructive'>
				Blocked
			</Button>
		);
	}

	return <CreatePullRequestMenu />;
}

function CreatePullRequestMenu() {
	return (
		<div className='flex shrink-0 items-center' data-slot='button-group'>
			<Button className='rounded-r-none' size='sm' variant='outline'>
				<GitPullRequestCreateIcon data-icon='inline-start' />
				Create PR
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label='Open create pull request options'
						className='rounded-l-none border-l-0'
						size='icon-sm'
						variant='outline'
					>
						<ChevronDownIcon aria-hidden='true' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-56'>
					<DropdownMenuGroup>
						<DropdownMenuItem>
							<GitPullRequestDraftIcon aria-hidden='true' />
							Create draft PR
						</DropdownMenuItem>
						<DropdownMenuItem>
							<ExternalLinkIcon aria-hidden='true' />
							Create PR manually
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function getPullRequestStatusIcon(
	status: WorkspaceShellModel['pullRequest']['status'],
) {
	if (status === 'ready-to-merge') {
		return GitMergeIcon;
	}

	if (status === 'checking') {
		return LoaderCircleIcon;
	}

	if (status === 'agent-working') {
		return FileSearchIcon;
	}

	return CircleDashedIcon;
}

function SessionTabs({
	activeSession,
	onSessionTabChange,
	sessions,
}: {
	activeSession: SessionTabModel;
	onSessionTabChange: (sessionId: string) => void;
	sessions: SessionTabModel[];
}) {
	return (
		<div className='flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b bg-background px-3'>
			<div className='flex min-w-0 flex-1 gap-1 overflow-x-auto'>
				{sessions.map((session) => {
					const isActive = session.id === activeSession.id;

					return (
						<button
							className={cn(
								'flex h-12 min-w-28 flex-none items-center gap-2 border-transparent border-b-2 px-3 text-xs transition-colors',
								isActive
									? 'border-primary bg-muted/50 text-foreground'
									: 'text-muted-foreground hover:text-foreground',
							)}
							key={session.id}
							onClick={() => onSessionTabChange(session.id)}
							type='button'
						>
							<MessageSquareIcon
								aria-hidden='true'
								className='size-3.5 shrink-0'
							/>
							<span className='truncate'>{session.label}</span>
						</button>
					);
				})}
			</div>
			<Button size='icon-sm' variant='ghost'>
				<PlusIcon />
				<span className='sr-only'>New chat tab</span>
			</Button>
		</div>
	);
}

function WorkspaceTimeline({
	activeSession,
	activeView,
	composer,
	setupDiagnostics,
	workspace,
}: {
	activeSession: SessionTabModel;
	activeView: WorkbenchShellProps['activeView'];
	composer: ComposerShellState;
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	workspace: WorkspaceShellModel;
}) {
	const title =
		activeView === 'history'
			? 'Workspace history'
			: activeView === 'dashboard'
				? 'Workspace dashboard'
				: activeView === 'settings'
					? 'Settings preview'
					: activeSession.label;

	return (
		<div className='mx-auto flex w-full max-w-4xl flex-col gap-4 p-4'>
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

			<section className='flex flex-col gap-3'>
				<TimelineItem
					detail={workspace.sourceSummary}
					label={title}
					status={composer.disabled ? 'active' : 'completed'}
				/>
				<TimelineItem
					detail='Renderer shell has been replaced with project/workspace navigation, chat tabs, review panel tabs, and a dock region.'
					label='Shell scaffold'
					status='completed'
				/>
				<TimelineItem
					detail='TanStack Router owns path and search state for workspace, chat, review tab, and dock tab selection.'
					label='Navigation model'
					status='completed'
				/>
				<TimelineItem
					detail='TanStack Query wraps preload IPC snapshots for health and setup diagnostics. Live repository, Pi, Git, and terminal services remain future tickets.'
					label='Backend query boundary'
					status='active'
				/>
			</section>
		</div>
	);
}

function TimelineItem({
	detail,
	label,
	status,
}: {
	detail: string;
	label: string;
	status: 'active' | 'completed';
}) {
	return (
		<div className='flex gap-3'>
			<div className='mt-1 grid size-5 shrink-0 place-items-center rounded-full border border-border bg-pane'>
				{status === 'completed' ? (
					<CheckCircle2Icon
						aria-hidden='true'
						className='size-3 text-status-ok'
					/>
				) : (
					<ActivityIcon aria-hidden='true' className='size-3 text-accent' />
				)}
			</div>
			<div className='min-w-0 flex-1 rounded-md border border-border bg-pane px-3 py-2'>
				<p className='font-medium text-sm'>{label}</p>
				<p className='mt-1 text-muted-foreground text-xs leading-5'>{detail}</p>
			</div>
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

	return (
		<Tabs
			className='review-panel min-h-0 flex-1 gap-0 border-border border-b'
			onValueChange={(value) => onTabChange(value as ReviewPanelTab)}
			value={activeTab}
		>
			<div className='flex h-12 shrink-0 items-center justify-between gap-2 overflow-hidden border-border border-b px-2'>
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
				<div className='flex shrink-0 items-center gap-0.5'>
					<Button
						className='text-accent-strong hover:text-foreground'
						size='xs'
						variant='ghost'
					>
						<EyeIcon data-icon='inline-start' />
						<span className='review-panel-action-label'>Review</span>
					</Button>
					<Button size='icon-sm' variant='ghost'>
						<ListTreeIcon />
						<span className='sr-only'>Toggle file tree</span>
					</Button>
					<Button size='icon-sm' variant='ghost'>
						<MoreVerticalIcon />
						<span className='sr-only'>Open review menu</span>
					</Button>
				</div>
			</div>
			<TabsContent className='min-h-0 overflow-hidden' value='files'>
				<ReviewFileList files={workspace.reviewFiles} mode='files' />
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='changes'>
				<ReviewFileList files={workspace.reviewFiles} mode='changes' />
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='checks'>
				<ChecksPanel workspace={workspace} />
			</TabsContent>
		</Tabs>
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
	mode,
}: {
	files: ReviewFileSummary[];
	mode: 'changes' | 'files';
}) {
	const visibleFiles =
		mode === 'changes'
			? files.filter((file) => file.additions || file.deletions)
			: files;

	return (
		<ScrollArea className='h-full'>
			<div className='flex flex-col gap-1 p-3'>
				{visibleFiles.length ? (
					visibleFiles.map((file) => (
						<div
							className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted'
							key={file.id}
						>
							<div className='flex min-w-0 items-center gap-2 text-xs'>
								<FileCodeIcon
									aria-hidden='true'
									className='size-3.5 shrink-0 text-muted-foreground'
								/>
								<span className='min-w-0 truncate'>{file.path}</span>
							</div>
							<div className='flex min-w-0 max-w-28 shrink-0 items-center justify-end gap-1 font-mono text-[0.6875rem] tabular-nums'>
								<span className='truncate text-muted-foreground'>
									{fileStatusLabel[file.status]}
								</span>
								<span className='shrink-0 text-status-ok'>
									+{file.additions}
								</span>
								<span className='shrink-0 text-status-danger'>
									-{file.deletions}
								</span>
							</div>
						</div>
					))
				) : (
					<div className='rounded-md border border-border bg-pane px-3 py-4 text-muted-foreground text-xs leading-5'>
						File state will appear here when the Git workspace service is wired.
					</div>
				)}
			</div>
		</ScrollArea>
	);
}

function ChecksPanel({ workspace }: { workspace: WorkspaceShellModel }) {
	const progressValue =
		workspace.checks.status === 'ready'
			? 100
			: workspace.checks.status === 'pending'
				? 48
				: 12;

	return (
		<ScrollArea className='h-full'>
			<div className='flex flex-col gap-3 p-3'>
				<section className='rounded-md border border-border bg-pane p-3'>
					<div className='flex items-start justify-between gap-3'>
						<div className='min-w-0'>
							<p className='font-medium text-sm'>{workspace.checks.label}</p>
							<p className='mt-1 text-muted-foreground text-xs leading-5'>
								{workspace.checks.detail}
							</p>
						</div>
						<StatusBadge
							tone={
								workspace.checks.status === 'ready'
									? 'ok'
									: workspace.checks.status === 'blocked'
										? 'danger'
										: 'warning'
							}
						>
							{workspace.checks.status}
						</StatusBadge>
					</div>
					<Progress className='mt-3' value={progressValue} />
				</section>
				<section className='flex flex-col gap-2'>
					<CheckRow label='Git status' value='fixture only' />
					<CheckRow label='Pull request' value='not created' />
					<CheckRow label='Comments' value='0 open' />
					<CheckRow label='Todos' value='0 unresolved' />
				</section>
			</div>
		</ScrollArea>
	);
}

function CheckRow({ label, value }: { label: string; value: string }) {
	return (
		<div className='flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted'>
			<span className='text-muted-foreground text-xs'>{label}</span>
			<span className='font-medium text-xs'>{value}</span>
		</div>
	);
}

function DockPanel({
	activeTab,
	isSetupRefreshing,
	onSetupRetry,
	onTabChange,
	setupDiagnostics,
	setupError,
	workspace,
}: {
	activeTab: DockTabId;
	isSetupRefreshing: boolean;
	onSetupRetry: () => void;
	onTabChange: (tab: DockTabId) => void;
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	setupError: string | null;
	workspace: WorkspaceShellModel;
}) {
	return (
		<Tabs
			className='h-72 shrink-0 gap-0'
			onValueChange={(value) => onTabChange(value as DockTabId)}
			value={activeTab}
		>
			<div className='flex h-9 shrink-0 items-center justify-between gap-2 overflow-hidden border-border border-b px-2'>
				<div className='no-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden'>
					<TabsList
						className='h-7 w-max min-w-full justify-start rounded-none bg-transparent p-0'
						variant='line'
					>
						{workspace.dockTabs.map((tab) => (
							<TabsTrigger
								className='h-7 flex-none px-2 text-xs [&_svg]:size-3.5'
								key={tab.id}
								value={tab.id}
							>
								{tab.id === 'terminal' ? (
									<SquareTerminalIcon aria-hidden='true' />
								) : tab.id === 'run' ? (
									<PlayIcon aria-hidden='true' />
								) : (
									<WrenchIcon aria-hidden='true' />
								)}
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>
				</div>
				<div className='flex shrink-0 items-center gap-1'>
					<Button size='icon-xs' variant='ghost'>
						<PlusIcon />
						<span className='sr-only'>New terminal</span>
					</Button>
					<Button onClick={onSetupRetry} size='xs' variant='outline'>
						<RefreshCwIcon
							className={cn(isSetupRefreshing && 'animate-spin')}
							data-icon='inline-start'
						/>
						Rerun
					</Button>
					<Button size='xs' variant='outline'>
						<SquareIcon data-icon='inline-start' />
						Stop
					</Button>
				</div>
			</div>
			<TabsContent className='min-h-0 overflow-hidden' value='setup'>
				<SetupDockContent
					isSetupRefreshing={isSetupRefreshing}
					setupDiagnostics={setupDiagnostics}
					setupError={setupError}
				/>
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='run'>
				<LogDockContent
					lines={[
						'$ piductor run',
						'Run script lifecycle will be wired by PID-038.',
						'Output stays in this dock while chat and review remain visible.',
					]}
					title='Run output'
				/>
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

function SetupDockContent({
	isSetupRefreshing,
	setupDiagnostics,
	setupError,
}: {
	isSetupRefreshing: boolean;
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	setupError: string | null;
}) {
	if (setupError) {
		return (
			<LogDockContent
				lines={[
					'! setup diagnostics unavailable',
					setupError,
					'Use the retry control after the preload bridge is available.',
				]}
				title='Setup error'
			/>
		);
	}

	if (!setupDiagnostics) {
		return (
			<LogDockContent
				lines={[
					isSetupRefreshing ? 'Checking setup diagnostics...' : 'Setup pending',
					'Waiting for the main process diagnostics snapshot.',
				]}
				title='Setup'
			/>
		);
	}

	const blockingChecks = setupDiagnostics.checks.filter(
		(check) =>
			check.blocking &&
			check.status !== 'success' &&
			check.status !== 'warning',
	);

	return (
		<ScrollArea className='h-full bg-terminal text-terminal-foreground'>
			<div className='flex flex-col gap-3 p-3'>
				<SetupDiagnosticsCompact snapshot={setupDiagnostics} />
				<div className='flex flex-col gap-2 font-mono text-xs leading-5'>
					<div className='text-terminal-muted'>
						$ piductor setup diagnostics
					</div>
					<div>
						status:{' '}
						<span className='text-status-warning'>
							{setupDiagnostics.status}
						</span>
					</div>
					<div>required: {setupDiagnostics.requiredCount}</div>
					<div>blocked: {setupDiagnostics.blockedCount}</div>
				</div>
				{blockingChecks.length ? (
					<div className='flex flex-col gap-2'>
						{blockingChecks.slice(0, 4).map((check) => (
							<div
								className='rounded-md border border-terminal-border bg-terminal-muted/10 px-2 py-1.5'
								key={check.id}
							>
								<p className='font-medium text-xs'>{check.title}</p>
								<p className='mt-1 text-terminal-muted text-xs leading-5'>
									{check.detail}
								</p>
								{check.remediationActions.length ? (
									<div className='mt-2 flex flex-wrap gap-1.5'>
										{check.remediationActions.map((action) => (
											<StatusBadge
												className='bg-terminal-muted/20 text-terminal-foreground'
												key={action.id}
												tone='muted'
											>
												{action.label}
											</StatusBadge>
										))}
									</div>
								) : null}
							</div>
						))}
					</div>
				) : (
					<div className='rounded-md border border-terminal-border bg-terminal-muted/10 px-2 py-1.5 text-xs'>
						No blocking setup checks.
					</div>
				)}
			</div>
		</ScrollArea>
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
