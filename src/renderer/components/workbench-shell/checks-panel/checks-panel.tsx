import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom, useSetAtom } from 'jotai';
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { toast } from 'sonner';

import {
	deleteReviewTodo,
	ensemblrQueryKeys,
	reviewCommentsQuery,
	saveReviewTodo,
} from '@/renderer/api/ensemblr-queries';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useReviewableChanges } from '@/renderer/hooks/workbench-shell/review-files/use-reviewable-changes';
import { getChecksPanelState } from '@/renderer/lib/workbench/checks-panel-state';
import { buildCommitAndPushPrompt } from '@/renderer/lib/workbench/checks-pr-prompts';
import { selectLocalReviewComments } from '@/renderer/lib/workbench/local-review-comments';
import {
	prDraftIdentity,
	seedPrDetails,
} from '@/renderer/lib/workbench/pr-details-draft';
import {
	formatAllCommentsContext,
	formatCommentContext,
	formatTodoContext,
} from '@/renderer/lib/workbench/review-context';
import {
	useComposerInsert,
	useComposerSubmit,
} from '@/renderer/state/composer';
import {
	prDetailsDraftAtomFamily,
	prDetailsLiveDraftAtomFamily,
} from '@/renderer/state/preferences';
import type { ChecksPanelState } from '@/renderer/types/components';
import type {
	PullRequestCommentSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { useCommentPreviewOpener } from '../conversation-panel/file-preview-context';
import { useReviewActions } from '../review-actions/review-actions-context';
import { ChecksEmptyMessage, ChecksNoPullRequestState } from './empty-states';
import { PrDetailsForm } from './pr-details-form';
import { ChecksSectionHeader } from './pr-metadata';
import {
	PullRequestCheckRow,
	PullRequestCommentRow,
	PullRequestStatusRow,
	PullRequestTodoRow,
} from './pr-rows';

/** Editable PR title/description draft plus its save/discard controls. */
interface PrDetailsFormState {
	canSave: boolean;
	description: string;
	discard: () => void;
	isDirty: boolean;
	save: () => void;
	setDescription: (value: string) => void;
	setTitle: (value: string) => void;
	title: string;
}

/**
 * Owns the editable PR title/description. The committed values persist locally
 * per workspace (Save); until the user saves, the inputs seed from the open PR.
 * Editing lives in local state so Discard reverts to the saved (or seeded)
 * baseline, and re-seeds untouched fields when the workspace, PR, or hydrated
 * baseline changes while preserving local edits across background gh refreshes.
 */
function usePrDetailsDraft(workspace: WorkspaceShellModel): PrDetailsFormState {
	const [saved, setSaved] = useAtom(prDetailsDraftAtomFamily(workspace.id));
	const publishLiveDraft = useSetAtom(
		prDetailsLiveDraftAtomFamily(workspace.id),
	);
	const baseline = saved ?? seedPrDetails(workspace);
	const identity = prDraftIdentity(workspace);
	const baselineEdit = {
		baselineDescription: baseline.description,
		baselineTitle: baseline.title,
		description: baseline.description,
		identity,
		title: baseline.title,
	};

	const [edit, setEdit] = useState(() => baselineEdit);
	if (edit.identity !== identity) {
		setEdit(baselineEdit);
	} else if (
		edit.baselineTitle !== baseline.title ||
		edit.baselineDescription !== baseline.description
	) {
		const isDescriptionDirty = edit.description !== edit.baselineDescription;
		const isTitleDirty = edit.title !== edit.baselineTitle;
		setEdit({
			baselineDescription: baseline.description,
			baselineTitle: baseline.title,
			description: isDescriptionDirty ? edit.description : baseline.description,
			identity,
			title: isTitleDirty ? edit.title : baseline.title,
		});
	}

	// Publish live edits so other surfaces (the sidebar "Create PR" menu) hand the
	// agent the same title/description shown here, not just the last Saved draft.
	useEffect(() => {
		publishLiveDraft({
			description: edit.description,
			identity: edit.identity,
			title: edit.title,
		});
	}, [edit, publishLiveDraft]);

	const isDirty =
		edit.title !== baseline.title || edit.description !== baseline.description;

	return {
		canSave: isDirty && edit.title.trim().length > 0,
		description: edit.description,
		discard: () => setEdit(baselineEdit),
		isDirty,
		save: () => {
			if (edit.title.trim().length === 0) {
				return;
			}
			setSaved({ description: edit.description, title: edit.title });
		},
		setDescription: (description) =>
			setEdit((current) => ({ ...current, description })),
		setTitle: (title) => setEdit((current) => ({ ...current, title })),
		title: edit.title,
	};
}

/** Review-panel "Checks" tab — renders PR metadata, statuses, comments and todos. */
export function ChecksPanel({ workspace }: { workspace: WorkspaceShellModel }) {
	const panelState = getChecksPanelState(workspace);
	const todoActions = useTodoActions(workspace.id);
	const submitToComposer = useComposerSubmit();
	const reviewActions = useReviewActions();
	const draft = usePrDetailsDraft(workspace);
	const { data: reviewCommentsData } = useQuery(
		reviewCommentsQuery(workspace.id),
	);
	const localComments = useMemo(
		() => selectLocalReviewComments(reviewCommentsData?.comments ?? []),
		[reviewCommentsData],
	);
	// "Create PR" stays available whenever the branch differs from base, even with
	// a clean worktree once edits are committed.
	const canCreatePullRequest = useReviewableChanges(workspace);

	const sendCommitAndPush = useCallback(() => {
		submitToComposer(buildCommitAndPushPrompt(workspace));
		toast.success('Asked the agent to commit and push.');
	}, [submitToComposer, workspace]);

	const sendCreatePullRequest = useCallback(() => {
		reviewActions?.runAgentAction('create-pr');
		toast.success(
			workspace.pullRequest.number
				? 'Asked the agent to update the pull request.'
				: 'Asked the agent to open a pull request.',
		);
	}, [reviewActions, workspace.pullRequest.number]);

	const prForm = (
		<PrDetailsForm
			canSave={draft.canSave}
			description={draft.description}
			isDirty={draft.isDirty}
			isReadOnly={workspace.pullRequest.state === 'merged'}
			onDescriptionChange={draft.setDescription}
			onDiscard={draft.discard}
			onSave={draft.save}
			onTitleChange={draft.setTitle}
			title={draft.title}
		/>
	);

	if (!panelState.hasPullRequest) {
		return (
			<ChecksNoPullRequestState
				canCreatePullRequest={canCreatePullRequest}
				commentsSection={
					localComments.length ? (
						<CommentsSection
							comments={localComments}
							workspaceId={workspace.id}
						/>
					) : undefined
				}
				onCommitAndPush={sendCommitAndPush}
				onCreatePullRequest={sendCreatePullRequest}
				state={panelState}
				todoSection={
					<TodoSection
						todoActions={todoActions}
						todos={workspace.pullRequest.todos}
					/>
				}
				workspace={workspace}
			>
				{prForm}
			</ChecksNoPullRequestState>
		);
	}

	return (
		<ChecksPullRequestPanel
			localComments={localComments}
			onCommitAndPush={sendCommitAndPush}
			onUpdatePullRequest={sendCreatePullRequest}
			state={panelState}
			todoActions={todoActions}
			workspace={workspace}
		>
			{prForm}
		</ChecksPullRequestPanel>
	);
}

/** Callbacks for adding, removing, and toggling review todos. */
interface TodoActions {
	addTodo: (title: string) => void;
	removeTodo: (id: string) => void;
	toggleTodo: (input: { id: string; nextDone: boolean }) => void;
}

/**
 * Show an error toast when a todo mutation fails.
 * @param error - The thrown error, if any.
 */
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
				queryKey: ensemblrQueryKeys.reviewTodos(workspaceId),
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
				queryKey: ensemblrQueryKeys.reviewTodos(workspaceId),
			}),
	});
	const removeMutation = useMutation({
		mutationFn: (id: string) => deleteReviewTodo({ id }),
		onError,
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.reviewTodos(workspaceId),
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
	children,
	localComments,
	onCommitAndPush,
	onUpdatePullRequest,
	state,
	todoActions,
	workspace,
}: {
	children: ReactNode;
	/** Ensemblr-local review comments, merged into the Comments section. */
	localComments: readonly PullRequestCommentSummary[];
	onCommitAndPush: () => void;
	onUpdatePullRequest: () => void;
	state: Extract<ChecksPanelState, { hasPullRequest: true }>;
	todoActions: TodoActions;
	workspace: WorkspaceShellModel;
}) {
	const { pullRequest } = state;
	const insertIntoComposer = useComposerInsert();
	const showGitStatusAction = state.kind !== 'pr-ready';
	// A merged/closed PR has no actionable git status, so the section is hidden.
	const isClosedOrMerged =
		pullRequest.state === 'merged' || pullRequest.state === 'closed';

	// GitHub review comments first, then the user's own local notes.
	const comments = useMemo(
		() => [...pullRequest.comments, ...localComments],
		[pullRequest.comments, localComments],
	);

	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div
				className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'
				data-checks-panel-state={state.kind}
			>
				{pullRequest.syncError ? (
					<div className='rounded-md border border-status-danger/40 bg-pane px-3 py-2 text-status-danger text-xs leading-5'>
						GitHub refresh failed: {pullRequest.syncError}
					</div>
				) : null}
				{children}

				{isClosedOrMerged ? null : (
					<section className='flex min-w-0 flex-col gap-1.5'>
						<ChecksSectionHeader
							actionLabel='Update PR'
							label='Git status'
							onAction={onUpdatePullRequest}
						/>
						<PullRequestStatusRow
							hideAction={!showGitStatusAction}
							onAction={onCommitAndPush}
							status={pullRequest.gitStatus}
						/>
					</section>
				)}

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Checks' />
					{pullRequest.checks.length ? (
						pullRequest.checks.map((check) => (
							<PullRequestCheckRow check={check} key={check.id} />
						))
					) : (
						<ChecksEmptyMessage label='No checks reported' />
					)}
				</section>

				<CommentsSection
					comments={comments}
					prNumber={pullRequest.number}
					workspaceId={workspace.id}
				/>

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

/**
 * "Comments" section listing GitHub review comments and Ensemblr-local notes
 * together. Each row opens a read-only preview, adds itself to chat, or hides for
 * the session; the header adds every visible comment to chat at once. Session
 * hides are keyed by workspace so they never leak across a workspace switch.
 */
function CommentsSection({
	comments,
	prNumber,
	workspaceId,
}: {
	comments: readonly PullRequestCommentSummary[];
	prNumber?: number;
	workspaceId: string;
}) {
	const insertIntoComposer = useComposerInsert();
	const openCommentPreview = useCommentPreviewOpener();

	const [hidden, setHidden] = useState(() => ({
		ids: new Set<string>(),
		workspaceId,
	}));
	if (hidden.workspaceId !== workspaceId) {
		setHidden({ ids: new Set<string>(), workspaceId });
	}
	const visibleComments = comments.filter(
		(comment) => !hidden.ids.has(comment.id),
	);

	const addCommentToChat = (comment: PullRequestCommentSummary) => {
		insertIntoComposer(formatCommentContext(comment, prNumber));
		toast.success('Comment added to chat.');
	};
	const hideComment = (id: string) => {
		setHidden((current) => ({
			ids: new Set(current.ids).add(id),
			workspaceId: current.workspaceId,
		}));
	};

	return (
		<section className='flex min-w-0 flex-col gap-1.5'>
			<ChecksSectionHeader
				actionLabel={visibleComments.length ? 'Add all to chat' : undefined}
				label='Comments'
				onAction={() => {
					insertIntoComposer(
						formatAllCommentsContext(visibleComments, prNumber),
					);
					toast.success('All comments added to chat.');
				}}
			/>
			{visibleComments.length ? (
				visibleComments.map((comment) => (
					<PullRequestCommentRow
						comment={comment}
						key={comment.id}
						onAddToChat={() => addCommentToChat(comment)}
						onHide={() => hideComment(comment.id)}
						onOpenPreview={
							openCommentPreview
								? () => openCommentPreview({ comment, prNumber })
								: undefined
						}
					/>
				))
			) : (
				<ChecksEmptyMessage label='No comments yet' />
			)}
		</section>
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
