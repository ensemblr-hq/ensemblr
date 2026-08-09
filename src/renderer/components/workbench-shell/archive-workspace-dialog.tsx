import { useCallback, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
	archiveWorkspace,
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
import { CleanupToggle } from '@/renderer/components/workbench-shell/cleanup-toggle';
import { LifecycleSummary } from '@/renderer/components/workbench-shell/lifecycle-summary';
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
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
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

/** Progress stage of the workspace archive flow. */
type ArchiveStage = 'archiving' | 'failure' | 'idle';

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
	const [stage, setStage] = useState<ArchiveStage>('idle');
	const [branchCleanup, setBranchCleanup] = useState(false);
	const [diagnostics, setDiagnostics] = useState<ArchiveWorkspaceDiagnostic[]>(
		[],
	);

	const canArchive = stage !== 'archiving' && isEnsemblrApiAvailable();
	const hasBranch = Boolean(workspace.branchName);

	const handleArchive = useCallback(async () => {
		if (!canArchive) {
			return;
		}
		setStage('archiving');
		setDiagnostics([]);

		const result = await archiveWorkspace({
			branchCleanup: branchCleanup && hasBranch,
			workspaceId: workspace.id,
		});

		if (result.status === 'success') {
			await onArchived(workspace.id);
			onOpenChange(false);
			return;
		}

		setStage('failure');
		setDiagnostics(result.diagnostics);
	}, [
		branchCleanup,
		canArchive,
		hasBranch,
		onArchived,
		onOpenChange,
		workspace.id,
	]);

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	const isBusy = stage === 'archiving';

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

			{stage === 'failure' && diagnostics.length > 0 ? (
				<ArchiveDiagnosticsList
					diagnostics={diagnostics}
					testId='archive-workspace-diagnostics'
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
					disabled={!canArchive}
					onClick={handleArchive}
					type='button'
					variant={branchCleanup ? 'destructive' : 'default'}
				>
					{isBusy
						? t('common:actions.archiving', 'Archiving…')
						: t('common:actions.archive', 'Archive')}
				</Button>
			</DialogFooter>
		</>
	);
}
