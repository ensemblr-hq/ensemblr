import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	deleteRepository,
	isEnsemblrApiAvailable,
} from '@/renderer/api/ensemblr-queries';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { ArchiveDiagnosticsList } from '@/renderer/components/workbench-shell/archive-diagnostics-list';
import { LifecycleSummary } from '@/renderer/components/workbench-shell/lifecycle-summary';
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

/** Progress stage of the repository delete flow. */
type DeleteStage = 'deleting' | 'failure' | 'idle';

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
	const [stage, setStage] = useState<DeleteStage>('idle');
	const [diagnostics, setDiagnostics] = useState<DeleteRepositoryDiagnostic[]>(
		[],
	);

	const canDelete = stage !== 'deleting' && isEnsemblrApiAvailable();
	const workspaceCount = project.workspaces.length;

	const handleDelete = useCallback(async () => {
		if (!canDelete) {
			return;
		}
		setStage('deleting');
		setDiagnostics([]);

		const result = await deleteRepository({ repositoryId: project.id });

		if (result.status === 'success') {
			// Close before the post-removal work: `onDeleted` navigates away from the
			// deleted repository, and awaiting that first leaves the modal — and its
			// pointer-events overlay — up for as long as navigation takes to settle.
			onOpenChange(false);
			await onDeleted(project.id);
			return;
		}

		setStage('failure');
		setDiagnostics(result.diagnostics);
	}, [canDelete, onDeleted, onOpenChange, project.id]);

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	const isBusy = stage === 'deleting';

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

			{stage === 'failure' && diagnostics.length > 0 ? (
				<ArchiveDiagnosticsList
					diagnostics={diagnostics}
					testId='delete-repository-diagnostics'
				/>
			) : null}

			<DialogFooter>
				<Button
					disabled={isBusy}
					onClick={handleClose}
					type='button'
					variant='ghost'
				>
					{t('common:actions.cancel', 'Cancel')}
				</Button>
				<Button
					disabled={!canDelete}
					onClick={handleDelete}
					type='button'
					variant='destructive'
				>
					{isBusy
						? t('common:actions.deleting', 'Deleting…')
						: t('common:actions.delete', 'Delete')}
				</Button>
			</DialogFooter>
		</>
	);
}
