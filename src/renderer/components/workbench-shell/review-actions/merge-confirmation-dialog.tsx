import { GitMergeIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * Conductor-style final merge confirmation (ADR 0023). Summarizes branch, PR,
 * check state, unresolved comments/todos, and post-merge archive behavior.
 * Merge runs only from this dialog — never directly from the header button.
 */
export function MergeConfirmationDialog({
	archiveAfterMerge,
	deleteLocalBranchOnArchive,
	isSubmitting,
	onConfirm,
	onOpenChange,
	open,
	workspace,
}: {
	archiveAfterMerge: boolean;
	deleteLocalBranchOnArchive: boolean;
	isSubmitting: boolean;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	workspace: WorkspaceShellModel;
}) {
	const { pullRequest } = workspace;
	const failingChecks = pullRequest.checks.filter(
		(check) => check.status === 'blocked',
	);
	const pendingChecks = pullRequest.checks.filter(
		(check) => check.status === 'pending',
	);
	const unresolvedComments = pullRequest.comments.filter(
		(comment) => comment.isResolved === false || comment.provider === 'local',
	);
	const openTodos = pullRequest.todos.filter((todo) => todo.status !== 'done');
	const isReady = pullRequest.status === 'ready-to-merge';
	const hasBlockers = failingChecks.length > 0 || pendingChecks.length > 0;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>
						Merge pull request
						{pullRequest.number ? ` #${pullRequest.number}` : ''}
					</DialogTitle>
					<DialogDescription>
						Merges <span className='font-mono'>{workspace.branchName}</span>{' '}
						through <span className='font-mono'>gh pr merge</span>. This action
						is visible to everyone on the repository and cannot be undone from
						Ensemblr.
					</DialogDescription>
				</DialogHeader>
				<ul className='flex flex-col gap-1.5 text-xs'>
					<MergeSummaryRow
						label='Checks'
						tone={hasBlockers ? 'warning' : 'ok'}
						value={
							pullRequest.checks.length === 0
								? 'No checks reported'
								: hasBlockers
									? `${failingChecks.length} failing, ${pendingChecks.length} pending`
									: 'All checks passed'
						}
					/>
					<MergeSummaryRow
						label='Comments'
						tone={unresolvedComments.length ? 'warning' : 'ok'}
						value={
							unresolvedComments.length
								? `${unresolvedComments.length} unresolved`
								: 'No unresolved comments'
						}
					/>
					<MergeSummaryRow
						label='Todos'
						tone={openTodos.length ? 'warning' : 'ok'}
						value={
							openTodos.length ? `${openTodos.length} open` : 'No open todos'
						}
					/>
					<MergeSummaryRow
						label='After merge'
						tone='neutral'
						value={
							archiveAfterMerge
								? deleteLocalBranchOnArchive
									? 'Workspace will be archived and the local branch deleted'
									: 'Workspace will be archived'
								: 'Workspace stays open (archive offered after merge)'
						}
					/>
				</ul>
				{!isReady ? (
					<p className='text-status-danger text-xs'>
						{hasBlockers
							? 'Required checks have not passed. Merging now overrides merge readiness and only succeeds if repository policy allows it.'
							: 'This pull request is not marked ready to merge. Continue only if you are sure.'}
					</p>
				) : null}
				<DialogFooter>
					<Button
						disabled={isSubmitting}
						onClick={() => onOpenChange(false)}
						variant='ghost'
					>
						Cancel
					</Button>
					<Button
						className='bg-status-ok text-primary-foreground hover:bg-status-ok/90'
						disabled={isSubmitting}
						onClick={onConfirm}
					>
						<GitMergeIcon data-icon='inline-start' />
						{isSubmitting
							? 'Merging…'
							: isReady
								? 'Confirm merge'
								: 'Merge anyway'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function MergeSummaryRow({
	label,
	tone,
	value,
}: {
	label: string;
	tone: 'neutral' | 'ok' | 'warning';
	value: string;
}) {
	return (
		<li className='flex items-baseline justify-between gap-3'>
			<span className='shrink-0 text-muted-foreground'>{label}</span>
			<span
				className={
					tone === 'warning'
						? 'text-status-warning'
						: tone === 'ok'
							? 'text-status-ok'
							: 'text-foreground'
				}
			>
				{value}
			</span>
		</li>
	);
}
