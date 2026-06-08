import {
	ChevronDownIcon,
	Link2Icon,
	PlusIcon,
	SettingsIcon,
} from 'lucide-react';
import type { ComponentProps } from 'react';

import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { SidebarGroupLabel } from '@/renderer/components/ui/sidebar';
import { cn } from '@/renderer/lib/utils';
import type { ProjectShellModel } from '@/renderer/types/workbench';

import { ProjectAvatar } from '../project-avatar';
import { ProjectContextMenuContent } from './project-context-menu';

/** Project group header with avatar, collapse toggle, and inline action buttons. */
export function ProjectSidebarHeader({
	isCollapsed,
	onArchiveSelect,
	onCreateFromSourceSelect,
	onCreateWorkspaceSelect,
	onRepositorySettingsSelect,
	onToggle,
	project,
	workspaceCount,
}: {
	isCollapsed: boolean;
	onArchiveSelect?: () => void;
	onCreateFromSourceSelect?: () => void;
	onCreateWorkspaceSelect?: () => void;
	onRepositorySettingsSelect: () => void;
	onToggle: () => void;
	project: ProjectShellModel;
	workspaceCount: number;
}) {
	const createFromSourceWired = Boolean(onCreateFromSourceSelect);
	const createWorkspaceWired = Boolean(onCreateWorkspaceSelect);
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
							disabled={!createWorkspaceWired}
							onClick={
								createWorkspaceWired ? onCreateWorkspaceSelect : undefined
							}
							onPointerDown={(event) => event.stopPropagation()}
						>
							<PlusIcon aria-hidden='true' />
						</ProjectHeaderActionButton>
					</div>
				</SidebarGroupLabel>
			</ContextMenuTrigger>
			<ProjectContextMenuContent
				onArchiveSelect={onArchiveSelect}
				onCreateFromSourceSelect={onCreateFromSourceSelect}
				onRepositorySettingsSelect={onRepositorySettingsSelect}
				project={project}
			/>
		</ContextMenu>
	);
}

/** Small square button rendered in the project group header on hover. */
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
