import {
	ArchiveIcon,
	CheckCircle2Icon,
	CheckIcon,
	CircleDashedIcon,
	CircleIcon,
	CircleSlashIcon,
	type LucideIcon,
	MailIcon,
	PencilIcon,
	PinIcon,
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
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
} from '@/shared/permissions';

const archiveBoundary = classifyPermissionAction({
	action: 'workspace-archive-delete',
	mode: DEFAULT_PERMISSION_MODE,
});

/** Right-click context menu for a workspace row (pin, status, archive). */
export function WorkspaceContextMenuContent({
	isPinned,
	onArchiveSelect,
	onPinToggle,
	onRenameSelect,
	workspace,
}: {
	isPinned: boolean;
	onArchiveSelect?: () => void;
	onPinToggle: () => void;
	onRenameSelect?: () => void;
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
			</ContextMenuGroup>
		</ContextMenuContent>
	);
}

/** Single workspace-status submenu row with optional check mark. */
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
