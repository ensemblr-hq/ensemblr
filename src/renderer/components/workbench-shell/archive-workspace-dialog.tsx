import { useCallback, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
	archiveWorkspace,
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
import { workspaceSummaryRows } from '@/renderer/lib/workbench/lifecycle-summary-rows';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { ArchiveWorkspaceDiagnostic } from '@/shared/ipc/contracts/workspace';

/**
 * Lifecycle archive dialog: preserves the workspace `.context/` folder and
 * archives the workspace as a state. Branch cleanup is opt-in and gated by a
 * second confirmation checkbox so a misclick never drops a stray local branch.
 */
export function ArchiveWorkspaceDialog({
	onArchived,
	onOpenChange,
	open,
	workspace,
}: {
	onArchived: (workspaceId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	workspace: WorkspaceShellModel | null;
}) {
	// Never open without a workspace: callers that hold `open` and `workspace` in
	// separate state drop the workspace the moment it is archived, and an open
	// dialog with nothing to render is an empty shell whose overlay still eats
	// every click, leaving the app unusable with no way to dismiss it.
	return (
		<Dialog onOpenChange={onOpenChange} open={open && workspace !== null}>
			<DialogContent className='sm:max-w-md'>
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

/**
 * Wraps an unexpected archive-workspace rejection as the diagnostic the dialog
 * already renders — a denied permission gate throws rather than reporting.
 * @param message - The thrown error's message
 * @returns A diagnostic carrying it
 */
function archiveWorkspaceFailure(message: string): ArchiveWorkspaceDiagnostic {
	return { code: 'workspace-update-failed', message, severity: 'error' };
}

/** Inner archive form for a workspace; owns the archiving state and opt-in branch cleanup. */
function ArchiveWorkspaceDialogForm({
	onArchived,
	onOpenChange,
	workspace,
}: {
	onArchived: (workspaceId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	const [branchCleanup, setBranchCleanup] = useState(false);
	const hasBranch = Boolean(workspace.branchName);
	const { diagnostics, isBusy, start } = useLifecycleDialogAction({
		failure: archiveWorkspaceFailure,
		onOpenChange,
		onSucceeded: () => onArchived(workspace.id),
		operationKey: `archive-workspace:${workspace.id}`,
		run: () =>
			archiveWorkspace({
				branchCleanup: branchCleanup && hasBranch,
				workspaceId: workspace.id,
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
					{t('workbench:archive-workspace.title', 'Archive workspace?')}
				</DialogTitle>
				<DialogDescription className='text-xs'>
					<Trans
						components={[
							<span className='font-mono' key='context-dir' />,
							<span className='font-mono' key='archived-contexts-dir' />,
						]}
						defaults='Marks the workspace as archived and preserves its <0>.context/</0> handoff files under <1>archived-contexts/</1>. By default the worktree folder and local branch stay on disk; nothing is committed or pushed.'
						i18nKey='workbench:archive-workspace.description'
					/>
				</DialogDescription>
			</DialogHeader>

			<LifecycleSummary rows={workspaceSummaryRows(workspace)} />

			{hasBranch ? (
				<CleanupToggle
					checked={branchCleanup}
					description={
						<Trans
							components={[<span className='font-mono' key='context-dir' />]}
							defaults='The <0>.context/</0> handoff files are preserved; anything else not pushed to the remote will be lost.'
							i18nKey='workbench:archive-workspace.cleanup.description'
						/>
					}
					disabled={isBusy}
					label={t(
						'workbench:archive-workspace.cleanup.label',
						'Also remove the worktree and drop the local branch',
					)}
					onCheckedChange={setBranchCleanup}
				/>
			) : null}

			<LifecycleDialogActions
				actionLabel={t('common:actions.archive', 'Archive')}
				actionVariant={branchCleanup ? 'destructive' : 'default'}
				busyLabel={t('common:actions.archiving', 'Archiving…')}
				canAct={canArchive}
				diagnostics={diagnostics}
				diagnosticsTestId='archive-workspace-diagnostics'
				isBusy={isBusy}
				onAct={start}
				onClose={handleClose}
			/>
		</>
	);
}
