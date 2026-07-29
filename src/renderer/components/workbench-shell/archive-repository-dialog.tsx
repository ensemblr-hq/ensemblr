import { useCallback, useState } from 'react';

import {
	archiveRepository,
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
import { projectSummaryRows } from '@/renderer/lib/workbench/lifecycle-summary-rows';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { ArchiveRepositoryDiagnostic } from '@/shared/ipc/contracts/repository';

/**
 * Lifecycle archive dialog for a repository. Cascades to each child workspace;
 * branch cleanup is opt-in. Worktree folders are preserved so ENS-038/ENS-060
 * subscribers can still inspect them.
 */
export function ArchiveRepositoryDialog({
	onArchived,
	onOpenChange,
	open,
	project,
}: {
	onArchived: (projectId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	project: ProjectShellModel | null;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='sm:max-w-md'>
				{project ? (
					<ArchiveRepositoryDialogForm
						key={`${project.id}:${open ? 'open' : 'closed'}`}
						onArchived={onArchived}
						onOpenChange={onOpenChange}
						project={project}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** Progress stage of the repository archive flow. */
type ArchiveStage = 'archiving' | 'failure' | 'idle';

/** Inner archive form for a repository; owns the archiving state and opt-in branch cleanup. */
function ArchiveRepositoryDialogForm({
	onArchived,
	onOpenChange,
	project,
}: {
	onArchived: (projectId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	project: ProjectShellModel;
}) {
	const [stage, setStage] = useState<ArchiveStage>('idle');
	const [branchCleanup, setBranchCleanup] = useState(false);
	const [diagnostics, setDiagnostics] = useState<ArchiveRepositoryDiagnostic[]>(
		[],
	);

	const canArchive = stage !== 'archiving' && isEnsemblrApiAvailable();
	const workspaceCount = project.workspaces.length;
	const hasWorkspaces = workspaceCount > 0;

	const handleArchive = useCallback(async () => {
		if (!canArchive) {
			return;
		}
		setStage('archiving');
		setDiagnostics([]);

		const result = await archiveRepository({
			branchCleanup: branchCleanup && hasWorkspaces,
			repositoryId: project.id,
		});

		if (result.status === 'success') {
			await onArchived(project.id);
			onOpenChange(false);
			return;
		}

		setStage('failure');
		setDiagnostics(result.diagnostics);
	}, [
		branchCleanup,
		canArchive,
		hasWorkspaces,
		onArchived,
		onOpenChange,
		project.id,
	]);

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	const isBusy = stage === 'archiving';

	return (
		<>
			<DialogHeader>
				<DialogTitle>Archive repository?</DialogTitle>
				<DialogDescription className='text-xs'>
					Marks the repository and {workspaceCount}{' '}
					{workspaceCount === 1 ? 'workspace' : 'workspaces'} as archived. Each
					workspace's <span className='font-mono'>.context/</span> handoff files
					are preserved under{' '}
					<span className='font-mono'>archived-contexts/</span>. Worktrees and
					the repository folder stay on disk.
				</DialogDescription>
			</DialogHeader>

			<LifecycleSummary rows={projectSummaryRows(project)} />

			{hasWorkspaces ? (
				<CleanupToggle
					checked={branchCleanup}
					description={
						<>
							The per-workspace <span className='font-mono'>.context/</span>{' '}
							handoff files are preserved; anything else not pushed will be
							lost.
						</>
					}
					disabled={isBusy}
					label='Also remove each worktree and drop its local branch'
					onCheckedChange={setBranchCleanup}
				/>
			) : null}

			{stage === 'failure' && diagnostics.length > 0 ? (
				<ArchiveDiagnosticsList
					diagnostics={diagnostics}
					testId='archive-repository-diagnostics'
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
					disabled={!canArchive}
					onClick={handleArchive}
					type='button'
					variant={branchCleanup ? 'destructive' : 'default'}
				>
					{isBusy ? 'Archiving…' : 'Archive'}
				</Button>
			</DialogFooter>
		</>
	);
}
