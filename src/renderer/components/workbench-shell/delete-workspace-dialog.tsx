import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	deleteWorkspace,
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
import { workspaceSummaryRows } from '@/renderer/lib/workbench/lifecycle-summary-rows';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { DeleteWorkspaceDiagnostic } from '@/shared/ipc/contracts/workspace';

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
}: {
	onDeleted: (workspaceId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	workspace: WorkspaceShellModel | null;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='sm:max-w-md'>
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

/** Progress stage of the workspace delete flow. */
type DeleteStage = 'deleting' | 'failure' | 'idle';

/** Inner delete form for a workspace; owns the deleting state and failure diagnostics. */
function DeleteWorkspaceDialogForm({
	onDeleted,
	onOpenChange,
	workspace,
}: {
	onDeleted: (workspaceId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	const [stage, setStage] = useState<DeleteStage>('idle');
	const [diagnostics, setDiagnostics] = useState<DeleteWorkspaceDiagnostic[]>(
		[],
	);

	const canDelete = stage !== 'deleting' && isEnsemblrApiAvailable();

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
				<DialogTitle>
					{t('workbench:delete-workspace.title', 'Delete workspace?')}
				</DialogTitle>
				<DialogDescription className='text-xs'>
					{t(
						'workbench:delete-workspace.description',
						'Permanently removes the worktree folder, drops the local branch, and deletes the workspace from Ensemblr. Anything not pushed to the remote is lost. This cannot be undone.',
					)}
				</DialogDescription>
			</DialogHeader>

			<LifecycleSummary rows={workspaceSummaryRows(workspace)} />

			{stage === 'failure' && diagnostics.length > 0 ? (
				<ArchiveDiagnosticsList
					diagnostics={diagnostics}
					testId='delete-workspace-diagnostics'
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
