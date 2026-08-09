import {
	ArrowUpIcon,
	GitCommitVerticalIcon,
	GitMergeIcon,
	LoaderCircleIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { usePermissionBoundaryLabel } from '@/renderer/hooks/workbench-shell/use-permission-boundary-label';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
} from '@/shared/permissions';

import { useReviewActions } from '../review-actions/review-actions-context';

/**
 * Styling shared by every primary header action, whatever the pull request's
 * tone. Only geometry — the fill comes from the Button's default `bg-primary`
 * variant, which reads white-on-black in light mode and inverts in dark, rather
 * than a status colour that would fight the tinted strip it sits on.
 */
export const HEADER_ACTION_BUTTON_CLASSES = 'h-7 rounded-md px-2.5';

const mergeBoundary = classifyPermissionAction({
	action: 'pull-request-merge',
	mode: DEFAULT_PERMISSION_MODE,
});

/** Trailing-slot spinner standing in for an action that is not offered yet. */
export function HeaderActivitySpinner({ label }: { label: string }) {
	return (
		<output
			aria-label={label}
			className='grid size-7 place-items-center text-muted-foreground'
		>
			<LoaderCircleIcon aria-hidden='true' className='size-4 animate-spin' />
		</output>
	);
}

/** Opens the merge confirmation dialog — the only path to `gh pr merge` (ADR 0023). */
export function MergePullRequestAction() {
	const { t } = useTranslation();
	const mergeBoundaryLabel = usePermissionBoundaryLabel(mergeBoundary.boundary);
	const reviewActions = useReviewActions();

	return (
		<Button
			className={HEADER_ACTION_BUTTON_CLASSES}
			data-permission-boundary={mergeBoundary.boundary}
			onClick={reviewActions?.openMergeConfirmation}
			size='sm'
		>
			<GitMergeIcon data-icon='inline-start' />
			{t('git:actions.merge', 'Merge')}
			<span className='sr-only'>{mergeBoundaryLabel}</span>
		</Button>
	);
}

/** Hands staging, committing, and pushing the worktree to the chat agent. */
export function CommitAndPushAction() {
	const { t } = useTranslation();
	const reviewActions = useReviewActions();

	return (
		<Button
			className={HEADER_ACTION_BUTTON_CLASSES}
			disabled={reviewActions === null}
			onClick={reviewActions?.commitAndPush}
			size='sm'
		>
			<GitCommitVerticalIcon aria-hidden='true' data-icon='inline-start' />
			{t('git:actions.commit-and-push', 'Commit and push')}
		</Button>
	);
}

/** Pushes the branch with git, the one review chore that skips the agent. */
export function PushBranchAction() {
	const { t } = useTranslation();
	const reviewActions = useReviewActions();
	const isPushing = reviewActions?.isPushingBranch === true;

	return (
		<Button
			className={HEADER_ACTION_BUTTON_CLASSES}
			disabled={reviewActions === null || isPushing}
			onClick={reviewActions?.pushBranch}
			size='sm'
		>
			{isPushing ? (
				<LoaderCircleIcon
					aria-hidden='true'
					className='animate-spin'
					data-icon='inline-start'
				/>
			) : (
				<ArrowUpIcon aria-hidden='true' data-icon='inline-start' />
			)}
			{t('git:actions.push', 'Push')}
		</Button>
	);
}
