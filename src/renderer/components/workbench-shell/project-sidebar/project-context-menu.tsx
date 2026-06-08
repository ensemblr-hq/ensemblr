import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	GitBranchPlusIcon,
	PlusIcon,
	SettingsIcon,
	Trash2Icon,
} from 'lucide-react';

import {
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuSeparator,
	ContextMenuShortcut,
} from '@/renderer/components/ui/context-menu';
import { SidebarContextMenuItem } from '@/renderer/components/workbench-shell/sidebar-context-menu-item';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
} from '@/shared/permissions';

const COMING_SOON_REASON = 'Coming soon';

const repositoryRemovalBoundary = classifyPermissionAction({
	action: 'repository-removal',
	mode: DEFAULT_PERMISSION_MODE,
});

/** Right-click context menu surfacing project workspace/settings actions. */
export function ProjectContextMenuContent({
	onArchiveSelect,
	onBrowseArchiveSelect,
	onCreateFromSourceSelect,
	onDeleteSelect,
	onRepositorySettingsSelect,
	project,
}: {
	onArchiveSelect?: () => void;
	onBrowseArchiveSelect?: () => void;
	onCreateFromSourceSelect?: () => void;
	onDeleteSelect?: () => void;
	onRepositorySettingsSelect: () => void;
	project: ProjectShellModel;
}) {
	const createFromSourceWired = Boolean(onCreateFromSourceSelect);
	const archiveWired = Boolean(onArchiveSelect);
	const browseArchiveWired = Boolean(onBrowseArchiveSelect);
	const deleteWired = Boolean(onDeleteSelect);

	return (
		<ContextMenuContent
			aria-label={`${project.name} repository actions`}
			className='w-56 bg-muted p-1'
		>
			<ContextMenuGroup>
				<SidebarContextMenuItem>
					<PlusIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>New workspace</span>
					<ContextMenuShortcut>⌘N</ContextMenuShortcut>
				</SidebarContextMenuItem>
				<SidebarContextMenuItem
					data-action-placeholder='create-workspace-from-source'
					disabled={!createFromSourceWired}
					onSelect={onCreateFromSourceSelect}
					title={createFromSourceWired ? undefined : COMING_SOON_REASON}
				>
					<GitBranchPlusIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Create from…</span>
					<ContextMenuShortcut>⌘⇧N</ContextMenuShortcut>
				</SidebarContextMenuItem>
				<SidebarContextMenuItem
					data-action-placeholder='repository-browse-archive'
					disabled={!browseArchiveWired}
					onSelect={onBrowseArchiveSelect}
				>
					<ArchiveRestoreIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Workspace archive</span>
				</SidebarContextMenuItem>
				<SidebarContextMenuItem onSelect={onRepositorySettingsSelect}>
					<SettingsIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Repository settings</span>
					<ContextMenuShortcut>⌘,</ContextMenuShortcut>
				</SidebarContextMenuItem>
			</ContextMenuGroup>
			<ContextMenuSeparator />
			<ContextMenuGroup>
				<SidebarContextMenuItem
					data-action-placeholder='repository-archive-confirmation'
					data-permission-boundary={repositoryRemovalBoundary.boundary}
					disabled={!archiveWired}
					onSelect={onArchiveSelect}
				>
					<ArchiveIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Archive repository</span>
				</SidebarContextMenuItem>
				<SidebarContextMenuItem
					data-action-placeholder='repository-delete-confirmation'
					data-permission-boundary={repositoryRemovalBoundary.boundary}
					disabled={!deleteWired}
					onSelect={onDeleteSelect}
					variant='destructive'
				>
					<Trash2Icon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Delete repository…</span>
				</SidebarContextMenuItem>
			</ContextMenuGroup>
		</ContextMenuContent>
	);
}
