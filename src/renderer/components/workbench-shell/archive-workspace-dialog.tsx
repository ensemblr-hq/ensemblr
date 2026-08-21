import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
	archiveWorkspace,
	isEnsemblrApiAvailable,
	reviewMergeSettingsQuery,
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
import { workspaceSummaryRows } from '@/renderer/lib/workbench/lifecycle-summary-rows';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { ArchiveWorkspaceDiagnostic } from '@/shared/ipc/contracts/workspace';

/**
 * Lifecycle archive dialog: preserves the workspace `.context/` folder and
 * archives the workspace as a state. Whether the worktree and local branch go
 * with it is the repository's resolved `deleteLocalBranchOnArchive` setting,
 * the same one the merge-then-archive flow obeys. A setting that cannot be
 * resolved keeps both and says so rather than guessing.
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

/** Inner archive form for a workspace; owns the archiving state and reads the branch-cleanup policy. */
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
	const hasBranch = Boolean(workspace.branchName);
	// The worktree being archived is the checkout whose committed
	// `.ensemblr/settings.toml` applies to this branch, so resolve against it
	// rather than the repository root.
	const {
		data: gitSettings,
		isError: hasSettingsError,
		isPending: isResolvingSettings,
	} = useQuery(
		reviewMergeSettingsQuery({
			repositoryId: workspace.projectId,
			repositoryPath: workspace.pathLabel,
		}),
	);
	const branchCleanup =
		hasBranch && gitSettings?.deleteLocalBranchOnArchive === true;
	const { diagnostics, isBusy, start } = useLifecycleDialogAction({
		failure: archiveWorkspaceFailure,
		onOpenChange,
		onSucceeded: () => onArchived(workspace.id),
		operationKey: `archive-workspace:${workspace.id}`,
		run: () =>
			archiveWorkspace({
				branchCleanup,
				workspaceId: workspace.id,
			}),
	});

	// Archiving before the resolver answers would silently skip the cleanup the
	// setting asked for, because an unanswered query reads as `false`. A resolver
	// that failed outright reads as `false` too, so the archive stays available
	// but says on screen what it is about to do instead.
	const canArchive =
		!isBusy && !isResolvingSettings && isEnsemblrApiAvailable();

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
					{branchCleanup ? (
						<Trans
							components={[
								<span className='font-mono' key='context-dir' />,
								<span className='font-mono' key='archived-contexts-dir' />,
							]}
							defaults='Marks the workspace as archived and preserves its <0>.context/</0> handoff files under <1>archived-contexts/</1>. The worktree folder is removed and the local branch dropped, per your git settings; anything else not pushed to the remote will be lost.'
							i18nKey='workbench:archive-workspace.description-cleanup'
						/>
					) : (
						<Trans
							components={[
								<span className='font-mono' key='context-dir' />,
								<span className='font-mono' key='archived-contexts-dir' />,
							]}
							defaults='Marks the workspace as archived and preserves its <0>.context/</0> handoff files under <1>archived-contexts/</1>. The worktree folder and local branch stay on disk; nothing is committed or pushed.'
							i18nKey='workbench:archive-workspace.description-keep'
						/>
					)}
				</DialogDescription>
			</DialogHeader>

			<LifecycleSummary rows={workspaceSummaryRows(workspace)} />

			{hasSettingsError ? (
				<p
					className='text-status-danger text-xs'
					data-testid='archive-workspace-settings-error'
				>
					{t(
						'workbench:archive-workspace.settings-unavailable',
						'Your git settings could not be read, so the worktree folder and local branch will be kept.',
					)}
				</p>
			) : null}

			<LifecycleDialogActions
				actionLabel={t('common:actions.archive', 'Archive')}
				actionVariant={branchCleanup ? 'destructive' : 'default'}
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
