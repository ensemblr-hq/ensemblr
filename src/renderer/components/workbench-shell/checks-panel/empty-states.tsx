import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { PanelAlert } from '@/renderer/components/workbench-shell/panel-alert';
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
	conflictsSection,
	isAgentWorking = false,
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
	/** Conflicts section, omitted when the branch merges cleanly. */
	conflictsSection?: ReactNode;
	/** Freezes the git actions while an agent turn is in flight. */
	isAgentWorking?: boolean;
	onCommitAndPush?: () => void;
	onCreatePullRequest?: () => void;
	state: Extract<ChecksPanelState, { hasPullRequest: false }>;
	todoSection?: ReactNode;
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
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
					<PanelAlert
						{...workspace.pullRequest.syncError}
						title={t(
							'review:checks.sync-error.title',
							'Could not refresh from GitHub',
						)}
					/>
				) : null}
				{children}

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader
						label={t('review:checks.git-status', 'Git status')}
					/>
					<ChecksActionRow
						actionLabel={
							canCreatePullRequest
								? t('git:pull-request.create-action', 'Create PR')
								: undefined
						}
						disabled={isAgentWorking}
						label={t('review:checks.no-pull-request', 'No PR open')}
						onAction={onCreatePullRequest}
					/>
					{hasUncommittedChanges ? (
						<ChecksActionRow
							actionLabel={t('git:actions.commit-and-push', 'Commit and push')}
							disabled={isAgentWorking}
							label={t('review:checks.uncommitted-change-count', {
								count: workspace.changeSummary.files,
								defaultValue_one: '{{count}} uncommitted change',
								defaultValue_other: '{{count}} uncommitted changes',
							})}
							onAction={onCommitAndPush}
						/>
					) : null}
				</section>

				{conflictsSection}

				{commentsSection}

				{todoSection ?? (
					<section className='flex min-w-0 flex-col gap-1.5'>
						<ChecksSectionHeader
							label={t('review:checks.todos', 'Your todos')}
						/>
						<ChecksEmptyMessage
							label={t('review:checks.no-todos', 'No todos yet')}
						/>
					</section>
				)}
			</div>
		</ScrollArea>
	);
}
