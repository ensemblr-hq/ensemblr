import { useCallback, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
	archiveRepository,
	isEnsemblrApiAvailable,
} from '@/renderer/api/ensemblr-queries';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { CleanupToggle } from '@/renderer/components/workbench-shell/cleanup-toggle';
import { LifecycleDialogActions } from '@/renderer/components/workbench-shell/lifecycle-dialog-actions';
import { LifecycleSummary } from '@/renderer/components/workbench-shell/lifecycle-summary';
import { useLifecycleDialogAction } from '@/renderer/hooks/workbench-shell/use-lifecycle-dialog-action';
import { projectSummaryRows } from '@/renderer/lib/workbench/lifecycle-summary-rows';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { ArchiveRepositoryDiagnostic } from '@/shared/ipc/contracts/repository';

/**
 * Lifecycle archive dialog for a repository. Cascades to each child workspace;
 * branch cleanup is opt-in. Worktree folders are preserved so ENS-038/ENS-060
 * subscribers can still inspect them.
 */
export function ArchiveRepositoryDialog({
	onArchived,
	onOpenChange,
	open,
	project,
}: {
	onArchived: (projectId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	project: ProjectShellModel | null;
}) {
	return (
		// Never open without a project: callers that hold `open` and `project` in
		// separate state drop the project the moment it is archived, and an open
		// dialog with nothing to render is an empty shell whose overlay still eats
		// every click, leaving the app unusable with no way to dismiss it.
		<Dialog onOpenChange={onOpenChange} open={open && project !== null}>
			<DialogContent className='sm:max-w-md'>
				{project ? (
					<ArchiveRepositoryDialogForm
						key={`${project.id}:${open ? 'open' : 'closed'}`}
						onArchived={onArchived}
						onOpenChange={onOpenChange}
						project={project}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/**
 * Wraps an unexpected archive-repository rejection as the diagnostic the dialog
 * already renders — a denied permission gate throws rather than reporting.
 * @param message - The thrown error's message
 * @returns A diagnostic carrying it
 */
function archiveRepositoryFailure(
	message: string,
): ArchiveRepositoryDiagnostic {
	return { code: 'repository-update-failed', message, severity: 'error' };
}

/** Inner archive form for a repository; owns the archiving state and opt-in branch cleanup. */
function ArchiveRepositoryDialogForm({
	onArchived,
	onOpenChange,
	project,
}: {
	onArchived: (projectId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	project: ProjectShellModel;
}) {
	const { t } = useTranslation();
	const [branchCleanup, setBranchCleanup] = useState(false);
	const workspaceCount = project.workspaces.length;
	const hasWorkspaces = workspaceCount > 0;
	const { diagnostics, isBusy, start } = useLifecycleDialogAction({
		failure: archiveRepositoryFailure,
		onOpenChange,
		onSucceeded: () => onArchived(project.id),
		operationKey: `archive-repository:${project.id}`,
		run: () =>
			archiveRepository({
				branchCleanup: branchCleanup && hasWorkspaces,
				repositoryId: project.id,
			}),
	});

	const canArchive = !isBusy && isEnsemblrApiAvailable();

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t('workbench:archive-repository.title', 'Archive repository?')}
				</DialogTitle>
				<DialogDescription className='text-xs'>
					<Trans
						components={[
							<span className='font-mono' key='context-dir' />,
							<span className='font-mono' key='archived-contexts-dir' />,
						]}
						defaults="Marks the repository and {{workspaces}} as archived. Each workspace's <0>.context/</0> handoff files are preserved under <1>archived-contexts/</1>. Worktrees and the repository folder stay on disk."
						i18nKey='workbench:archive-repository.description'
						values={{
							workspaces: t('common:units.workspace-count', {
								count: workspaceCount,
								defaultValue_one: '{{count}} workspace',
								defaultValue_other: '{{count}} workspaces',
							}),
						}}
					/>
				</DialogDescription>
			</DialogHeader>

			<LifecycleSummary rows={projectSummaryRows(project)} />

			{hasWorkspaces ? (
				<CleanupToggle
					checked={branchCleanup}
					description={
						<Trans
							components={[<span className='font-mono' key='context-dir' />]}
							defaults='The per-workspace <0>.context/</0> handoff files are preserved; anything else not pushed will be lost.'
							i18nKey='workbench:archive-repository.cleanup.description'
						/>
					}
					disabled={isBusy}
					label={t(
						'workbench:archive-repository.cleanup.label',
						'Also remove each worktree and drop its local branch',
					)}
					onCheckedChange={setBranchCleanup}
				/>
			) : null}

			<LifecycleDialogActions
				actionLabel={t('common:actions.archive', 'Archive')}
				actionVariant={branchCleanup ? 'destructive' : 'default'}
				canAct={canArchive}
				diagnostics={diagnostics}
				diagnosticsTestId='archive-repository-diagnostics'
				isBusy={isBusy}
				onAct={start}
				onClose={handleClose}
			/>
		</>
	);
}
