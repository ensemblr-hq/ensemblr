import { Icon } from '@iconify/react';
import {
	ChevronDownIcon,
	CopyIcon,
	FileCodeIcon,
	FolderIcon,
	GitBranchIcon,
	PanelRightCloseIcon,
	PanelRightOpenIcon,
	SquareIcon,
	SquareTerminalIcon,
	WrenchIcon,
} from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { SidebarTrigger } from '@/renderer/components/ui/sidebar';
import { cn } from '@/renderer/lib/utils';
import type {
	ProjectShellModel,
	WorkspaceOpenTarget,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { ProjectAvatar } from './project-avatar';

/** Top toolbar showing project/workspace path, open-in menu and sidebar toggle. */
export function WorkbenchHeader({
	activeProject,
	activeWorkspace,
	isRightSidebarCollapsed,
	onRightSidebarCollapse,
	onRightSidebarOpen,
}: {
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
	isRightSidebarCollapsed: boolean;
	onRightSidebarCollapse: () => void;
	onRightSidebarOpen: () => void;
}) {
	const RightSidebarToggleIcon = isRightSidebarCollapsed
		? PanelRightOpenIcon
		: PanelRightCloseIcon;

	return (
		<header className='native-toolbar flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b px-3'>
			<div className='flex min-w-0 items-center gap-2'>
				<SidebarTrigger className='sidebar-collapsed-trigger' />
				<div className='flex min-w-0 items-center gap-2'>
					<ProjectAvatar project={activeProject} size='md' />
					<div className='min-w-0'>
						<div className='flex min-w-0 items-center gap-1.5 text-[0.8125rem]'>
							<span className='truncate font-medium'>{activeProject.name}</span>
							<span className='text-muted-foreground'>/</span>
							<span className='truncate font-medium'>
								{activeWorkspace.branchName}
							</span>
						</div>
						<p className='truncate text-muted-foreground text-xxs'>
							{activeWorkspace.pathLabel}
						</p>
					</div>
				</div>
			</div>
			<div className='flex shrink-0 items-center gap-2'>
				<OpenWorkspaceMenu workspace={activeWorkspace} />
				<Button
					onClick={
						isRightSidebarCollapsed
							? onRightSidebarOpen
							: onRightSidebarCollapse
					}
					size='icon-sm'
					variant='ghost'
				>
					<RightSidebarToggleIcon />
					<span className='sr-only'>
						{isRightSidebarCollapsed
							? 'Open review sidebar'
							: 'Collapse review sidebar'}
					</span>
				</Button>
			</div>
		</header>
	);
}

/** Split button + dropdown to open the workspace in installed apps. */
function OpenWorkspaceMenu({ workspace }: { workspace: WorkspaceShellModel }) {
	const openTargets = workspace.openTargets.filter(
		(target) => target.installed || target.kind === 'utility',
	);
	const primaryTarget =
		openTargets.find((target) => target.isPrimary) ??
		openTargets.find((target) => target.kind !== 'utility') ??
		openTargets[0];

	if (!primaryTarget) {
		return null;
	}

	return (
		<div className='flex h-7 shrink-0 overflow-hidden rounded-md border border-border bg-background'>
			<Button
				aria-label={`Open current workspace in ${primaryTarget.label}`}
				className='size-7 rounded-none border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
				size='icon-sm'
				type='button'
				variant='ghost'
			>
				<OpenTargetIcon className='size-4' target={primaryTarget} />
			</Button>
			<div className='my-1 w-px bg-border' />
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label='Open current workspace app options'
						className='size-7 rounded-none border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
						size='icon-sm'
						type='button'
						variant='ghost'
					>
						<ChevronDownIcon aria-hidden='true' className='size-3.5' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-64 p-1'>
					{openTargets.map((target) => (
						<DropdownMenuItem
							className='h-8 gap-2.5 px-2 text-[0.8125rem]'
							key={target.id}
						>
							<OpenTargetIcon className='size-4' target={target} />
							<span className='min-w-0 flex-1 truncate'>{target.label}</span>
							{target.shortcutLabel ? (
								<span className='shrink-0 text-muted-foreground text-xs'>
									{target.shortcutLabel}
								</span>
							) : null}
							<span className='w-3.5 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
								{target.numberShortcutLabel}
							</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/** Renders the appropriate icon for an open-in target (iconify or lucide). */
function OpenTargetIcon({
	className,
	target,
}: {
	className?: string;
	target: WorkspaceOpenTarget;
}) {
	const iconClassName = cn('shrink-0', className);

	if (target.iconName.startsWith('vscode-icons:')) {
		return (
			<Icon
				aria-hidden='true'
				className={iconClassName}
				icon={target.iconName}
			/>
		);
	}

	switch (target.iconName) {
		case 'lucide:copy':
			return <CopyIcon aria-hidden='true' className={iconClassName} />;
		case 'lucide:file-code':
			return <FileCodeIcon aria-hidden='true' className={iconClassName} />;
		case 'lucide:folder':
			return <FolderIcon aria-hidden='true' className={iconClassName} />;
		case 'lucide:github':
			return <GitBranchIcon aria-hidden='true' className={iconClassName} />;
		case 'lucide:square-terminal':
			return (
				<SquareTerminalIcon aria-hidden='true' className={iconClassName} />
			);
		case 'lucide:wrench':
			return <WrenchIcon aria-hidden='true' className={iconClassName} />;
		default:
			return <SquareIcon aria-hidden='true' className={iconClassName} />;
	}
}
