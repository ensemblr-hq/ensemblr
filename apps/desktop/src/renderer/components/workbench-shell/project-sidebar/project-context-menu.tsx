import {
	ArchiveRestoreIcon,
	GitBranchPlusIcon,
	PlusIcon,
	SettingsIcon,
	Trash2Icon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
	ContextMenuGroup,
	ContextMenuSeparator,
	ContextMenuShortcut,
} from '@/renderer/components/ui/context-menu';
import { SidebarContextMenuItem } from '@/renderer/components/workbench-shell/sidebar-context-menu-item';
import { WorkbenchContextMenuContent } from '@/renderer/components/workbench-shell/workbench-context-menu-content';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import { formatChord } from '@/shared/keymap';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
} from '@/shared/permissions';

const repositoryRemovalBoundary = classifyPermissionAction({
	action: 'repository-removal',
	mode: DEFAULT_PERMISSION_MODE,
});

/** Right-click context menu surfacing project workspace/settings actions. */
export function ProjectContextMenuContent({
	isCreatingWorkspace = false,
	onBrowseArchiveSelect,
	onCreateFromSourceSelect,
	onCreateWorkspaceSelect,
	onDeleteSelect,
	onRepositorySettingsSelect,
	project,
}: {
	isCreatingWorkspace?: boolean;
	onBrowseArchiveSelect?: () => void;
	onCreateFromSourceSelect?: () => void;
	onCreateWorkspaceSelect?: () => void;
	onDeleteSelect?: () => void;
	onRepositorySettingsSelect: () => void;
	project: ProjectShellModel;
}) {
	const { t } = useTranslation();
	const comingSoon = t('common:status.coming-soon', 'Coming soon');
	const createFromSourceWired = Boolean(onCreateFromSourceSelect);
	const browseArchiveWired = Boolean(onBrowseArchiveSelect);
	const deleteWired = Boolean(onDeleteSelect);

	return (
		<WorkbenchContextMenuContent
			aria-label={t(
				'workbench:repository-menu.aria-label',
				'{{repository}} repository actions',
				{ repository: project.name },
			)}
			className='min-w-56'
		>
			<ContextMenuGroup>
				<SidebarContextMenuItem
					disabled={!onCreateWorkspaceSelect || isCreatingWorkspace}
					onSelect={onCreateWorkspaceSelect}
				>
					<PlusIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>
						{t('workbench:repository-menu.new-workspace', 'New workspace')}
					</span>
					<ContextMenuShortcut>{formatChord(['mod'], 'N')}</ContextMenuShortcut>
				</SidebarContextMenuItem>
				<SidebarContextMenuItem
					data-action-placeholder='create-workspace-from-source'
					disabled={!createFromSourceWired}
					onSelect={onCreateFromSourceSelect}
					title={createFromSourceWired ? undefined : comingSoon}
				>
					<GitBranchPlusIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>
						{t('workbench:repository-menu.create-from', 'Create from…')}
					</span>
					<ContextMenuShortcut>
						{formatChord(['shift', 'mod'], 'N')}
					</ContextMenuShortcut>
				</SidebarContextMenuItem>
				<SidebarContextMenuItem
					data-action-placeholder='repository-browse-archive'
					disabled={!browseArchiveWired}
					onSelect={onBrowseArchiveSelect}
				>
					<ArchiveRestoreIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>
						{t(
							'workbench:repository-menu.workspace-archive',
							'Workspace archive',
						)}
					</span>
				</SidebarContextMenuItem>
				<SidebarContextMenuItem onSelect={onRepositorySettingsSelect}>
					<SettingsIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>
						{t('workbench:repository-menu.settings', 'Repository settings')}
					</span>
					<ContextMenuShortcut>{formatChord(['mod'], ',')}</ContextMenuShortcut>
				</SidebarContextMenuItem>
			</ContextMenuGroup>
			<ContextMenuSeparator />
			<ContextMenuGroup>
				<SidebarContextMenuItem
					data-action-placeholder='repository-delete-confirmation'
					data-permission-boundary={repositoryRemovalBoundary.boundary}
					disabled={!deleteWired}
					onSelect={onDeleteSelect}
					variant='destructive'
				>
					<Trash2Icon aria-hidden='true' />
					<span className='min-w-0 flex-1'>
						{t('workbench:repository-menu.delete', 'Delete repository…')}
					</span>
				</SidebarContextMenuItem>
			</ContextMenuGroup>
		</WorkbenchContextMenuContent>
	);
}
