import {
	ArrowUpIcon,
	GitCommitVerticalIcon,
	GitMergeIcon,
	LoaderCircleIcon,
} from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
	getPermissionBoundaryLabel,
} from '@/shared/permissions';

import { useReviewActions } from '../review-actions/review-actions-context';

/**
 * Styling shared by the two pending git states. Only geometry — the tone comes
 * from the Button's default `bg-primary` variant, which reads white-on-black
 * against the pending strip in dark mode and inverts in light, rather than an
 * amber fill that would fight the tint it sits on.
 */
const PENDING_ACTION_BUTTON_CLASSES = 'h-7 rounded-md px-2.5';

const mergeBoundary = classifyPermissionAction({
	action: 'pull-request-merge',
	mode: DEFAULT_PERMISSION_MODE,
});
const mergeBoundaryLabel = getPermissionBoundaryLabel(mergeBoundary.boundary);

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
	const reviewActions = useReviewActions();

	return (
		<Button
			className='h-7 rounded-md bg-status-ok px-2.5 text-primary-foreground hover:bg-status-ok/90'
			data-permission-boundary={mergeBoundary.boundary}
			onClick={reviewActions?.openMergeConfirmation}
			size='sm'
		>
			<GitMergeIcon data-icon='inline-start' />
			Merge
			<span className='sr-only'>{mergeBoundaryLabel}</span>
		</Button>
	);
}

/** Hands staging, committing, and pushing the worktree to the chat agent. */
export function CommitAndPushAction() {
	const reviewActions = useReviewActions();

	return (
		<Button
			className={PENDING_ACTION_BUTTON_CLASSES}
			disabled={reviewActions === null}
			onClick={reviewActions?.commitAndPush}
			size='sm'
		>
			<GitCommitVerticalIcon aria-hidden='true' data-icon='inline-start' />
			Commit and push
		</Button>
	);
}

/** Pushes the branch with git, the one review chore that skips the agent. */
export function PushBranchAction() {
	const reviewActions = useReviewActions();
	const isPushing = reviewActions?.isPushingBranch === true;

	return (
		<Button
			className={PENDING_ACTION_BUTTON_CLASSES}
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
			Push
		</Button>
	);
}
