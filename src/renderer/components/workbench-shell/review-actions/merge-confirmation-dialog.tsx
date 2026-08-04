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
	const isReady = pullRequest.status === 'ready-to-merge';
	const { hasBlockers, rows } = summarizeMergeReadiness({
		archiveAfterMerge,
		deleteLocalBranchOnArchive,
		pullRequest,
	});

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
					{rows.map((row) => (
						<MergeSummaryRow
							key={row.label}
							label={row.label}
							tone={row.tone}
							value={row.value}
						/>
					))}
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
						{mergeButtonLabel({ isReady, isSubmitting })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** One label/value row of the merge-readiness summary, tinted by tone. */
interface MergeSummaryRowModel {
	label: string;
	tone: 'neutral' | 'ok' | 'warning';
	value: string;
}

/**
 * Summarize a pull request's merge readiness as the rows the dialog lists, plus
 * whether any check blocks the merge (which the warning copy keys off).
 * @param archiveAfterMerge - Whether the workspace is archived once the merge lands
 * @param deleteLocalBranchOnArchive - Whether archiving also deletes the local branch
 * @param pullRequest - The workspace's pull-request model
 * @returns The summary rows and the blocking-check flag
 */
function summarizeMergeReadiness({
	archiveAfterMerge,
	deleteLocalBranchOnArchive,
	pullRequest,
}: {
	archiveAfterMerge: boolean;
	deleteLocalBranchOnArchive: boolean;
	pullRequest: WorkspaceShellModel['pullRequest'];
}): { hasBlockers: boolean; rows: MergeSummaryRowModel[] } {
	const failing = pullRequest.checks.filter(
		(check) => check.status === 'blocked',
	).length;
	const pending = pullRequest.checks.filter(
		(check) => check.status === 'pending',
	).length;
	const unresolved = pullRequest.comments.filter(
		(comment) => comment.isResolved === false || comment.provider === 'local',
	).length;
	const openTodos = pullRequest.todos.filter(
		(todo) => todo.status !== 'done',
	).length;
	const hasBlockers = failing > 0 || pending > 0;

	return {
		hasBlockers,
		rows: [
			{
				label: 'Checks',
				tone: hasBlockers ? 'warning' : 'ok',
				value: describeChecks({
					failing,
					hasBlockers,
					pending,
					reported: pullRequest.checks.length,
				}),
			},
			{
				label: 'Comments',
				tone: unresolved ? 'warning' : 'ok',
				value: unresolved
					? `${unresolved} unresolved`
					: 'No unresolved comments',
			},
			{
				label: 'Todos',
				tone: openTodos ? 'warning' : 'ok',
				value: openTodos ? `${openTodos} open` : 'No open todos',
			},
			{
				label: 'After merge',
				tone: 'neutral',
				value: describeArchiveBehavior({
					archiveAfterMerge,
					deleteLocalBranchOnArchive,
				}),
			},
		],
	};
}

/**
 * Phrase the check summary for the dialog.
 * @param failing - How many checks reported as blocked
 * @param hasBlockers - Whether any check blocks the merge
 * @param pending - How many checks are still running
 * @param reported - How many checks the pull request reported at all
 * @returns The summary sentence
 */
function describeChecks({
	failing,
	hasBlockers,
	pending,
	reported,
}: {
	failing: number;
	hasBlockers: boolean;
	pending: number;
	reported: number;
}): string {
	if (reported === 0) {
		return 'No checks reported';
	}
	return hasBlockers
		? `${failing} failing, ${pending} pending`
		: 'All checks passed';
}

/**
 * Phrase what happens to the workspace once the merge lands.
 * @param archiveAfterMerge - Whether the workspace is archived once the merge lands
 * @param deleteLocalBranchOnArchive - Whether archiving also deletes the local branch
 * @returns The summary sentence
 */
function describeArchiveBehavior({
	archiveAfterMerge,
	deleteLocalBranchOnArchive,
}: {
	archiveAfterMerge: boolean;
	deleteLocalBranchOnArchive: boolean;
}): string {
	if (!archiveAfterMerge) {
		return 'Workspace stays open (archive offered after merge)';
	}
	return deleteLocalBranchOnArchive
		? 'Workspace will be archived and the local branch deleted'
		: 'Workspace will be archived';
}

/**
 * Label the confirm button, warning when the merge overrides readiness.
 * @param isReady - Whether the pull request reports as ready to merge
 * @param isSubmitting - Whether a merge is already in flight
 * @returns The button label
 */
function mergeButtonLabel({
	isReady,
	isSubmitting,
}: {
	isReady: boolean;
	isSubmitting: boolean;
}): string {
	if (isSubmitting) {
		return 'Merging…';
	}
	return isReady ? 'Confirm merge' : 'Merge anyway';
}

/** Tailwind text tone applied to a summary row's value. */
const TONE_CLASS: Record<MergeSummaryRowModel['tone'], string> = {
	neutral: 'text-foreground',
	ok: 'text-status-ok',
	warning: 'text-status-warning',
};

/** Renders one label/value row in the merge confirmation summary, tinted by tone. */
function MergeSummaryRow({ label, tone, value }: MergeSummaryRowModel) {
	return (
		<li className='flex items-baseline justify-between gap-3'>
			<span className='shrink-0 text-muted-foreground'>{label}</span>
			<span className={TONE_CLASS[tone]}>{value}</span>
		</li>
	);
}
