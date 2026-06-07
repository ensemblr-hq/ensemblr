import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { getChecksPanelState } from '@/renderer/lib/workbench/checks-panel-state';
import type { ChecksPanelState } from '@/renderer/types/components';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { ChecksEmptyMessage, ChecksNoPullRequestState } from './empty-states';
import { ChecksSectionHeader, PullRequestMetadata } from './pr-metadata';
import {
	PullRequestCheckRow,
	PullRequestCommentRow,
	PullRequestPreviewDeploymentRow,
	PullRequestStatusRow,
	PullRequestTodoRow,
} from './pr-rows';
import { ChecksPanelSummary } from './summary';

/** Review-panel "Checks" tab — renders PR metadata, statuses, comments and todos. */
export function ChecksPanel({ workspace }: { workspace: WorkspaceShellModel }) {
	const panelState = getChecksPanelState(workspace);

	if (!panelState.hasPullRequest) {
		return (
			<ChecksNoPullRequestState state={panelState} workspace={workspace} />
		);
	}

	return <ChecksPullRequestPanel state={panelState} />;
}

/** Body of the checks panel when a pull request exists. */
function ChecksPullRequestPanel({
	state,
}: {
	state: Extract<ChecksPanelState, { hasPullRequest: true }>;
}) {
	const { pullRequest } = state;
	const showGitStatusAction = state.kind !== 'pr-ready';

	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'>
				<ChecksPanelSummary state={state} />
				<PullRequestMetadata pullRequest={pullRequest} />

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Git status' />
					<PullRequestStatusRow
						hideAction={!showGitStatusAction}
						status={pullRequest.gitStatus}
					/>
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Checks' />
					{pullRequest.checks.length ? (
						pullRequest.checks.map((check) => (
							<PullRequestCheckRow check={check} key={check.id} />
						))
					) : (
						<ChecksEmptyMessage label='No checks reported yet' />
					)}
				</section>

				{pullRequest.previewDeployment ? (
					<section className='flex min-w-0 flex-col gap-1.5'>
						<ChecksSectionHeader label='Deployments' />
						<PullRequestPreviewDeploymentRow
							deployment={pullRequest.previewDeployment}
						/>
					</section>
				) : null}

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader
						actionLabel={
							pullRequest.comments.length ? 'Add all to chat' : undefined
						}
						label='Comments'
					/>
					{pullRequest.comments.length ? (
						pullRequest.comments.map((comment) => (
							<PullRequestCommentRow comment={comment} key={comment.id} />
						))
					) : (
						<ChecksEmptyMessage label='No comments yet' />
					)}
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader actionLabel='+ Add' label='Your todos' />
					{pullRequest.todos.length ? (
						pullRequest.todos.map((todo) => (
							<PullRequestTodoRow key={todo.id} todo={todo} />
						))
					) : (
						<ChecksEmptyMessage label='No todos yet' />
					)}
				</section>
			</div>
		</ScrollArea>
	);
}
