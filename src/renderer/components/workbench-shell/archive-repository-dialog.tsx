import { useCallback, useState } from 'react';

import {
	archiveRepository,
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
import type { ArchiveRepositoryDiagnostic } from '@/shared/ipc';

interface ArchiveRepositoryDialogProps {
	onArchived: (projectId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	project: ProjectShellModel | null;
}

/** Destructive confirmation dialog for archiving a project repository. */
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

/** Inner state-owned form that resets each time the dialog re-opens. */
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
	const [diagnostics, setDiagnostics] = useState<ArchiveRepositoryDiagnostic[]>(
		[],
	);

	const canArchive = stage !== 'archiving' && isEnsembleApiAvailable();
	const workspaceCount = project.workspaces.length;

	const handleArchive = useCallback(async () => {
		if (!canArchive) {
			return;
		}
		setStage('archiving');
		setDiagnostics([]);

		const result = await archiveRepository({ repositoryId: project.id });

		if (result.status === 'success') {
			await onArchived(project.id);
			onOpenChange(false);
			return;
		}

		setStage('failure');
		setDiagnostics(result.diagnostics);
	}, [canArchive, onArchived, onOpenChange, project.id]);

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
					Removes the repository and {workspaceCount}{' '}
					{workspaceCount === 1 ? 'workspace' : 'workspaces'} from Ensemble.
					Every workspace's worktree folder is deleted and its local branch is
					dropped. The repository folder itself stays on disk so you can
					re-register it later.
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
					variant='destructive'
				>
					{isBusy ? 'Archiving…' : 'Archive'}
				</Button>
			</div>
		</>
	);
}
