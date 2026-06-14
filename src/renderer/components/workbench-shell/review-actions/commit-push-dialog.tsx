import { useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Textarea } from '@/renderer/components/ui/textarea';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/** Confirmation dialog for committing workspace changes and pushing upstream. */
export function CommitPushDialog({
	isSubmitting,
	onOpenChange,
	onSubmit,
	open,
	workspace,
}: {
	isSubmitting: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (message: string) => void;
	open: boolean;
	workspace: WorkspaceShellModel;
}) {
	const fileCount = workspace.changeSummary.files;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Commit and push</DialogTitle>
					<DialogDescription>
						Commits {fileCount} changed file{fileCount === 1 ? '' : 's'} on{' '}
						<span className='font-mono'>{workspace.branchName}</span> and pushes
						to origin.
					</DialogDescription>
				</DialogHeader>
				<CommitPushForm
					isSubmitting={isSubmitting}
					onCancel={() => onOpenChange(false)}
					onSubmit={onSubmit}
				/>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Message state lives here, inside DialogContent, so Radix unmounting the
 * closed dialog resets the field on every open without effect-based syncing.
 */
function CommitPushForm({
	isSubmitting,
	onCancel,
	onSubmit,
}: {
	isSubmitting: boolean;
	onCancel: () => void;
	onSubmit: (message: string) => void;
}) {
	const [message, setMessage] = useState('');

	return (
		<>
			<Textarea
				aria-label='Commit message'
				autoFocus
				onChange={(event) => setMessage(event.target.value)}
				placeholder='Commit message'
				rows={3}
				value={message}
			/>
			<DialogFooter>
				<Button disabled={isSubmitting} onClick={onCancel} variant='ghost'>
					Cancel
				</Button>
				<Button
					disabled={isSubmitting || message.trim().length === 0}
					onClick={() => onSubmit(message.trim())}
				>
					{isSubmitting ? 'Committing…' : 'Commit and push'}
				</Button>
			</DialogFooter>
		</>
	);
}
