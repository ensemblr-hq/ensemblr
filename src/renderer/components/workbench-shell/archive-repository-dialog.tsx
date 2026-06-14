import { useCallback, useState } from 'react';

import {
	archiveRepository,
	isEnsembleApiAvailable,
} from '@/renderer/api/ensemble-queries';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Label } from '@/renderer/components/ui/label';
import { ArchiveDiagnosticsList } from '@/renderer/components/workbench-shell/archive-diagnostics-list';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { ArchiveRepositoryDiagnostic } from '@/shared/ipc/contracts/repository';

interface ArchiveRepositoryDialogProps {
	onArchived: (projectId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	project: ProjectShellModel | null;
}

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
}: ArchiveRepositoryDialogProps) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='gap-4 sm:max-w-md'>
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

type ArchiveStage = 'archiving' | 'failure' | 'idle';

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

	const canArchive = stage !== 'archiving' && isEnsembleApiAvailable();
	const workspaceCount = project.workspaces.length;
	const hasWorkspaces = workspaceCount > 0;
	const checkboxId = `archive-repository-branch-cleanup-${project.id}`;

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
				<DialogTitle className='font-medium text-[0.9375rem]'>
					Archive repository?
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					Marks the repository and {workspaceCount}{' '}
					{workspaceCount === 1 ? 'workspace' : 'workspaces'} as archived. Each
					workspace's <span className='font-mono'>.context/</span> handoff files
					are preserved under{' '}
					<span className='font-mono'>archived-contexts/</span>. Worktrees and
					the repository folder stay on disk.
				</p>
			</DialogHeader>

			<div className='flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs'>
				<span className='font-medium'>{project.name}</span>
				<span className='truncate font-mono text-[0.6875rem] text-muted-foreground'>
					{project.pathLabel}
				</span>
			</div>

			{hasWorkspaces ? (
				<div className='flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2'>
					<Checkbox
						checked={branchCleanup}
						disabled={isBusy}
						id={checkboxId}
						onCheckedChange={(value) => setBranchCleanup(value === true)}
					/>
					<div className='flex flex-col gap-0.5'>
						<Label className='text-xs' htmlFor={checkboxId}>
							Also remove each worktree and drop its local branch
						</Label>
						<span className='text-[0.6875rem] text-muted-foreground'>
							The per-workspace <span className='font-mono'>.context/</span>{' '}
							handoff files are preserved; anything else not pushed will be
							lost.
						</span>
					</div>
				</div>
			) : null}

			{stage === 'failure' && diagnostics.length > 0 ? (
				<ArchiveDiagnosticsList
					diagnostics={diagnostics}
					testId='archive-repository-diagnostics'
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
					variant={branchCleanup ? 'destructive' : 'default'}
				>
					{isBusy ? 'Archiving…' : 'Archive'}
				</Button>
			</div>
		</>
	);
}
