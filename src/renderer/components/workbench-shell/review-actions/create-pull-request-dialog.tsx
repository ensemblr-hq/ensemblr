import { useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Textarea } from '@/renderer/components/ui/textarea';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

export interface CreatePullRequestInput {
	body: string;
	draft: boolean;
	title: string;
}

/** Dialog collecting PR title/body before running the gh create flow. */
export function CreatePullRequestDialog({
	initialDraft,
	isSubmitting,
	onOpenChange,
	onSubmit,
	open,
	workspace,
}: {
	initialDraft: boolean;
	isSubmitting: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: CreatePullRequestInput) => void;
	open: boolean;
	workspace: WorkspaceShellModel;
}) {
	const baseBranch =
		workspace.landingSummary?.branchSource.baseBranch ?? 'default branch';
	const hasUncommitted = workspace.changeSummary.files > 0;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='sm:max-w-lg'>
				<DialogHeader>
					<DialogTitle>Create pull request</DialogTitle>
					<DialogDescription>
						<span className='font-mono'>{workspace.branchName}</span> →{' '}
						<span className='font-mono'>{baseBranch}</span>
						{hasUncommitted
							? ` — ${workspace.changeSummary.files} uncommitted file${
									workspace.changeSummary.files === 1 ? '' : 's'
								} will be committed and pushed first.`
							: ''}
					</DialogDescription>
				</DialogHeader>
				<CreatePullRequestForm
					initialDraft={initialDraft}
					initialTitle={workspace.name}
					isSubmitting={isSubmitting}
					onCancel={() => onOpenChange(false)}
					onSubmit={onSubmit}
				/>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Form state lives here, inside DialogContent, so Radix unmounting the closed
 * dialog resets the fields on every open without effect-based syncing.
 */
function CreatePullRequestForm({
	initialDraft,
	initialTitle,
	isSubmitting,
	onCancel,
	onSubmit,
}: {
	initialDraft: boolean;
	initialTitle: string;
	isSubmitting: boolean;
	onCancel: () => void;
	onSubmit: (input: CreatePullRequestInput) => void;
}) {
	const [title, setTitle] = useState(initialTitle);
	const [body, setBody] = useState('');
	const [draft, setDraft] = useState(initialDraft);

	return (
		<>
			<div className='flex flex-col gap-3'>
				<Input
					aria-label='Pull request title'
					autoFocus
					onChange={(event) => setTitle(event.target.value)}
					placeholder='Pull request title'
					value={title}
				/>
				<Textarea
					aria-label='Pull request description'
					onChange={(event) => setBody(event.target.value)}
					placeholder='Describe the change…'
					rows={5}
					value={body}
				/>
				<div className='flex items-center gap-2'>
					<Checkbox
						checked={draft}
						id='create-pr-draft'
						onCheckedChange={(checked) => setDraft(checked === true)}
					/>
					<Label className='text-xs' htmlFor='create-pr-draft'>
						Create as draft
					</Label>
				</div>
			</div>
			<DialogFooter>
				<Button disabled={isSubmitting} onClick={onCancel} variant='ghost'>
					Cancel
				</Button>
				<Button
					disabled={isSubmitting || title.trim().length === 0}
					onClick={() => onSubmit({ body, draft, title: title.trim() })}
				>
					{isSubmitting ? 'Creating…' : draft ? 'Create draft PR' : 'Create PR'}
				</Button>
			</DialogFooter>
		</>
	);
}
