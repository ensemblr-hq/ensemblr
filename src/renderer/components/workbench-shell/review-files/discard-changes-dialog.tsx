import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import {
	discardWorkspaceChanges,
	ensemblrQueryKeys,
} from '@/renderer/api/ensemblr';
import { isEnsemblrApiAvailable } from '@/renderer/api/ensemblr-queries';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';

/** What a confirmed discard will revert. */
export interface DiscardChangesTarget {
	/** Number of distinct changed files (drives single vs bulk copy). */
	fileCount: number;
	/**
	 * Workspace-relative paths to discard. For a rename this carries both the new
	 * path and its `renamedFrom` so the original is restored alongside.
	 */
	paths: string[];
	/** Human label: a file name, or e.g. "all 8 changes". */
	title: string;
}

/**
 * Destructive confirmation for discarding working-tree changes. Tracked files
 * revert to HEAD; new/untracked files are deleted — none of it is recoverable,
 * so the action is always gated behind this dialog.
 */
export function DiscardChangesDialog({
	onOpenChange,
	open,
	target,
	workspaceCwd,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	target: DiscardChangesTarget | null;
	workspaceCwd: string;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='gap-4 sm:max-w-md'>
				{target ? (
					<DiscardChangesDialogForm
						key={target.paths.join('\n')}
						onOpenChange={onOpenChange}
						target={target}
						workspaceCwd={workspaceCwd}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** Inner form that discards a target's working-tree changes and surfaces any failure. */
function DiscardChangesDialogForm({
	onOpenChange,
	target,
	workspaceCwd,
}: {
	onOpenChange: (open: boolean) => void;
	target: DiscardChangesTarget;
	workspaceCwd: string;
}) {
	const queryClient = useQueryClient();
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: () =>
			discardWorkspaceChanges({ paths: target.paths, workspaceCwd }),
		onError: (error) =>
			setErrorMessage(
				error instanceof Error ? error.message : 'Could not discard changes.',
			),
		onSettled: () => {
			// Some files may have been discarded even on partial failure, so refresh
			// both the change set and the lazy file tree regardless of outcome.
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.workspaceGitStatus(workspaceCwd),
			});
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.workspaceFiles(workspaceCwd),
			});
		},
		onSuccess: (result) => {
			if (result.error) {
				setErrorMessage(result.error.message);
				return;
			}
			onOpenChange(false);
		},
	});

	const canDiscard = !mutation.isPending && isEnsemblrApiAvailable();
	const isBulk = target.fileCount > 1;

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	return (
		<>
			<DialogHeader>
				<DialogTitle className='font-medium text-[0.9375rem]'>
					{isBulk ? 'Discard all changes?' : 'Discard changes?'}
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					{isBulk
						? 'Every working-tree change is reverted to the last commit and any new files are deleted. This cannot be undone.'
						: 'The working-tree changes are reverted to the last commit; a new file is deleted. This cannot be undone.'}
				</p>
			</DialogHeader>

			<div className='flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs'>
				<span className='truncate font-mono text-[0.6875rem]'>
					{target.title}
				</span>
				<span className='text-[0.6875rem] text-muted-foreground'>
					{target.fileCount} {target.fileCount === 1 ? 'file' : 'files'}{' '}
					affected
				</span>
			</div>

			{errorMessage ? (
				<p className='text-[0.6875rem] text-status-danger'>{errorMessage}</p>
			) : null}

			<div className='-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
				<Button
					className='h-8'
					disabled={mutation.isPending}
					onClick={handleClose}
					type='button'
					variant='outline'
				>
					Cancel
				</Button>
				<Button
					className='h-8'
					disabled={!canDiscard}
					onClick={() => mutation.mutate()}
					type='button'
					variant='destructive'
				>
					{mutation.isPending ? 'Discarding…' : 'Discard'}
				</Button>
			</div>
		</>
	);
}
