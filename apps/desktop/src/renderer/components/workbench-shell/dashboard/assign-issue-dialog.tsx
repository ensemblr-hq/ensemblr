import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { ProjectAvatar } from '@/renderer/components/workbench-shell/project-avatar';
import { RepositoryPicker } from '@/renderer/components/workbench-shell/repository-picker';
import {
	GithubLogo,
	LinearLogo,
} from '@/renderer/components/workbench-shell/source-provider-logo';
import { useCreateWorkspaceFromProject } from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-project-navigation-actions';
import { boardStatusLabel } from '@/renderer/lib/workbench/board-status-presentation';
import { workspaceSeedFromSourceItem } from '@/renderer/lib/workbench/workspace-source-mappers';
import type { WorkspaceBoardStatus } from '@/renderer/state/workspace';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { BoardIssueCard } from '@/renderer/types/workbench-shell';

/** The issue a drag left pending, plus the column it was dropped into. */
export interface AssignIssueRequest {
	issue: BoardIssueCard;
	targetStatus: WorkspaceBoardStatus;
}

/**
 * Confirmation dialog for turning a backlog issue into a workspace. A GitHub
 * issue already belongs to a repository, so that one is locked in; a Linear
 * issue is not repo-scoped and has to be pointed at one. Nothing is written back
 * to Linear or GitHub — the issue's own status is the user's to change (ADR
 * 0024).
 */
export function AssignIssueDialog({
	onAssigned,
	onOpenChange,
	onOpenWorkspace,
	projects,
	request,
}: {
	onAssigned: (workspaceId: string, targetStatus: WorkspaceBoardStatus) => void;
	onOpenChange: (open: boolean) => void;
	onOpenWorkspace: (projectId: string, workspaceId: string) => void;
	projects: ProjectShellModel[];
	request: AssignIssueRequest | null;
}) {
	const { t } = useTranslation();
	const { create, isCreating } = useCreateWorkspaceFromProject();
	const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);

	const lockedRepoId = request?.issue.projectId ?? null;
	const repoId = lockedRepoId ?? selectedRepoId;
	const project = projects.find((candidate) => candidate.id === repoId) ?? null;

	/**
	 * Creates the workspace from the issue, then hands its id back to the board.
	 * Stays on the board rather than routing into the new workspace — this is a
	 * triage gesture, usually one of several — so a toast names the column the
	 * card landed in and offers the navigation it stood in for. A failed create
	 * already toasts its own reason, and leaves the dialog open so the chosen
	 * repository is not lost to a retry.
	 */
	async function confirm() {
		if (!request || !project) {
			return;
		}
		const targetProjectId = project.id;
		const workspaceId = await create(
			project,
			workspaceSeedFromSourceItem(request.issue.item, 'create'),
			{ navigate: false },
		);
		if (!workspaceId) {
			return;
		}
		onAssigned(workspaceId, request.targetStatus);
		toast.success(
			t(
				'workbench:dashboard.assign-issue.created-in-column',
				'Workspace created from {{issue}} in {{status}}',
				{
					issue: request.issue.reference,
					status: boardStatusLabel(t, request.targetStatus),
				},
			),
			{
				action: {
					label: t('workbench:dashboard.assign-issue.open', 'Open'),
					onClick: () => onOpenWorkspace(targetProjectId, workspaceId),
				},
			},
		);
		onOpenChange(false);
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={request !== null}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>
						{t(
							'workbench:dashboard.assign-issue.title',
							'Create workspace from issue',
						)}
					</DialogTitle>
					<DialogDescription>
						{request
							? t(
									'workbench:dashboard.assign-issue.description',
									'A new workspace for {{issue}} lands in {{status}}. The issue itself is not changed in Linear or GitHub.',
									{
										issue: request.issue.reference,
										status: boardStatusLabel(t, request.targetStatus),
									},
								)
							: null}
					</DialogDescription>
				</DialogHeader>
				{request ? <AssignIssueSummary issue={request.issue} /> : null}
				<div className='flex items-center justify-between gap-2'>
					<span className='text-muted-foreground text-xs'>
						{t('workbench:dashboard.assign-issue.repository', 'Repository')}
					</span>
					{lockedRepoId ? (
						<span className='flex min-w-0 items-center gap-1.5 text-[0.8125rem]'>
							{project ? <ProjectAvatar project={project} size='sm' /> : null}
							<span className='max-w-40 truncate'>
								{project?.name ??
									t(
										'workbench:dashboard.assign-issue.repository-missing',
										'Repository not in Ensemblr',
									)}
							</span>
						</span>
					) : (
						<RepositoryPicker
							onSelect={setSelectedRepoId}
							projects={projects}
							selectedRepo={project}
						/>
					)}
				</div>
				{project || lockedRepoId ? null : (
					<p className='text-muted-foreground text-xs'>
						{t(
							'workbench:dashboard.assign-issue.repository-required',
							'Pick a repository to create the workspace in.',
						)}
					</p>
				)}
				<DialogFooter>
					<Button
						disabled={isCreating}
						onClick={() => onOpenChange(false)}
						variant='ghost'
					>
						{t('common:actions.cancel', 'Cancel')}
					</Button>
					<Button
						disabled={!project}
						onClick={() => void confirm()}
						pending={isCreating}
					>
						{t('workbench:dashboard.assign-issue.confirm', 'Create workspace')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Provider mark, reference, and title of the issue being turned into a workspace. */
function AssignIssueSummary({ issue }: { issue: BoardIssueCard }) {
	return (
		<div className='flex min-w-0 items-start gap-2 rounded-lg border border-foreground/10 px-3 py-2.5'>
			{issue.provider === 'linear' ? (
				<LinearLogo className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' />
			) : (
				<GithubLogo className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' />
			)}
			<span className='min-w-0 flex-1'>
				<span className='mr-1.5 font-mono text-muted-foreground text-xxs'>
					{issue.reference}
				</span>
				<span className='text-[0.8125rem]'>{issue.title}</span>
			</span>
		</div>
	);
}
