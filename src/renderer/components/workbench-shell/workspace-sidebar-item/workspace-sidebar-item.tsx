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
import { WorkspaceSidebarItemContent } from './item-content';

const archiveBoundary = classifyPermissionAction({
	action: 'workspace-archive-delete',
	mode: DEFAULT_PERMISSION_MODE,
});

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
	const { dockActivityState, hasDiffStats, isUnread, sidebarState } =
		useWorkspaceSidebarRow({ isActive, workspace });
	const isPendingCreation = workspace.isPendingCreation === true;

	const buttonContent = (
		<WorkspaceSidebarItemContent
			dockActivityState={dockActivityState}
			hasDiffStats={hasDiffStats}
			isPendingCreation={isPendingCreation}
			isUnread={isUnread}
			sidebarState={sidebarState}
			workspace={workspace}
		/>
	);

	if (isPendingCreation) {
		return (
			<div className='group/workspace-sidebar-item relative min-w-0 opacity-80'>
				<SidebarMenuButton
					aria-disabled='true'
					aria-label={t(
						'workbench:workspace-item.creating-aria',
						'Workspace {{workspace}} is being created',
						{ workspace: workspace.name },
					)}
					className='h-auto min-h-12 cursor-not-allowed items-start gap-2 py-2'
					data-workspace-sidebar-state={sidebarState.kind}
					disabled
					isActive={false}
					tooltip={t(
						'workbench:workspace-item.creating-tooltip',
						'{{workspace}} is being created',
						{ workspace: workspace.name },
					)}
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
