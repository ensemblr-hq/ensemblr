import {
	ChevronDownIcon,
	CogIcon,
	FolderIcon,
	FolderPlusIcon,
	GlobeIcon,
	LinkIcon,
	PlusIcon,
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
import type { ProjectShellModel } from '@/renderer/types/workbench';
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

const recentProjectPaths = [
	'~/Projects/Boundary/haartz-next',
	'~/Projects/Boundary/weho-pride',
	'~/Projects/Personal/viteflow',
	'~/Projects/Personal/nixfiles',
	'~/Projects/Freelance/plated',
	'~/Projects/Personal/insane-forms',
	'~/Projects/Boundary/fullsteam-portal',
];

export function ProjectCreationMenu() {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarGroupAction
					aria-label='Open project creation menu'
					className='top-2 size-6 [&>svg]:size-3.5'
					type='button'
				>
					<FolderPlusIcon aria-hidden='true' />
				</SidebarGroupAction>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-80 p-1'>
				<DropdownMenuItem className='h-9 gap-2 px-2 text-sm'>
					<FolderIcon
						aria-hidden='true'
						className='size-4 shrink-0 text-muted-foreground'
					/>
					<span className='min-w-0 flex-1 truncate'>Open project</span>
				</DropdownMenuItem>
				<DropdownMenuItem className='h-9 gap-2 px-2 text-sm'>
					<GlobeIcon
						aria-hidden='true'
						className='size-4 shrink-0 text-muted-foreground'
					/>
					<span className='min-w-0 flex-1 truncate'>Open GitHub project</span>
				</DropdownMenuItem>
				<DropdownMenuItem className='h-9 gap-2 px-2 text-sm'>
					<FolderPlusIcon
						aria-hidden='true'
						className='size-4 shrink-0 text-muted-foreground'
					/>
					<span className='min-w-0 flex-1 truncate'>Quick start</span>
				</DropdownMenuItem>
				<DropdownMenuLabel className='px-2 pt-3 pb-1 text-muted-foreground text-xs'>
					Recents
				</DropdownMenuLabel>
				{recentProjectPaths.map((path) => (
					<DropdownMenuItem
						className='h-8 gap-2 px-2 text-[0.8125rem]'
						key={path}
					>
						<FolderIcon
							aria-hidden='true'
							className='size-4 shrink-0 text-muted-foreground'
						/>
						<span className='min-w-0 flex-1 truncate'>{path}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function ProjectSidebarHeader({
	isCollapsed,
	onRepositorySettingsSelect,
	onToggle,
	project,
	workspaceCount,
}: {
	isCollapsed: boolean;
	onRepositorySettingsSelect: () => void;
	onToggle: () => void;
	project: ProjectShellModel;
	workspaceCount: number;
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<SidebarGroupLabel className='group/project-toggle h-7 justify-between pr-7 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'>
					<span className='flex min-w-0 items-center gap-2'>
						<button
							aria-expanded={!isCollapsed}
							aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} project ${
								project.name
							}`}
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
				</SidebarGroupLabel>
			</ContextMenuTrigger>
			<ProjectContextMenuContent
				onRepositorySettingsSelect={onRepositorySettingsSelect}
				project={project}
			/>
		</ContextMenu>
	);
}

function ProjectContextMenuContent({
	onRepositorySettingsSelect,
	project,
}: {
	onRepositorySettingsSelect: () => void;
	project: ProjectShellModel;
}) {
	return (
		<ContextMenuContent
			aria-label={`${project.name} project actions`}
			className='w-56 bg-muted p-1'
		>
			<ContextMenuGroup>
				<ProjectContextMenuItem>
					<PlusIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>New workspace</span>
					<ContextMenuShortcut>⌘N</ContextMenuShortcut>
				</ProjectContextMenuItem>
				<ProjectContextMenuItem>
					<LinkIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Create from...</span>
					<ContextMenuShortcut>⌘⇧N</ContextMenuShortcut>
				</ProjectContextMenuItem>
				<ProjectContextMenuItem onSelect={onRepositorySettingsSelect}>
					<CogIcon aria-hidden='true' />
					<span className='min-w-0 flex-1'>Repository settings</span>
					<ContextMenuShortcut>⌘,</ContextMenuShortcut>
				</ProjectContextMenuItem>
			</ContextMenuGroup>
			<ContextMenuSeparator />
			<ContextMenuGroup>
				<ProjectContextMenuItem
					data-permission-boundary={repositoryRemovalBoundary.boundary}
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
