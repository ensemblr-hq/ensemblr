import { useCallback, useState } from 'react';

import {
	deleteWorkspace,
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
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { DeleteWorkspaceDiagnostic } from '@/shared/ipc/contracts/workspace';

interface DeleteWorkspaceDialogProps {
	onDeleted: (workspaceId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	workspace: WorkspaceShellModel | null;
}

/**
 * Destructive confirmation dialog. Removes the worktree folder, drops the
 * local branch, and deletes the SQLite row — no `.context/` preservation. Use
 * the archive dialog for the reversible lifecycle path.
 */
export function DeleteWorkspaceDialog({
	onDeleted,
	onOpenChange,
	open,
	workspace,
}: DeleteWorkspaceDialogProps) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='gap-4 sm:max-w-md'>
				{workspace ? (
					<DeleteWorkspaceDialogForm
						key={`${workspace.id}:${open ? 'open' : 'closed'}`}
						onDeleted={onDeleted}
						onOpenChange={onOpenChange}
						workspace={workspace}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

type DeleteStage = 'deleting' | 'failure' | 'idle';

function DeleteWorkspaceDialogForm({
	onDeleted,
	onOpenChange,
	workspace,
}: {
	onDeleted: (workspaceId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	workspace: WorkspaceShellModel;
}) {
	const [stage, setStage] = useState<DeleteStage>('idle');
	const [diagnostics, setDiagnostics] = useState<DeleteWorkspaceDiagnostic[]>(
		[],
	);

	const canDelete = stage !== 'deleting' && isEnsembleApiAvailable();

	const handleDelete = useCallback(async () => {
		if (!canDelete) {
			return;
		}
		setStage('deleting');
		setDiagnostics([]);

		const result = await deleteWorkspace({ workspaceId: workspace.id });

		if (result.status === 'success') {
			await onDeleted(workspace.id);
			onOpenChange(false);
			return;
		}

		setStage('failure');
		setDiagnostics(result.diagnostics);
	}, [canDelete, onDeleted, onOpenChange, workspace.id]);

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	const isBusy = stage === 'deleting';

	return (
		<>
			<DialogHeader>
				<DialogTitle className='font-medium text-[0.9375rem]'>
					Delete workspace?
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					Permanently removes the worktree folder, drops the local branch, and
					deletes the workspace from Ensemble. Anything not pushed to the remote
					is lost. This cannot be undone.
				</p>
			</DialogHeader>

			<div className='flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs'>
				<span className='font-medium'>{workspace.name}</span>
				<span className='font-mono text-[0.6875rem] text-muted-foreground'>
					{workspace.branchName}
				</span>
				<span className='truncate font-mono text-[0.6875rem] text-muted-foreground'>
					{workspace.pathLabel}
				</span>
			</div>

			{stage === 'failure' && diagnostics.length > 0 ? (
				<ArchiveDiagnosticsList
					diagnostics={diagnostics}
					testId='delete-workspace-diagnostics'
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
