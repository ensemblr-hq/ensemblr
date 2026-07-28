import { useCallback, useState } from 'react';

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
import {
	LifecycleSummary,
	projectSummaryRows,
} from '@/renderer/components/workbench-shell/lifecycle-summary';
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
		<Dialog onOpenChange={onOpenChange} open={open}>
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
			await onDeleted(project.id);
			onOpenChange(false);
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
				<DialogTitle>Delete repository?</DialogTitle>
				<DialogDescription className='text-xs'>
					Permanently removes the repository and {workspaceCount}{' '}
					{workspaceCount === 1 ? 'workspace' : 'workspaces'} from Ensemblr.
					Each workspace's worktree folder is deleted and its local branch is
					dropped. The repository folder stays on disk so you can re-register it
					later. This cannot be undone.
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
					Cancel
				</Button>
				<Button
					disabled={!canDelete}
					onClick={handleDelete}
					type='button'
					variant='destructive'
				>
					{isBusy ? 'Deleting…' : 'Delete'}
				</Button>
			</DialogFooter>
		</>
	);
}
