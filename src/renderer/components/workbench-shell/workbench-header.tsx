import { PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BranchPicker } from '@/renderer/components/git/branch-picker';
import { Button } from '@/renderer/components/ui/button';
import { SidebarTrigger } from '@/renderer/components/ui/sidebar';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { useWorkspaceTargetBranch } from '@/renderer/hooks/workbench-shell/use-workspace-target-branch';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { OpenWorkspaceMenu } from './open-workspace-menu';
import { ProjectAvatar } from './project-avatar';
import { RightSidebarHeaderInlineActions } from './right-sidebar-header/right-sidebar-header';
import { useWorkbenchLayout } from './shell-contexts';

/** Top toolbar showing project/workspace path, open-in menu and sidebar toggle. */
export function WorkbenchHeader({
	activeProject,
	activeWorkspace,
}: {
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	const { state, actions } = useWorkbenchLayout();
	const isRightSidebarCollapsed = state.isRightSidebarCollapsed;
	const RightSidebarToggleIcon = isRightSidebarCollapsed
		? PanelRightOpenIcon
		: PanelRightCloseIcon;

	return (
		<header className='native-toolbar flex shrink-0 items-center justify-between gap-3 border-border border-b px-3'>
			<div className='flex min-w-0 flex-1 items-center gap-2'>
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
							<WorkspaceTargetBranch
								activeWorkspace={activeWorkspace}
								repositoryId={activeProject.id}
							/>
						</div>
						<p className='truncate text-muted-foreground text-xxs'>
							{activeWorkspace.pathLabel}
						</p>
					</div>
				</div>
			</div>
			<div className='flex shrink-0 items-center gap-2'>
				<OpenWorkspaceMenu workspace={activeWorkspace} />
				{isRightSidebarCollapsed ? (
					<RightSidebarHeaderInlineActions activeWorkspace={activeWorkspace} />
				) : null}
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
							? t('workbench:header.review-sidebar.open', 'Open review sidebar')
							: t(
									'workbench:header.review-sidebar.collapse',
									'Collapse review sidebar',
								)}
					</span>
				</Button>
			</div>
		</header>
	);
}

/**
 * Header control retargeting the branch this workspace reviews and opens pull
 * requests against. Changing it re-scopes the diff, conflicts, and PR base; the
 * worktree keeps the fork point it was created from.
 */
function WorkspaceTargetBranch({
	activeWorkspace,
	repositoryId,
}: {
	activeWorkspace: WorkspaceShellModel;
	repositoryId: string;
}) {
	const { t } = useTranslation();
	const { isPending, retargetBranch, retargetRef } = useWorkspaceTargetBranch(
		activeWorkspace.id,
	);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className='shrink-0'>
					<BranchPicker
						className='h-6 max-w-40'
						disabled={isPending}
						onSelect={retargetBranch}
						onSelectCustomRef={retargetRef}
						placeholder={t(
							'workbench:header.target-branch.placeholder',
							'Set target branch',
						)}
						repositoryId={repositoryId}
						searchPlaceholder={t(
							'workbench:header.target-branch.search',
							'Search or enter a branch…',
						)}
						value={activeWorkspace.landingSummary?.branchSource.baseBranch}
					/>
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{t(
					'workbench:header.target-branch.tooltip',
					'Target branch — what this workspace diffs and opens pull requests against.',
				)}
			</TooltipContent>
		</Tooltip>
	);
}
