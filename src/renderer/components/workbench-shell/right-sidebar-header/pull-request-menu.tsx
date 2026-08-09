import {
	ExternalLinkIcon,
	GitMergeConflictIcon,
	GitMergeIcon,
	MoreVerticalIcon,
	RefreshCwIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';

import { useReviewActions } from '../review-actions/review-actions-context';

/**
 * Overflow menu for a pull request with nothing more urgent to offer: hand the
 * conflicts to the agent, refresh the gh snapshot, open it on GitHub, or start
 * the merge confirmation.
 *
 * Conflicts swap the merge entry for the resolve one rather than offering both.
 * The other things that block a merge — a failing check, a requested change —
 * can still be merged past by someone with the rights to; a conflict cannot, so
 * offering it would spend a confirmation dialog and a round-trip to `gh` on a
 * refusal the snapshot already predicted.
 */
export function PullRequestMenu({
	hasConflicts = false,
	url,
}: {
	/** Swaps the merge action for the resolve one; merging cannot succeed. */
	hasConflicts?: boolean;
	url?: string;
}) {
	const { t } = useTranslation();
	const reviewActions = useReviewActions();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size='icon-sm' variant='ghost'>
					<MoreVerticalIcon />
					<span className='sr-only'>
						{t('git:pull-request-menu.label', 'Open pull request menu')}
					</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-auto whitespace-nowrap'>
				{hasConflicts ? (
					<DropdownMenuItem
						disabled={reviewActions?.isAgentWorking}
						onSelect={() => reviewActions?.runAgentAction('resolve-conflicts')}
					>
						<GitMergeConflictIcon aria-hidden='true' />
						{t('git:pull-request-menu.resolve-conflicts', 'Resolve conflicts')}
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem
					disabled={reviewActions?.isRefreshingPullRequest}
					onSelect={() => reviewActions?.refreshPullRequest()}
				>
					<RefreshCwIcon aria-hidden='true' />
					{t('git:pull-request-menu.refresh', 'Refresh PR status')}
				</DropdownMenuItem>
				{url ? (
					<DropdownMenuItem asChild>
						<a href={url} rel='noreferrer' target='_blank'>
							<ExternalLinkIcon aria-hidden='true' />
							{t('git:pull-request-menu.open-on-github', 'Open on GitHub')}
						</a>
					</DropdownMenuItem>
				) : null}
				{hasConflicts ? null : (
					<DropdownMenuItem
						onSelect={() => reviewActions?.openMergeConfirmation()}
					>
						<GitMergeIcon aria-hidden='true' />
						Merge…
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
