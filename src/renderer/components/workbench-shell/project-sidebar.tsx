import {
	ChevronDownIcon,
	EyeOffIcon,
	FolderIcon,
	FolderPlusIcon,
	GitBranchPlusIcon,
	GlobeIcon,
	Link2Icon,
	type LucideIcon,
	PlusIcon,
	SettingsIcon,
	Trash2Icon,
} from 'lucide-react';
import type { ComponentProps } from 'react';

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import {
	SidebarGroupAction,
	SidebarGroupLabel,
} from '@/renderer/components/ui/sidebar';
import { cn } from '@/renderer/lib/utils';
import type {
	AddProjectActionId,
	AddProjectMenuModel,
	ProjectShellModel,
	RecentProject,
} from '@/renderer/types/workbench';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
	getPermissionBoundaryLabel,
} from '@/shared/permissions';

import { ProjectAvatar } from './project-avatar';

const repositoryRemovalBoundary = classifyPermissionAction({
	action: 'repository-removal',
	mode: DEFAULT_PERMISSION_MODE,
});
const repositoryRemovalBoundaryLabel = getPermissionBoundaryLabel(
	repositoryRemovalBoundary.boundary,
);

const COMING_SOON_REASON = 'Coming soon';

const addProjectActionIcons: Record<AddProjectActionId, LucideIcon> = {
	'open-github': GlobeIcon,
	'open-local': FolderIcon,
	'quick-start': FolderPlusIcon,
};

export function ProjectCreationMenu({
	model,
	onSelectAction,
	onSelectRecent,
}: {
	model: AddProjectMenuModel;
	onSelectAction?: (id: AddProjectActionId) => void;
	onSelectRecent?: (recent: RecentProject) => void;
}) {
	const actionsWired = Boolean(onSelectAction);
	const recentsWired = Boolean(onSelectRecent);
	const hasRecents = model.recents.length > 0;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarGroupAction
					aria-label='Open repository creation menu'
					className='top-2 size-6 [&>svg]:size-3.5'
					type='button'
				>
					<FolderPlusIcon aria-hidden='true' />
				</SidebarGroupAction>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align='end'
				className='w-80 p-1'
				data-menu-scope='project'
			>
				{model.actions.map((action) => {
					const Icon = addProjectActionIcons[action.id];
					const reason = resolveActionReason({
						action,
						wired: actionsWired,
					});
					const enabled = reason === null;

					return (
						<DropdownMenuItem
							className='min-h-9 flex-col items-stretch gap-0.5 px-2 py-1.5 text-sm'
							data-add-project-action={action.id}
							data-add-project-disabled-reason={reason ?? undefined}
							disabled={!enabled}
							key={action.id}
							onSelect={() => {
								if (enabled) {
									onSelectAction?.(action.id);
								}
							}}
							title={reason ?? undefined}
						>
							<span className='flex w-full min-w-0 items-center gap-2'>
								<Icon
									aria-hidden='true'
									className='size-4 shrink-0 text-muted-foreground'
								/>
								<span className='min-w-0 flex-1 truncate'>{action.label}</span>
							</span>
							{reason ? (
								<span className='pl-6 text-[0.6875rem] text-muted-foreground leading-4'>
									{reason}
								</span>
							) : null}
						</DropdownMenuItem>
					);
				})}
				{hasRecents ? (
					<>
						<DropdownMenuLabel className='px-2 pt-3 pb-1 text-muted-foreground text-xs'>
							Recents
						</DropdownMenuLabel>
						{model.recents.map((recent) => (
							<DropdownMenuItem
								className='h-8 gap-2 px-2 text-[0.8125rem]'
								data-recent-project-path={recent.path}
								disabled={!recentsWired}
								key={recent.path}
								onSelect={() => {
									if (recentsWired) {
										onSelectRecent?.(recent);
									}
								}}
								title={recentsWired ? undefined : COMING_SOON_REASON}
							>
								<FolderIcon
									aria-hidden='true'
									className='size-4 shrink-0 text-muted-foreground'
								/>
								<span className='min-w-0 flex-1 truncate'>{recent.path}</span>
							</DropdownMenuItem>
						))}
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function resolveActionReason({
	action,
	wired,
}: {
	action: AddProjectMenuModel['actions'][number];
	wired: boolean;
}): string | null {
	if (!action.enabled) {
		return action.unavailableReason ?? COMING_SOON_REASON;
	}
	return wired ? null : COMING_SOON_REASON;
}

export function ProjectSidebarHeader({
	isCollapsed,
	onCreateFromSourceSelect,
	onRepositorySettingsSelect,
	onToggle,
	project,
	workspaceCount,
}: {
	isCollapsed: boolean;
	onCreateFromSourceSelect?: () => void;
	onRepositorySettingsSelect: () => void;
	onToggle: () => void;
	project: ProjectShellModel;
	workspaceCount: number;
}) {
	const createFromSourceWired = Boolean(onCreateFromSourceSelect);
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<SidebarGroupLabel className='group/project-toggle relative h-7 justify-between pr-7 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'>
					<span className='flex min-w-0 items-center gap-2'>
						<button
							aria-expanded={!isCollapsed}
							aria-label={`${
								isCollapsed ? 'Expand' : 'Collapse'
							} repository ${project.name}`}
							className='relative size-4 shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring'
							onClick={(event) => {
								event.stopPropagation();
								onToggle();
							}}
							onPointerDownCapture={(event) => event.stopPropagation()}
							type='button'
						>
							<span className='pointer-events-none absolute inset-0'>
								<ProjectAvatar
									className='transition-opacity group-hover/project-toggle:opacity-0'
									project={project}
									size='sm'
								/>
							</span>
							<ChevronDownIcon
								aria-hidden='true'
								className={cn(
									'absolute inset-0 m-auto size-4 opacity-0 transition-[opacity,transform] group-hover/project-toggle:opacity-100',
									isCollapsed ? '-rotate-90' : 'rotate-0',
								)}
							/>
						</button>
						<span className='flex min-w-0 items-baseline gap-1.5'>
							<span className='truncate'>{project.name}</span>
							{isCollapsed ? (
								<span className='shrink-0 font-mono text-muted-foreground text-xs'>
									{workspaceCount}
								</span>
							) : null}
						</span>
					</span>
					<div className='absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5'>
						<ProjectHeaderActionButton
							aria-label={`Repository settings for ${project.name}`}
							className='hidden group-hover/project-toggle:flex'
							onClick={onRepositorySettingsSelect}
							onPointerDown={(event) => event.stopPropagation()}
						>
							<SettingsIcon aria-hidden='true' />
						</ProjectHeaderActionButton>
						{createFromSourceWired ? (
							<ProjectHeaderActionButton
								aria-label={`Create workspace from a source in ${project.name}`}
								className='hidden group-hover/project-toggle:flex'
								data-action-scope='project'
								onClick={onCreateFromSourceSelect}
								onPointerDown={(event) => event.stopPropagation()}
							>
								<Link2Icon aria-hidden='true' />
							</ProjectHeaderActionButton>
						) : null}
						<ProjectHeaderActionButton
							aria-label={`Create workspace in ${project.name}`}
							data-action-scope='workspace'
							onPointerDown={(event) => event.stopPropagation()}
						>
							<PlusIcon aria-hidden='true' />
						</ProjectHeaderActionButton>
					</div>
				</SidebarGroupLabel>
			</ContextMenuTrigger>
			<ProjectContextMenuContent
				onCreateFromSourceSelect={onCreateFromSourceSelect}
				onRepositorySettingsSelect={onRepositorySettingsSelect}
				project={project}
			/>
		</ContextMenu>
	);
}

function ProjectContextMenuContent({
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

function ProjectHeaderActionButton({
	className,
	...props
}: ComponentProps<'button'>) {
	return (
		<button
			className={cn(
				'flex aspect-square size-6 items-center justify-center rounded-md bg-transparent text-sidebar-foreground/70 outline-hidden ring-sidebar-ring transition-colors hover:text-sidebar-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
				className,
			)}
			type='button'
			{...props}
		/>
	);
}
