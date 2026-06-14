import type { ReactNode } from 'react';

import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { formatCount } from '@/renderer/lib/format';
import type { ChecksPanelState } from '@/renderer/types/components';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { ChecksEmptyMessage, ChecksSectionHeader } from './pr-metadata';
import { ChecksActionRow } from './pr-rows';
import { ChecksPanelSummary } from './summary';

export { ChecksEmptyMessage };

/** Empty-state shown when the workspace has no PR yet. */
export function ChecksNoPullRequestState({
	onCommitAndPush,
	onCreatePullRequest,
	state,
	todoSection,
	workspace,
}: {
	onCommitAndPush?: () => void;
	onCreatePullRequest?: () => void;
	state: Extract<ChecksPanelState, { hasPullRequest: false }>;
	todoSection?: ReactNode;
	workspace: WorkspaceShellModel;
}) {
	const hasChanges = state.kind === 'uncommitted';

	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'>
				{workspace.pullRequest.syncError ? (
					<div className='rounded-md border border-status-danger/40 bg-pane px-3 py-2 text-status-danger text-xs leading-5'>
						GitHub refresh failed: {workspace.pullRequest.syncError}
					</div>
				) : null}
				<ChecksPanelSummary state={state} />

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Git status' />
					<ChecksActionRow
						actionLabel={hasChanges ? 'Create PR' : undefined}
						label='No PR open'
						onAction={onCreatePullRequest}
					/>
					{hasChanges ? (
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

				{todoSection ?? (
					<section className='flex min-w-0 flex-col gap-1.5'>
						<ChecksSectionHeader actionLabel='+ Add' label='Your todos' />
						<ChecksEmptyMessage label='No todos yet' />
					</section>
				)}
			</div>
		</ScrollArea>
	);
}
