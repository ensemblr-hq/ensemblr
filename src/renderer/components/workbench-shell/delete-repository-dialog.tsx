import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
	deleteRepository,
	isEnsemblrApiAvailable,
} from '@/renderer/api/ensemblr-queries';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { LifecycleDialogActions } from '@/renderer/components/workbench-shell/lifecycle-dialog-actions';
import { LifecycleSummary } from '@/renderer/components/workbench-shell/lifecycle-summary';
import { useLifecycleDialogAction } from '@/renderer/hooks/workbench-shell/use-lifecycle-dialog-action';
import { projectSummaryRows } from '@/renderer/lib/workbench/lifecycle-summary-rows';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { DeleteRepositoryDiagnostic } from '@/shared/ipc/contracts/repository';

/**
 * Destructive confirmation dialog for a repository. Wipes every workspace, the
 * repository row, and writes the `.ensemblr-archived` sentinel so the shared-
 * root reconciler skips the folder on next launch. Use the archive dialog for
 * the reversible lifecycle path.
 */
export function DeleteRepositoryDialog({
	onDeleted,
	onOpenChange,
	open,
	project,
}: {
	onDeleted: (projectId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	project: ProjectShellModel | null;
}) {
	return (
		// Never open without a project: callers that hold `open` and `project` in
		// separate state drop the project the moment it is deleted, and an open
		// dialog with nothing to render is an empty shell whose overlay still eats
		// every click, leaving the app unusable with no way to dismiss it.
		<Dialog onOpenChange={onOpenChange} open={open && project !== null}>
			<DialogContent className='sm:max-w-md'>
				{project ? (
					<DeleteRepositoryDialogForm
						key={`${project.id}:${open ? 'open' : 'closed'}`}
						onDeleted={onDeleted}
						onOpenChange={onOpenChange}
						project={project}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/**
 * Wraps an unexpected delete-repository rejection as the diagnostic the dialog
 * already renders — a denied permission gate throws rather than reporting.
 * @param message - The thrown error's message
 * @returns A diagnostic carrying it
 */
function deleteRepositoryFailure(message: string): DeleteRepositoryDiagnostic {
	return { code: 'repository-delete-failed', message, severity: 'error' };
}

/** Inner delete form for a repository; owns the deleting state and failure diagnostics. */
function DeleteRepositoryDialogForm({
	onDeleted,
	onOpenChange,
	project,
}: {
	onDeleted: (projectId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	project: ProjectShellModel;
}) {
	const { t } = useTranslation();
	const { diagnostics, isBusy, start } = useLifecycleDialogAction({
		failure: deleteRepositoryFailure,
		onOpenChange,
		onSucceeded: () => onDeleted(project.id),
		operationKey: `delete-repository:${project.id}`,
		run: () => deleteRepository({ repositoryId: project.id }),
	});

	const canDelete = !isBusy && isEnsemblrApiAvailable();
	const workspaceCount = project.workspaces.length;

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t('workbench:delete-repository.title', 'Delete repository?')}
				</DialogTitle>
				<DialogDescription className='text-xs'>
					{t(
						'workbench:delete-repository.description',
						"Permanently removes the repository and {{workspaces}} from Ensemblr. Each workspace's worktree folder is deleted and its local branch is dropped. The repository folder stays on disk so you can re-register it later. This cannot be undone.",
						{
							workspaces: t('common:units.workspace-count', {
								count: workspaceCount,
								defaultValue_one: '{{count}} workspace',
								defaultValue_other: '{{count}} workspaces',
							}),
						},
					)}
				</DialogDescription>
			</DialogHeader>

			<LifecycleSummary rows={projectSummaryRows(project)} />

			<LifecycleDialogActions
				actionLabel={t('common:actions.delete', 'Delete')}
				actionVariant='destructive'
				canAct={canDelete}
				diagnostics={diagnostics}
				diagnosticsTestId='delete-repository-diagnostics'
				isBusy={isBusy}
				onAct={start}
				onClose={handleClose}
			/>
		</>
	);
}
