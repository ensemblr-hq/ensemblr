import type { TFunction } from 'i18next';
import { ArchiveIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { SidebarMenuButton } from '@/renderer/components/ui/sidebar';
import { useNavigation } from '@/renderer/components/workbench-shell/shell-contexts';
import { useWorkspaceSidebarRow } from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-sidebar-row';
import { usePermissionBoundaryLabel } from '@/renderer/hooks/workbench-shell/use-permission-boundary-label';
import type {
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
} from '@/shared/permissions';
import { WorkspaceContextMenuContent } from './context-menu';
import type { WorkspacePendingLifecycle } from './item-content';
import { WorkspaceSidebarItemContent } from './item-content';

const archiveBoundary = classifyPermissionAction({
	action: 'workspace-archive-delete',
	mode: DEFAULT_PERMISSION_MODE,
});

/**
 * Which lifecycle run, if any, is holding a row non-interactive. An archive
 * outranks a pending creation because only one of them can ever be true, and the
 * archive is the state the user just asked for.
 * @param workspace - The workspace the row stands for
 * @param isArchiving - Whether this workspace's archive is running
 * @returns The run holding the row, or null when the row is interactive
 */
function resolvePendingLifecycle(
	workspace: WorkspaceShellModel,
	isArchiving: boolean,
): WorkspacePendingLifecycle {
	if (isArchiving) {
		return 'archiving';
	}
	return workspace.isPendingCreation === true ? 'creating' : null;
}

/**
 * The aria label and tooltip a row carries while a lifecycle run holds it. Both
 * name the workspace, because a screen reader hitting a disabled row otherwise
 * hears only that it cannot be opened.
 * @param t - Translation function from `useTranslation`
 * @param pendingLifecycle - Which run is holding the row
 * @param workspaceName - Name of the workspace the row stands for
 * @returns The label to announce and the tooltip to show
 */
function pendingLifecycleLabels(
	t: TFunction,
	pendingLifecycle: WorkspacePendingLifecycle,
	workspaceName: string,
): { ariaLabel: string; tooltip: string } {
	if (pendingLifecycle === 'archiving') {
		return {
			ariaLabel: t(
				'workbench:workspace-item.archiving-aria',
				'Workspace {{workspace}} is being archived',
				{ workspace: workspaceName },
			),
			tooltip: t(
				'workbench:workspace-item.archiving-tooltip',
				'{{workspace}} is being archived',
				{ workspace: workspaceName },
			),
		};
	}

	return {
		ariaLabel: t(
			'workbench:workspace-item.creating-aria',
			'Workspace {{workspace}} is being created',
			{ workspace: workspaceName },
		),
		tooltip: t(
			'workbench:workspace-item.creating-tooltip',
			'{{workspace}} is being created',
			{ workspace: workspaceName },
		),
	};
}

/** Sidebar row for a single workspace, with state icon, diff stats and context menu. */
export function WorkspaceSidebarItem({
	isActive,
	isPinned,
	onArchiveSelect,
	onDeleteSelect,
	onPinToggle,
	onRenameSelect,
	onSelect,
	routeSearch,
	workspace,
}: {
	isActive: boolean;
	isPinned: boolean;
	onArchiveSelect?: () => void;
	onDeleteSelect?: () => void;
	onPinToggle: () => void;
	onRenameSelect?: () => void;
	onSelect: () => void;
	routeSearch: WorkbenchRouteSearch;
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	const archiveBoundaryLabel = usePermissionBoundaryLabel(
		archiveBoundary.boundary,
	);
	const { renderWorkspaceLink } = useNavigation();
	const {
		dockActivityState,
		hasDiffStats,
		isArchiving,
		isUnread,
		sidebarState,
		unreadCount,
	} = useWorkspaceSidebarRow({ isActive, workspace });
	const pendingLifecycle = resolvePendingLifecycle(workspace, isArchiving);

	const buttonContent = (
		<WorkspaceSidebarItemContent
			dockActivityState={dockActivityState}
			hasDiffStats={hasDiffStats}
			isUnread={isUnread}
			pendingLifecycle={pendingLifecycle}
			sidebarState={sidebarState}
			unreadCount={unreadCount}
			workspace={workspace}
		/>
	);

	// A row held by a lifecycle run renders outside the context menu on purpose:
	// the workspace has no worktree to open, and every action the menu offers —
	// archive most of all — would fire a second run against it.
	if (pendingLifecycle) {
		const { ariaLabel, tooltip } = pendingLifecycleLabels(
			t,
			pendingLifecycle,
			workspace.name,
		);

		return (
			<div className='group/workspace-sidebar-item relative min-w-0 opacity-80'>
				<SidebarMenuButton
					aria-disabled='true'
					aria-label={ariaLabel}
					className='h-auto min-h-12 cursor-not-allowed items-start gap-2 py-2'
					data-workspace-sidebar-state={sidebarState.kind}
					disabled
					isActive={false}
					tooltip={tooltip}
				>
					{buttonContent}
				</SidebarMenuButton>
			</div>
		);
	}

	const workspaceButtonLabel = dockActivityState
		? t(
				'workbench:workspace-item.open-busy-aria',
				'Open workspace {{workspace}}; dock activity running',
				{ workspace: workspace.name },
			)
		: t('workbench:workspace-item.open-aria', 'Open workspace {{workspace}}', {
				workspace: workspace.name,
			});

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div className='group/workspace-sidebar-item relative min-w-0'>
					<SidebarMenuButton
						aria-label={workspaceButtonLabel}
						asChild={Boolean(renderWorkspaceLink)}
						className='h-auto min-h-12 items-start gap-2 py-2'
						data-workspace-sidebar-state={sidebarState.kind}
						isActive={isActive}
						onClick={renderWorkspaceLink ? undefined : onSelect}
						tooltip={workspace.name}
					>
						{renderWorkspaceLink
							? renderWorkspaceLink(
									{ search: routeSearch, workspace },
									buttonContent,
								)
							: buttonContent}
					</SidebarMenuButton>
					{onArchiveSelect ? (
						<Button
							aria-label={t(
								'workbench:workspace-item.archive-aria',
								'Archive workspace {{workspace}}; {{boundary}}',
								{ boundary: archiveBoundaryLabel, workspace: workspace.name },
							)}
							className='absolute right-1.5 bottom-1.5 size-6 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 group-hover/workspace-sidebar-item:opacity-100'
							data-permission-boundary={archiveBoundary.boundary}
							onClick={(event) => {
								event.stopPropagation();
								onArchiveSelect();
							}}
							onPointerDown={(event) => event.stopPropagation()}
							size='icon-xs'
							type='button'
							variant='ghost'
						>
							<ArchiveIcon aria-hidden='true' />
							<span className='sr-only'>{archiveBoundaryLabel}</span>
						</Button>
					) : null}
				</div>
			</ContextMenuTrigger>
			<WorkspaceContextMenuContent
				isPinned={isPinned}
				onArchiveSelect={onArchiveSelect}
				onDeleteSelect={onDeleteSelect}
				onPinToggle={onPinToggle}
				onRenameSelect={onRenameSelect}
				workspace={workspace}
			/>
		</ContextMenu>
	);
}
