import { useCallback, useState } from 'react';

import {
	archiveWorkspace,
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
import type { ArchiveWorkspaceDiagnostic } from '@/shared/ipc';

interface ArchiveWorkspaceDialogProps {
	onArchived: (workspaceId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	workspace: WorkspaceShellModel | null;
}

/** Destructive confirmation dialog for permanently deleting a workspace. */
export function ArchiveWorkspaceDialog({
	onArchived,
	onOpenChange,
	open,
	workspace,
}: ArchiveWorkspaceDialogProps) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='gap-4 sm:max-w-md'>
				{workspace ? (
					<ArchiveWorkspaceDialogForm
						key={`${workspace.id}:${open ? 'open' : 'closed'}`}
						onArchived={onArchived}
						onOpenChange={onOpenChange}
						workspace={workspace}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

type ArchiveStage = 'archiving' | 'failure' | 'idle';

/** Inner state-owned form that resets each time the dialog re-opens. */
function ArchiveWorkspaceDialogForm({
	onArchived,
	onOpenChange,
	workspace,
}: {
	onArchived: (workspaceId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	workspace: WorkspaceShellModel;
}) {
	const [stage, setStage] = useState<ArchiveStage>('idle');
	const [diagnostics, setDiagnostics] = useState<ArchiveWorkspaceDiagnostic[]>(
		[],
	);

	const canArchive = stage !== 'archiving' && isEnsembleApiAvailable();

	const handleArchive = useCallback(async () => {
		if (!canArchive) {
			return;
		}
		setStage('archiving');
		setDiagnostics([]);

		const result = await archiveWorkspace({ workspaceId: workspace.id });

		if (result.status === 'success') {
			// Let the parent run cache invalidation + navigation so it can suppress
			// the reorder layout animation BEFORE the sidebar reflows around the
			// removed workspace.
			await onArchived(workspace.id);
			onOpenChange(false);
			return;
		}

		setStage('failure');
		setDiagnostics(result.diagnostics);
	}, [canArchive, onArchived, onOpenChange, workspace.id]);

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	const isBusy = stage === 'archiving';

	return (
		<>
			<DialogHeader>
				<DialogTitle className='font-medium text-[0.9375rem]'>
					Archive workspace?
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					Permanently deletes the worktree folder, drops the local branch, and
					removes the workspace from Ensemble. Anything not pushed to the remote
					is lost.
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
					testId='archive-workspace-diagnostics'
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
					disabled={!canArchive}
					onClick={handleArchive}
					type='button'
					variant='destructive'
				>
					{isBusy ? 'Archiving…' : 'Archive'}
				</Button>
			</div>
		</>
	);
}
