import {
	ArchiveIcon,
	CheckCircle2Icon,
	CheckIcon,
	CircleDashedIcon,
	CircleEllipsisIcon,
	CircleIcon,
	CircleSlashIcon,
	GitBranchIcon,
	GitMergeConflictIcon,
	GitPullRequestArrowIcon,
	GitPullRequestIcon,
	LoaderCircleIcon,
	type LucideIcon,
	MailIcon,
	PencilIcon,
	PinIcon,
} from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '@/renderer/components/ui/button';
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
} from '@/renderer/components/ui/context-menu';
import { SidebarMenuButton } from '@/renderer/components/ui/sidebar';
import { cn } from '@/renderer/lib/utils';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
	getPermissionBoundaryLabel,
} from '@/shared/permissions';

const archiveBoundary = classifyPermissionAction({
	action: 'workspace-archive-delete',
	mode: DEFAULT_PERMISSION_MODE,
});
const archiveBoundaryLabel = getPermissionBoundaryLabel(
	archiveBoundary.boundary,
);

export function WorkspaceSidebarItem({
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
	const sidebarState = getWorkspaceSidebarState(workspace);
	const WorkspaceIcon = sidebarState.icon;
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
						data-workspace-sidebar-state={sidebarState.kind}
						isActive={isActive}
						onClick={onSelect}
						tooltip={workspace.name}
					>
						<div className='mt-0.5 grid size-5 shrink-0 place-items-center'>
							<WorkspaceIcon
								aria-hidden='true'
								className={cn(
									'size-3.5',
									sidebarState.className,
									sidebarState.isSpinning && 'animate-spin',
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
						aria-label={`Archive workspace ${workspace.name}; ${archiveBoundaryLabel}`}
						className='absolute right-1.5 bottom-1.5 size-6 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 group-hover/workspace-sidebar-item:opacity-100'
						data-permission-boundary={archiveBoundary.boundary}
						onClick={(event) => {
							event.stopPropagation();
						}}
						onPointerDown={(event) => event.stopPropagation()}
						size='icon-xs'
						type='button'
						variant='ghost'
					>
						<ArchiveIcon aria-hidden='true' />
						<span className='sr-only'>{archiveBoundaryLabel}</span>
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

type WorkspaceSidebarState = {
	className: string;
	icon: LucideIcon;
	kind: WorkspaceSidebarStateKind;
	isSpinning?: boolean;
};

type WorkspaceSidebarStateKind =
	| 'branch'
	| 'pr-blocked'
	| 'pr-checking'
	| 'pr-open'
	| 'pr-ready'
	| 'pr-working'
	| 'workspace-blocked'
	| 'workspace-checking'
	| 'workspace-working';

function getWorkspaceSidebarState(
	workspace: WorkspaceShellModel,
): WorkspaceSidebarState {
	const pullRequestState = getPullRequestSidebarState(workspace);

	if (pullRequestState) {
		return pullRequestState;
	}

	if (workspace.checks.status === 'blocked') {
		return {
			className: 'text-status-danger',
			icon: GitMergeConflictIcon,
			kind: 'workspace-blocked',
		};
	}

	if (workspace.status === 'working') {
		return {
			className: 'text-muted-foreground',
			icon: LoaderCircleIcon,
			isSpinning: true,
			kind: 'workspace-working',
		};
	}

	if (workspace.checks.status === 'pending') {
		return {
			className: 'text-status-warning',
			icon: CircleEllipsisIcon,
			kind: 'workspace-checking',
		};
	}

	return {
		className: 'text-muted-foreground',
		icon: GitBranchIcon,
		kind: 'branch',
	};
}

function getPullRequestSidebarState(
	workspace: WorkspaceShellModel,
): WorkspaceSidebarState | null {
	if (typeof workspace.pullRequest.number !== 'number') {
		return null;
	}

	if (workspace.pullRequest.status === 'ready-to-merge') {
		return {
			className: 'text-status-ok',
			icon: GitPullRequestArrowIcon,
			kind: 'pr-ready',
		};
	}

	if (workspace.pullRequest.status === 'checking') {
		return {
			className: 'text-status-warning',
			icon: CircleEllipsisIcon,
			kind: 'pr-checking',
		};
	}

	if (workspace.pullRequest.status === 'blocked') {
		return {
			className: 'text-status-danger',
			icon: GitMergeConflictIcon,
			kind: 'pr-blocked',
		};
	}

	if (workspace.pullRequest.status === 'agent-working') {
		return {
			className: 'text-muted-foreground',
			icon: LoaderCircleIcon,
			isSpinning: true,
			kind: 'pr-working',
		};
	}

	return {
		className: 'text-muted-foreground',
		icon: GitPullRequestIcon,
		kind: 'pr-open',
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
				<SidebarContextMenuItem
					data-permission-boundary={archiveBoundary.boundary}
				>
					<ArchiveIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Archive</span>
					<ContextMenuShortcut>{archiveBoundaryLabel}</ContextMenuShortcut>
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
