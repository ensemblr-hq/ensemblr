import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
	deleteReviewTodo,
	ensembleQueryKeys,
	saveReviewTodo,
} from '@/renderer/api/ensemble-queries';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { getChecksPanelState } from '@/renderer/lib/workbench/checks-panel-state';
import {
	formatAllCommentsContext,
	formatCheckContext,
	formatCommentContext,
	formatTodoContext,
} from '@/renderer/lib/workbench/review-context';
import { useComposerInsert } from '@/renderer/state/composer';
import type { ChecksPanelState } from '@/renderer/types/components';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { AgentActionsMenu } from '../review-actions/agent-actions-menu';
import { useReviewActions } from '../review-actions/review-actions-context';
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
	const reviewActions = useReviewActions();
	const todoActions = useTodoActions(workspace.id);

	if (!panelState.hasPullRequest) {
		return (
			<ChecksNoPullRequestState
				onCommitAndPush={reviewActions?.openCommitAndPush}
				onCreatePullRequest={() => reviewActions?.openCreatePullRequest()}
				state={panelState}
				todoSection={
					<TodoSection
						todoActions={todoActions}
						todos={workspace.pullRequest.todos}
					/>
				}
				workspace={workspace}
			/>
		);
	}

	return (
		<ChecksPullRequestPanel
			state={panelState}
			todoActions={todoActions}
			workspace={workspace}
		/>
	);
}

interface TodoActions {
	addTodo: (title: string) => void;
	removeTodo: (id: string) => void;
	toggleTodo: (input: { id: string; nextDone: boolean }) => void;
}

function notifyTodoUpdateFailed(error: unknown): void {
	toast.error('Todo update failed', {
		description: error instanceof Error ? error.message : undefined,
	});
}

/** Mutations for the "Your todos" section, invalidating the todos query. */
function useTodoActions(workspaceId: string): TodoActions {
	const queryClient = useQueryClient();
	const onError = notifyTodoUpdateFailed;

	const addMutation = useMutation({
		mutationFn: (title: string) => saveReviewTodo({ title, workspaceId }),
		onError,
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.reviewTodos(workspaceId),
			}),
	});
	const toggleMutation = useMutation({
		mutationFn: ({ id, nextDone }: { id: string; nextDone: boolean }) =>
			saveReviewTodo({
				id,
				status: nextDone ? 'done' : 'open',
				workspaceId,
			}),
		onError,
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.reviewTodos(workspaceId),
			}),
	});
	const removeMutation = useMutation({
		mutationFn: (id: string) => deleteReviewTodo({ id }),
		onError,
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.reviewTodos(workspaceId),
			}),
	});

	return useMemo(
		() => ({
			addTodo: addMutation.mutate,
			removeTodo: removeMutation.mutate,
			toggleTodo: toggleMutation.mutate,
		}),
		[addMutation.mutate, removeMutation.mutate, toggleMutation.mutate],
	);
}

/** Body of the checks panel when a pull request exists. */
function ChecksPullRequestPanel({
	state,
	todoActions,
	workspace,
}: {
	state: Extract<ChecksPanelState, { hasPullRequest: true }>;
	todoActions: TodoActions;
	workspace: WorkspaceShellModel;
}) {
	const { pullRequest } = state;
	const insertIntoComposer = useComposerInsert();
	const reviewActions = useReviewActions();
	const showGitStatusAction = state.kind !== 'pr-ready';

	const addCheckToChat = (check: (typeof pullRequest.checks)[number]) => {
		insertIntoComposer(formatCheckContext(check, pullRequest.number));
		toast.success('Check context added to chat.');
	};
	const addCommentToChat = (comment: (typeof pullRequest.comments)[number]) => {
		insertIntoComposer(formatCommentContext(comment, pullRequest.number));
		toast.success('Comment added to chat.');
	};

	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'>
				{pullRequest.syncError ? (
					<div className='rounded-md border border-status-danger/40 bg-pane px-3 py-2 text-status-danger text-xs leading-5'>
						GitHub refresh failed: {pullRequest.syncError}
					</div>
				) : null}
				<ChecksPanelSummary state={state} />
				<div className='flex items-center justify-end'>
					<AgentActionsMenu />
				</div>
				<PullRequestMetadata pullRequest={pullRequest} />

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Git status' />
					<PullRequestStatusRow
						hideAction={!showGitStatusAction}
						onAction={reviewActions?.openCommitAndPush}
						status={pullRequest.gitStatus}
					/>
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Checks' />
					{pullRequest.checks.length ? (
						pullRequest.checks.map((check) => (
							<PullRequestCheckRow
								check={check}
								key={check.id}
								onAddToChat={
									check.status === 'blocked'
										? () => addCheckToChat(check)
										: undefined
								}
							/>
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
				) : (
					<section className='flex min-w-0 flex-col gap-1.5'>
						<ChecksSectionHeader label='Deployments' />
						<ChecksEmptyMessage label='No preview deployments detected' />
					</section>
				)}

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader
						actionLabel={
							pullRequest.comments.length ? 'Add all to chat' : undefined
						}
						label='Comments'
						onAction={() => {
							insertIntoComposer(
								formatAllCommentsContext(
									pullRequest.comments,
									pullRequest.number,
								),
							);
							toast.success('All comments added to chat.');
						}}
					/>
					{pullRequest.comments.length ? (
						pullRequest.comments.map((comment) => (
							<PullRequestCommentRow
								comment={comment}
								key={comment.id}
								onAddToChat={() => addCommentToChat(comment)}
							/>
						))
					) : (
						<ChecksEmptyMessage label='No comments yet' />
					)}
				</section>

				<TodoSection
					onAddToChat={(todo) => {
						insertIntoComposer(formatTodoContext(todo));
						toast.success('Todo added to chat.');
					}}
					todoActions={todoActions}
					todos={workspace.pullRequest.todos}
				/>
			</div>
		</ScrollArea>
	);
}

/** "Your todos" section with inline add, toggle, and delete. */
function TodoSection({
	onAddToChat,
	todoActions,
	todos,
}: {
	onAddToChat?: (
		todo: WorkspaceShellModel['pullRequest']['todos'][number],
	) => void;
	todoActions: TodoActions;
	todos: WorkspaceShellModel['pullRequest']['todos'];
}) {
	const [isAdding, setIsAdding] = useState(false);
	const [draftTitle, setDraftTitle] = useState('');

	const submitDraft = () => {
		const title = draftTitle.trim();
		if (title) {
			todoActions.addTodo(title);
		}
		setDraftTitle('');
		setIsAdding(false);
	};

	return (
		<section className='flex min-w-0 flex-col gap-1.5'>
			<ChecksSectionHeader
				actionLabel='+ Add'
				label='Your todos'
				onAction={() => setIsAdding(true)}
			/>
			{isAdding ? (
				<div className='flex items-center gap-1.5 px-1'>
					<Input
						aria-label='New todo title'
						autoFocus
						className='h-7 text-xs'
						onBlur={submitDraft}
						onChange={(event) => setDraftTitle(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								submitDraft();
							}
							if (event.key === 'Escape') {
								setDraftTitle('');
								setIsAdding(false);
							}
						}}
						placeholder='Todo title'
						value={draftTitle}
					/>
					<Button className='h-7 text-xs' onClick={submitDraft} size='xs'>
						Add
					</Button>
				</div>
			) : null}
			{todos.length ? (
				todos.map((todo) => (
					<PullRequestTodoRow
						key={todo.id}
						onAddToChat={onAddToChat ? () => onAddToChat(todo) : undefined}
						onDelete={() => todoActions.removeTodo(todo.id)}
						onToggle={() =>
							todoActions.toggleTodo({
								id: todo.id,
								nextDone: todo.status !== 'done',
							})
						}
						todo={todo}
					/>
				))
			) : isAdding ? null : (
				<ChecksEmptyMessage label='No todos yet' />
			)}
		</section>
	);
}
