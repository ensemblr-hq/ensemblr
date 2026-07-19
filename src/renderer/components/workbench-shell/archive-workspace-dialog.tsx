import { useCallback, useState } from 'react';

import {
	archiveWorkspace,
	isEnsemblrApiAvailable,
} from '@/renderer/api/ensemblr-queries';
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
				<DialogTitle className='font-medium text-[0.9375rem]'>
					Archive workspace?
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					Marks the workspace as archived and preserves its{' '}
					<span className='font-mono'>.context/</span> handoff files under{' '}
					<span className='font-mono'>archived-contexts/</span>. By default the
					worktree folder and local branch stay on disk; nothing is committed or
					pushed.
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

			{hasBranch ? (
				<div className='flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2'>
					<Checkbox
						checked={branchCleanup}
						disabled={isBusy}
						id={`archive-workspace-branch-cleanup-${workspace.id}`}
						onCheckedChange={(value) => setBranchCleanup(value === true)}
					/>
					<div className='flex flex-col gap-0.5'>
						<Label
							className='text-xs'
							htmlFor={`archive-workspace-branch-cleanup-${workspace.id}`}
						>
							Also remove the worktree and drop the branch{' '}
							<span className='font-mono'>{workspace.branchName}</span>
						</Label>
						<span className='text-[0.6875rem] text-muted-foreground'>
							The <span className='font-mono'>.context/</span> handoff files are
							preserved; anything else not pushed to the remote will be lost.
						</span>
					</div>
				</div>
			) : null}

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
					variant={branchCleanup ? 'destructive' : 'default'}
				>
					{isBusy ? 'Archiving…' : 'Archive'}
				</Button>
			</div>
		</>
	);
}
