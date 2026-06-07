import {
	EyeOffIcon,
	GitBranchPlusIcon,
	PlusIcon,
	SettingsIcon,
	Trash2Icon,
} from 'lucide-react';
import type { ComponentProps } from 'react';

import {
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
} from '@/renderer/components/ui/context-menu';
import { cn } from '@/renderer/lib/utils';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
	getPermissionBoundaryLabel,
} from '@/shared/permissions';

const COMING_SOON_REASON = 'Coming soon';

const repositoryRemovalBoundary = classifyPermissionAction({
	action: 'repository-removal',
	mode: DEFAULT_PERMISSION_MODE,
});
const repositoryRemovalBoundaryLabel = getPermissionBoundaryLabel(
	repositoryRemovalBoundary.boundary,
);

/** Right-click context menu surfacing project workspace/settings actions. */
export function ProjectContextMenuContent({
	onCreateFromSourceSelect,
	onRepositorySettingsSelect,
	project,
}: {
	onCreateFromSourceSelect?: () => void;
	onRepositorySettingsSelect: () => void;
	project: ProjectShellModel;
}) {
	const createFromSourceWired = Boolean(onCreateFromSourceSelect);

	return (
		<ContextMenuContent
			aria-label={`${project.name} repository actions`}
			className='w-56 bg-muted p-1'
		>
			<ContextMenuGroup>
				<ProjectContextMenuItem>
					<PlusIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>New workspace</span>
					<ContextMenuShortcut>⌘N</ContextMenuShortcut>
				</ProjectContextMenuItem>
				<ProjectContextMenuItem
					data-action-placeholder='create-workspace-from-source'
					disabled={!createFromSourceWired}
					onSelect={onCreateFromSourceSelect}
					title={createFromSourceWired ? undefined : COMING_SOON_REASON}
				>
					<GitBranchPlusIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Create from…</span>
					<ContextMenuShortcut>⌘⇧N</ContextMenuShortcut>
				</ProjectContextMenuItem>
				<ProjectContextMenuItem onSelect={onRepositorySettingsSelect}>
					<SettingsIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Repository settings</span>
					<ContextMenuShortcut>⌘,</ContextMenuShortcut>
				</ProjectContextMenuItem>
			</ContextMenuGroup>
			<ContextMenuSeparator />
			<ContextMenuGroup>
				<ProjectContextMenuItem
					data-action-placeholder='repository-hide-confirmation'
					data-permission-boundary={repositoryRemovalBoundary.boundary}
					disabled
				>
					<EyeOffIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Hide repository</span>
					<ContextMenuShortcut>
						{repositoryRemovalBoundaryLabel}
					</ContextMenuShortcut>
				</ProjectContextMenuItem>
				<ProjectContextMenuItem
					data-action-placeholder='repository-remove-confirmation'
					data-permission-boundary={repositoryRemovalBoundary.boundary}
					disabled
					variant='destructive'
				>
					<Trash2Icon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Remove repository</span>
					<ContextMenuShortcut>
						{repositoryRemovalBoundaryLabel}
					</ContextMenuShortcut>
				</ProjectContextMenuItem>
			</ContextMenuGroup>
		</ContextMenuContent>
	);
}

/** Styled wrapper around `ContextMenuItem` for the project context menu. */
function ProjectContextMenuItem({
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
