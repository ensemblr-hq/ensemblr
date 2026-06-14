import { useCallback, useState } from 'react';

import {
	deleteRepository,
	isEnsembleApiAvailable,
} from '@/renderer/api/ensemble-queries';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { ArchiveDiagnosticsList } from '@/renderer/components/workbench-shell/archive-diagnostics-list';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { DeleteRepositoryDiagnostic } from '@/shared/ipc/contracts/repository';

interface DeleteRepositoryDialogProps {
	onDeleted: (projectId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	project: ProjectShellModel | null;
}

/**
 * Destructive confirmation dialog for a repository. Wipes every workspace, the
 * repository row, and writes the `.ensemble-archived` sentinel so the shared-
 * root reconciler skips the folder on next launch. Use the archive dialog for
 * the reversible lifecycle path.
 */
export function DeleteRepositoryDialog({
	onDeleted,
	onOpenChange,
	open,
	project,
}: DeleteRepositoryDialogProps) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='gap-4 sm:max-w-md'>
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

type DeleteStage = 'deleting' | 'failure' | 'idle';

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

	const canDelete = stage !== 'deleting' && isEnsembleApiAvailable();
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
				<DialogTitle className='font-medium text-[0.9375rem]'>
					Delete repository?
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					Permanently removes the repository and {workspaceCount}{' '}
					{workspaceCount === 1 ? 'workspace' : 'workspaces'} from Ensemble.
					Each workspace's worktree folder is deleted and its local branch is
					dropped. The repository folder stays on disk so you can re-register it
					later. This cannot be undone.
				</p>
			</DialogHeader>

			<div className='flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs'>
				<span className='font-medium'>{project.name}</span>
				<span className='truncate font-mono text-[0.6875rem] text-muted-foreground'>
					{project.pathLabel}
				</span>
			</div>

			{stage === 'failure' && diagnostics.length > 0 ? (
				<ArchiveDiagnosticsList
					diagnostics={diagnostics}
					testId='delete-repository-diagnostics'
				/>
			) : null}

			<div className='-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
				<Button
					className='h-8'
					disabled={isBusy}
					onClick={handleClose}
					type='button'
					variant='outline'
				>
					Cancel
				</Button>
				<Button
					className='h-8'
					disabled={!canDelete}
					onClick={handleDelete}
					type='button'
					variant='destructive'
				>
					{isBusy ? 'Deleting…' : 'Delete'}
				</Button>
			</div>
		</>
	);
}
