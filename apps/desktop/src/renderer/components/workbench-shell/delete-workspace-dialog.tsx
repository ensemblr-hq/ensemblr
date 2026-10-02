import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
	deleteWorkspace,
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
import { useWorkspaceTeardownHop } from '@/renderer/hooks/workbench-shell/use-workspace-teardown-hop';
import { workspaceSummaryRows } from '@/renderer/lib/workbench/lifecycle-summary-rows';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { DeleteWorkspaceDiagnostic } from '@/shared/ipc/contracts/workspace';

/**
 * Destructive confirmation dialog. Removes the worktree folder, drops the
 * local branch, and deletes the SQLite row — no `.context/` preservation. Use
 * the archive dialog for the reversible lifecycle path.
 *
 * A delete carries the same live state an archive does, because it takes the
 * worktree apart the same way: the workspace is marked deleting for the whole
 * run, so its sidebar row, board card and Workspace menu stop offering a second
 * one and the route loaders refuse it as a target; and the shell leaves the
 * workspace before the teardown starts rather than standing in a folder being
 * removed underneath it.
 */
export function DeleteWorkspaceDialog({
	activeWorkspaceId,
	onDeleted,
	onOpenChange,
	open,
	workspace,
}: {
	activeWorkspaceId: string | null;
	onDeleted: (workspaceId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	workspace: WorkspaceShellModel | null;
}) {
	// Never open without a workspace: callers that hold `open` and `workspace` in
	// separate state drop the workspace the moment it is deleted, and an open
	// dialog with nothing to render is an empty shell whose overlay still eats
	// every click, leaving the app unusable with no way to dismiss it.
	return (
		<Dialog onOpenChange={onOpenChange} open={open && workspace !== null}>
			<DialogContent className='sm:max-w-md'>
				{workspace ? (
					<DeleteWorkspaceDialogForm
						activeWorkspaceId={activeWorkspaceId}
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

/**
 * Wraps an unexpected delete-workspace rejection as the diagnostic the dialog
 * already renders — a denied permission gate throws rather than reporting.
 * @param message - The thrown error's message
 * @returns A diagnostic carrying it
 */
function deleteWorkspaceFailure(message: string): DeleteWorkspaceDiagnostic {
	return { code: 'workspace-delete-failed', message, severity: 'error' };
}

/** Inner delete form for a workspace; owns the deleting state and failure diagnostics. */
function DeleteWorkspaceDialogForm({
	activeWorkspaceId,
	onDeleted,
	onOpenChange,
	workspace,
}: {
	activeWorkspaceId: string | null;
	onDeleted: (workspaceId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	const deleteAwayFromWorkspace = useWorkspaceTeardownHop({
		activeWorkspaceId,
	});
	const { diagnostics, isBusy, start } = useLifecycleDialogAction({
		failure: deleteWorkspaceFailure,
		lifecycleRun: { kind: 'deleting', workspaceId: workspace.id },
		onOpenChange,
		onSucceeded: () => onDeleted(workspace.id),
		operationKey: `delete-workspace:${workspace.id}`,
		run: () =>
			deleteAwayFromWorkspace(workspace.id, () =>
				deleteWorkspace({ workspaceId: workspace.id }),
			),
	});

	const canDelete = !isBusy && isEnsemblrApiAvailable();

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

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

			<LifecycleDialogActions
				actionLabel={t('common:actions.delete', 'Delete')}
				actionVariant='destructive'
				canAct={canDelete}
				diagnostics={diagnostics}
				diagnosticsTestId='delete-workspace-diagnostics'
				isBusy={isBusy}
				onAct={start}
				onClose={handleClose}
			/>
		</>
	);
}
