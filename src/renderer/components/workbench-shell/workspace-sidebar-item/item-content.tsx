import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { cn } from '@/renderer/lib/utils';
import type { getWorkspaceSidebarState } from '@/renderer/lib/workbench';
import type { WorkspaceDockActivityState } from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { WorkspaceDiffStats } from './diff-stats';
import { DockActivityDot } from './dock-activity-dot';
import { WorkspaceUnreadDot } from './unread-dot';

/**
 * The lifecycle run holding a workspace row non-interactive, or null when the
 * row is a workspace the user can actually open.
 */
export type WorkspacePendingLifecycle =
	| 'archiving'
	| 'creating'
	| 'deleting'
	| null;

/** What a sidebar row renders inside its button, live state already resolved. */
interface WorkspaceSidebarItemContentProps {
	dockActivityState: WorkspaceDockActivityState | null;
	hasDiffStats: boolean;
	isUnread: boolean;
	pendingLifecycle: WorkspacePendingLifecycle;
	sidebarState: ReturnType<typeof getWorkspaceSidebarState>;
	/** Chats in this workspace waiting to be read; zero renders no dot. */
	unreadCount: number;
	workspace: WorkspaceShellModel;
}

/**
 * The line under a workspace's name: which lifecycle run holds it, or the branch
 * it sits on when none does.
 * @param t - Translation function from `useTranslation`
 * @param pendingLifecycle - The run holding the row, when there is one
 * @param branchName - The workspace's branch, shown when the row is idle
 * @returns The subtitle to render
 */
function workspaceSubtitle(
	t: TFunction,
	pendingLifecycle: WorkspacePendingLifecycle,
	branchName: string,
): string {
	if (pendingLifecycle === 'archiving') {
		return t('workbench:workspace-item.archiving', 'Archiving…');
	}
	if (pendingLifecycle === 'deleting') {
		return t('workbench:workspace-item.deleting', 'Deleting…');
	}
	if (pendingLifecycle === 'creating') {
		return t('workbench:workspace-item.creating', 'Creating workspace…');
	}
	return branchName;
}

/**
 * Inner layout of a workspace sidebar row: the state icon, the workspace name
 * carrying its unread weight, diff stats and the dock-activity dot, and the
 * branch line underneath. Shared by the lifecycle-held and interactive rows so
 * the two differ only in the button that wraps them.
 *
 * A row any lifecycle run holds shows no diff stats: the subtitle underneath
 * already says what is happening to the workspace.
 */
export function WorkspaceSidebarItemContent({
	dockActivityState,
	hasDiffStats,
	isUnread,
	pendingLifecycle,
	sidebarState,
	unreadCount,
	workspace,
}: WorkspaceSidebarItemContentProps) {
	const { t } = useTranslation();
	const WorkspaceIcon = sidebarState.icon;
	const showsDiffStats = hasDiffStats && pendingLifecycle === null;

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
						{unreadCount > 0 ? (
							<WorkspaceUnreadDot count={unreadCount} />
						) : null}
						{showsDiffStats ? (
							<WorkspaceDiffStats workspace={workspace} />
						) : null}
						{dockActivityState ? (
							<DockActivityDot state={dockActivityState} />
						) : null}
					</div>
				</div>
				<div className='mt-1 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xxs'>
					<span className='truncate'>
						{workspaceSubtitle(t, pendingLifecycle, workspace.branchName)}
					</span>
				</div>
			</div>
		</>
	);
}
