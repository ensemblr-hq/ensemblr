import type { ReactNode } from 'react';

import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { formatCount } from '@/renderer/lib/format';
import type { ChecksPanelState } from '@/renderer/types/components';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { ChecksEmptyMessage, ChecksSectionHeader } from './pr-metadata';
import { ChecksActionRow } from './pr-rows';

export { ChecksEmptyMessage };

/** Empty-state shown when the workspace has no PR yet. */
export function ChecksNoPullRequestState({
	canCreatePullRequest = false,
	children,
	commentsSection,
	onCommitAndPush,
	onCreatePullRequest,
	state,
	todoSection,
	workspace,
}: {
	/**
	 * Whether the branch has anything to open a PR from — committed-on-branch or
	 * uncommitted. Gates the "Create PR" action so it survives a clean worktree
	 * with commits ahead of base.
	 */
	canCreatePullRequest?: boolean;
	children?: ReactNode;
	/** Comments section shown when the workspace has local review comments. */
	commentsSection?: ReactNode;
	onCommitAndPush?: () => void;
	onCreatePullRequest?: () => void;
	state: Extract<ChecksPanelState, { hasPullRequest: false }>;
	todoSection?: ReactNode;
	workspace: WorkspaceShellModel;
}) {
	// "Commit and push" only makes sense for uncommitted edits; "Create PR" keys
	// off the wider branch-diff signal instead.
	const hasUncommittedChanges = state.kind === 'uncommitted';

	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div
				className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'
				data-checks-panel-state={state.kind}
			>
				{workspace.pullRequest.syncError ? (
					<div className='rounded-md border border-status-danger/40 bg-pane px-3 py-2 text-status-danger text-xs leading-5'>
						GitHub refresh failed: {workspace.pullRequest.syncError}
					</div>
				) : null}
				{children}

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Git status' />
					<ChecksActionRow
						actionLabel={canCreatePullRequest ? 'Create PR' : undefined}
						label='No PR open'
						onAction={onCreatePullRequest}
					/>
					{hasUncommittedChanges ? (
						<ChecksActionRow
							actionLabel='Commit and push'
							label={formatCount(
								workspace.changeSummary.files,
								'uncommitted change',
							)}
							onAction={onCommitAndPush}
						/>
					) : null}
				</section>

				{commentsSection}

				{todoSection ?? (
					<section className='flex min-w-0 flex-col gap-1.5'>
						<ChecksSectionHeader label='Your todos' />
						<ChecksEmptyMessage label='No todos yet' />
					</section>
				)}
			</div>
		</ScrollArea>
	);
}
