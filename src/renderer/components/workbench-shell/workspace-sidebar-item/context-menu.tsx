import {
	ArchiveIcon,
	CheckIcon,
	type LucideIcon,
	MailIcon,
	PencilIcon,
	PinIcon,
	Trash2Icon,
} from 'lucide-react';

import {
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from '@/renderer/components/ui/context-menu';
import { SidebarContextMenuItem } from '@/renderer/components/workbench-shell/sidebar-context-menu-item';
import { BOARD_STATUS_PRESENTATION } from '@/renderer/components/workbench-shell/workspace-status/board-status-presentation';
import {
	BOARD_STATUS_ORDER,
	useWorkspaceBoardActions,
	useWorkspaceBoardStatus,
	useWorkspaceUnread,
} from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
} from '@/shared/permissions';

const archiveBoundary = classifyPermissionAction({
	action: 'workspace-archive-delete',
	mode: DEFAULT_PERMISSION_MODE,
});

/** Right-click context menu for a workspace row (unread, pin, status, archive, delete). */
export function WorkspaceContextMenuContent({
	isPinned,
	onArchiveSelect,
	onDeleteSelect,
	onPinToggle,
	onRenameSelect,
	workspace,
}: {
	isPinned: boolean;
	onArchiveSelect?: () => void;
	onDeleteSelect?: () => void;
	onPinToggle: () => void;
	onRenameSelect?: () => void;
	workspace: WorkspaceShellModel;
}) {
	const currentStatus = useWorkspaceBoardStatus(workspace.id);
	const isUnread = useWorkspaceUnread(workspace.id);
	const { setWorkspaceBoardStatus, toggleWorkspaceUnread } =
		useWorkspaceBoardActions();
	const currentStatusPresentation = BOARD_STATUS_PRESENTATION[currentStatus];
	const CurrentStatusIcon = currentStatusPresentation.icon;

	return (
		<ContextMenuContent
			aria-label={`${workspace.name} workspace actions`}
			className='w-56 bg-muted p-1'
		>
			<ContextMenuGroup>
				<SidebarContextMenuItem
					onSelect={() => toggleWorkspaceUnread(workspace.id)}
				>
					<MailIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>
						{isUnread ? 'Mark as read' : 'Mark as unread'}
					</span>
					<ContextMenuShortcut>R</ContextMenuShortcut>
				</SidebarContextMenuItem>
				<SidebarContextMenuItem onSelect={onPinToggle}>
					<PinIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>{isPinned ? 'Unpin' : 'Pin'}</span>
					<ContextMenuShortcut>P</ContextMenuShortcut>
				</SidebarContextMenuItem>
				<ContextMenuSub>
					<ContextMenuSubTrigger className='h-8 gap-2 px-2 text-[0.8125rem]'>
						<CurrentStatusIcon
							aria-hidden='true'
							className={currentStatusPresentation.iconClassName}
						/>
						<span className='min-w-0 flex-1'>Set status</span>
					</ContextMenuSubTrigger>
					<ContextMenuSubContent className='w-48 bg-muted p-1'>
						<ContextMenuGroup>
							{BOARD_STATUS_ORDER.map((status) => {
								const presentation = BOARD_STATUS_PRESENTATION[status];
								return (
									<WorkspaceStatusMenuItem
										icon={presentation.icon}
										iconClassName={presentation.iconClassName}
										isSelected={currentStatus === status}
										key={status}
										label={presentation.label}
										onSelect={() =>
											setWorkspaceBoardStatus(workspace.id, status)
										}
									/>
								);
							})}
						</ContextMenuGroup>
					</ContextMenuSubContent>
				</ContextMenuSub>
				<SidebarContextMenuItem
					disabled={!onRenameSelect}
					onSelect={onRenameSelect}
				>
					<PencilIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Rename</span>
				</SidebarContextMenuItem>
			</ContextMenuGroup>
			<ContextMenuSeparator />
			<ContextMenuGroup>
				<SidebarContextMenuItem
					data-permission-boundary={archiveBoundary.boundary}
					disabled={!onArchiveSelect}
					onSelect={onArchiveSelect}
				>
					<ArchiveIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Archive</span>
				</SidebarContextMenuItem>
				<SidebarContextMenuItem
					data-permission-boundary={archiveBoundary.boundary}
					disabled={!onDeleteSelect}
					onSelect={onDeleteSelect}
					variant='destructive'
				>
					<Trash2Icon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Delete…</span>
				</SidebarContextMenuItem>
			</ContextMenuGroup>
		</ContextMenuContent>
	);
}

/** Single workspace-status submenu row with optional check mark. */
function WorkspaceStatusMenuItem({
	icon: StatusIcon,
	iconClassName,
	isSelected,
	label,
	onSelect,
}: {
	icon: LucideIcon;
	iconClassName: string;
	isSelected: boolean;
	label: string;
	onSelect: () => void;
}) {
	return (
		<SidebarContextMenuItem onSelect={onSelect}>
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
