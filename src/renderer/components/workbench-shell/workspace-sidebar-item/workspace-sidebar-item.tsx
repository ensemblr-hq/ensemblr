import { ArchiveIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { SidebarMenuButton } from '@/renderer/components/ui/sidebar';
import { useNavigation } from '@/renderer/components/workbench-shell/contexts';
import { cn } from '@/renderer/lib/utils';
import { getWorkspaceSidebarState } from '@/renderer/lib/workbench';
import type {
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
	getPermissionBoundaryLabel,
} from '@/shared/permissions';

import { WorkspaceContextMenuContent } from './context-menu';
import { WorkspaceDiffStats } from './diff-stats';

const archiveBoundary = classifyPermissionAction({
	action: 'workspace-archive-delete',
	mode: DEFAULT_PERMISSION_MODE,
});
const archiveBoundaryLabel = getPermissionBoundaryLabel(
	archiveBoundary.boundary,
);

/** Sidebar row for a single workspace, with state icon, diff stats and context menu. */
export function WorkspaceSidebarItem({
	isActive,
	isPinned,
	onPinToggle,
	onSelect,
	routeSearch,
	workspace,
}: {
	isActive: boolean;
	isPinned: boolean;
	onPinToggle: () => void;
	onSelect: () => void;
	routeSearch: WorkbenchRouteSearch;
	workspace: WorkspaceShellModel;
}) {
	const { renderWorkspaceLink } = useNavigation();
	const sidebarState = getWorkspaceSidebarState(workspace);
	const WorkspaceIcon = sidebarState.icon;
	const hasDiffStats =
		workspace.changeSummary.additions > 0 ||
		workspace.changeSummary.deletions > 0;
	const buttonContent = (
		<>
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
					{hasDiffStats ? <WorkspaceDiffStats workspace={workspace} /> : null}
				</div>
				<div className='mt-1 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xxs'>
					<span className='truncate'>{workspace.branchName}</span>
				</div>
			</div>
		</>
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div className='group/workspace-sidebar-item relative min-w-0'>
					<SidebarMenuButton
						aria-label={`Open workspace ${workspace.name}`}
						asChild={Boolean(renderWorkspaceLink)}
						className='h-auto min-h-12 items-start gap-2 py-2'
						data-workspace-sidebar-state={sidebarState.kind}
						isActive={isActive}
						onClick={renderWorkspaceLink ? undefined : onSelect}
						tooltip={workspace.name}
					>
						{renderWorkspaceLink
							? renderWorkspaceLink(
									{
										search: routeSearch,
										workspace,
									},
									buttonContent,
								)
							: buttonContent}
					</SidebarMenuButton>
					<Button
						aria-label={`Archive workspace ${workspace.name}; ${archiveBoundaryLabel}`}
						className='absolute right-1.5 bottom-1.5 size-6 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 group-hover/workspace-sidebar-item:opacity-100'
						data-action-placeholder='workspace-archive-confirmation'
						data-permission-boundary={archiveBoundary.boundary}
						disabled
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
