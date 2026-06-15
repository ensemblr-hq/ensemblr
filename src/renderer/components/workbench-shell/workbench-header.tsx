import { PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { SidebarTrigger } from '@/renderer/components/ui/sidebar';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { OpenWorkspaceMenu } from './open-workspace-menu';
import { ProjectAvatar } from './project-avatar';
import { useWorkbenchLayout } from './shell-contexts';

/** Top toolbar showing project/workspace path, open-in menu and sidebar toggle. */
export function WorkbenchHeader({
	activeProject,
	activeWorkspace,
}: {
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
}) {
	const { state, actions } = useWorkbenchLayout();
	const isRightSidebarCollapsed = state.isRightSidebarCollapsed;
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
							? actions.expandRightSidebar
							: actions.collapseRightSidebar
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
