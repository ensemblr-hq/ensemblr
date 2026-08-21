import type { TFunction } from 'i18next';
import { GitMergeIcon } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

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
 * Final merge confirmation (ADR 0023). Summarizes branch, PR,
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
	const { t } = useTranslation();
	const { pullRequest } = workspace;
	const isReady = pullRequest.status === 'ready-to-merge';
	const { hasBlockers, rows } = summarizeMergeReadiness({
		archiveAfterMerge,
		deleteLocalBranchOnArchive,
		pullRequest,
		t,
	});

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>
						{pullRequest.number
							? t(
									'git:merge-dialog.title-numbered',
									'Merge pull request #{{number}}',
									{ number: pullRequest.number },
								)
							: t('git:merge-dialog.title', 'Merge pull request')}
					</DialogTitle>
					<DialogDescription>
						<Trans
							components={{ mono: <span className='font-mono' /> }}
							defaults='Merges <mono>{{branch}}</mono> through <mono>{{command}}</mono>. This action is visible to everyone on the repository and cannot be undone from Ensemblr.'
							i18nKey='git:merge-dialog.description'
							values={{
								branch: workspace.branchName,
								command: 'gh pr merge',
							}}
						/>
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
							? t(
									'git:merge-dialog.warning-blocked',
									'Required checks have not passed. Merging now overrides merge readiness and only succeeds if repository policy allows it.',
								)
							: t(
									'git:merge-dialog.warning-not-ready',
									'This pull request is not marked ready to merge. Continue only if you are sure.',
								)}
					</p>
				) : null}
				<DialogFooter>
					<Button
						disabled={isSubmitting}
						onClick={() => onOpenChange(false)}
						variant='ghost'
					>
						{t('common:actions.cancel', 'Cancel')}
					</Button>
					<Button
						className='bg-status-ok text-primary-foreground hover:bg-status-ok/90'
						onClick={onConfirm}
						pending={isSubmitting}
					>
						<GitMergeIcon data-icon='inline-start' />
						{mergeButtonLabel({ isReady, t })}
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
 * @param t - The caller's translation function, so the copy follows the UI language
 * @returns The summary rows and the blocking-check flag
 */
function summarizeMergeReadiness({
	archiveAfterMerge,
	deleteLocalBranchOnArchive,
	pullRequest,
	t,
}: {
	archiveAfterMerge: boolean;
	deleteLocalBranchOnArchive: boolean;
	pullRequest: WorkspaceShellModel['pullRequest'];
	t: TFunction;
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
				label: t('git:merge-dialog.checks-label', 'Checks'),
				tone: hasBlockers ? 'warning' : 'ok',
				value: describeChecks({
					failing,
					hasBlockers,
					pending,
					reported: pullRequest.checks.length,
					t,
				}),
			},
			{
				label: t('git:merge-dialog.comments-label', 'Comments'),
				tone: unresolved ? 'warning' : 'ok',
				value: unresolved
					? t('git:merge-dialog.comments-unresolved', {
							count: unresolved,
							defaultValue_one: '{{count}} unresolved',
							defaultValue_other: '{{count}} unresolved',
						})
					: t('git:merge-dialog.comments-clear', 'No unresolved comments'),
			},
			{
				label: t('git:merge-dialog.todos-label', 'Todos'),
				tone: openTodos ? 'warning' : 'ok',
				value: openTodos
					? t('git:merge-dialog.todos-open', {
							count: openTodos,
							defaultValue_one: '{{count}} open',
							defaultValue_other: '{{count}} open',
						})
					: t('git:merge-dialog.todos-clear', 'No open todos'),
			},
			{
				label: t('git:merge-dialog.after-merge-label', 'After merge'),
				tone: 'neutral',
				value: describeArchiveBehavior({
					archiveAfterMerge,
					deleteLocalBranchOnArchive,
					t,
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
 * @param t - The caller's translation function, so the copy follows the UI language
 * @returns The summary sentence
 */
function describeChecks({
	failing,
	hasBlockers,
	pending,
	reported,
	t,
}: {
	failing: number;
	hasBlockers: boolean;
	pending: number;
	reported: number;
	t: TFunction;
}): string {
	if (reported === 0) {
		return t('git:merge-dialog.checks-none', 'No checks reported');
	}
	return hasBlockers
		? t(
				'git:merge-dialog.checks-blocked',
				'{{failing}} failing, {{pending}} pending',
				{
					failing,
					pending,
				},
			)
		: t('git:merge-dialog.checks-passed', 'All checks passed');
}

/**
 * Phrase what happens to the workspace once the merge lands.
 * @param archiveAfterMerge - Whether the workspace is archived once the merge lands
 * @param deleteLocalBranchOnArchive - Whether archiving also deletes the local branch
 * @param t - The caller's translation function, so the copy follows the UI language
 * @returns The summary sentence
 */
function describeArchiveBehavior({
	archiveAfterMerge,
	deleteLocalBranchOnArchive,
	t,
}: {
	archiveAfterMerge: boolean;
	deleteLocalBranchOnArchive: boolean;
	t: TFunction;
}): string {
	if (!archiveAfterMerge) {
		return t(
			'git:merge-dialog.after-merge-stay',
			'Workspace stays open (archive offered after merge)',
		);
	}
	return deleteLocalBranchOnArchive
		? t(
				'git:merge-dialog.after-merge-archive-branch',
				'Workspace will be archived and the local branch deleted',
			)
		: t('git:merge-dialog.after-merge-archive', 'Workspace will be archived');
}

/**
 * Label the confirm button, warning when the merge overrides readiness.
 * @param isReady - Whether the pull request reports as ready to merge
 * @param t - The caller's translation function, so the copy follows the UI language
 * @returns The button label
 */
function mergeButtonLabel({
	isReady,
	t,
}: {
	isReady: boolean;
	t: TFunction;
}): string {
	return isReady
		? t('git:merge-dialog.confirm', 'Confirm merge')
		: t('git:merge-dialog.confirm-override', 'Merge anyway');
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
