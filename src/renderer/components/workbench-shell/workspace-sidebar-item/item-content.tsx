import { useTranslation } from 'react-i18next';

import { cn } from '@/renderer/lib/utils';
import type { getWorkspaceSidebarState } from '@/renderer/lib/workbench';
import type { WorkspaceDockActivityState } from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { WorkspaceDiffStats } from './diff-stats';
import { DockActivityDot } from './dock-activity-dot';

/** What a sidebar row renders inside its button, live state already resolved. */
interface WorkspaceSidebarItemContentProps {
	dockActivityState: WorkspaceDockActivityState | null;
	hasDiffStats: boolean;
	isPendingCreation: boolean;
	isUnread: boolean;
	sidebarState: ReturnType<typeof getWorkspaceSidebarState>;
	workspace: WorkspaceShellModel;
}

/**
 * Inner layout of a workspace sidebar row: the state icon, the workspace name
 * carrying its unread weight, diff stats and the dock-activity dot, and the
 * branch line underneath. Shared by the pending-creation and interactive rows so
 * the two differ only in the button that wraps them.
 */
export function WorkspaceSidebarItemContent({
	dockActivityState,
	hasDiffStats,
	isPendingCreation,
	isUnread,
	sidebarState,
	workspace,
}: WorkspaceSidebarItemContentProps) {
	const { t } = useTranslation();
	const WorkspaceIcon = sidebarState.icon;

	return (
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
				<div className='flex min-w-0 items-center justify-between gap-2'>
					<span
						className={cn(
							'min-w-0 flex-1 truncate text-[0.8125rem]',
							isUnread ? 'font-semibold' : 'font-medium',
						)}
					>
						{workspace.name}
					</span>
					<div className='flex shrink-0 items-center gap-1.5'>
						{hasDiffStats ? <WorkspaceDiffStats workspace={workspace} /> : null}
						{dockActivityState ? (
							<DockActivityDot state={dockActivityState} />
						) : null}
					</div>
				</div>
				<div className='mt-1 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xxs'>
					<span className='truncate'>
						{isPendingCreation
							? t('workbench:workspace-item.creating', 'Creating workspace…')
							: workspace.branchName}
					</span>
				</div>
			</div>
		</>
	);
}
