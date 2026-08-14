import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom, useSetAtom } from 'jotai';
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { useTranslation } from 'react-i18next';
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
import { PanelAlert } from '@/renderer/components/workbench-shell/panel-alert';
import { useReviewCommentAttachments } from '@/renderer/hooks/workbench-shell/composer/use-review-comment-attachments';
import { useReviewableChanges } from '@/renderer/hooks/workbench-shell/review-files/use-reviewable-changes';
import { useWorkspaceConflicts } from '@/renderer/hooks/workbench-shell/review-files/use-workspace-conflicts';
import {
	getChecksPanelState,
	resolveGitStatusSection,
} from '@/renderer/lib/workbench/checks-panel-state';
import { describeMergeConflictProbeFailure } from '@/renderer/lib/workbench/git-failure-copy';
import { selectLocalReviewComments } from '@/renderer/lib/workbench/local-review-comments';
import {
	prDraftIdentity,
	seedPrDetails,
} from '@/renderer/lib/workbench/pr-details-draft';
import {
	formatTodoContext,
	isOutstandingComment,
} from '@/renderer/lib/workbench/review-context';
import { useComposerInsert } from '@/renderer/state/composer';
import {
	prDetailsDraftAtomFamily,
	prDetailsLiveDraftAtomFamily,
} from '@/renderer/state/preferences';
import type { ChecksPanelState } from '@/renderer/types/components';
import type {
	PullRequestCommentSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkspaceGitFailure } from '@/shared/ipc/contracts/workspace-git';

import {
	useCommentPreviewOpener,
	useWorkspaceFileDiffOpener,
} from '../conversation-panel/file-preview-context';
import { useReviewActions } from '../review-actions/review-actions-context';
import { ChecksEmptyMessage, ChecksNoPullRequestState } from './empty-states';
import { PrDetailsForm } from './pr-details-form';
import { ChecksSectionHeader } from './pr-metadata';
import {
	PullRequestCheckRow,
	PullRequestCommentRow,
	PullRequestConflictRow,
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
	const { t } = useTranslation();
	const panelState = getChecksPanelState(workspace);
	const todoActions = useTodoActions(workspace.id);
	const reviewActions = useReviewActions();
	const isAgentWorking = reviewActions?.isAgentWorking === true;
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
	const conflicts = useWorkspaceConflicts(workspace);

	const sendCreatePullRequest = useCallback(() => {
		reviewActions?.runAgentAction('create-pr');
		toast.success(
			workspace.pullRequest.number
				? t(
						'git:pull-request-update.asked.title',
						'Asked the agent to update the pull request.',
					)
				: t(
						'git:pull-request-create.asked.title',
						'Asked the agent to open a pull request.',
					),
		);
	}, [reviewActions, t, workspace.pullRequest.number]);

	const sendResolveConflicts = useCallback(() => {
		reviewActions?.runAgentAction('resolve-conflicts');
		toast.success(
			t(
				'git:merge-conflicts.asked.title',
				'Asked the agent to resolve the merge conflicts.',
			),
		);
	}, [reviewActions, t]);

	const conflictsSection =
		conflicts.paths.size || conflicts.error ? (
			<ConflictsSection
				error={conflicts.error}
				isAgentWorking={isAgentWorking}
				onResolve={sendResolveConflicts}
				paths={[...conflicts.paths]}
			/>
		) : undefined;

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
							workspaceCwd={workspace.pathLabel}
							workspaceId={workspace.id}
						/>
					) : undefined
				}
				conflictsSection={conflictsSection}
				isAgentWorking={isAgentWorking}
				onCommitAndPush={reviewActions?.commitAndPush}
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
			conflictsSection={conflictsSection}
			isAgentWorking={isAgentWorking}
			localComments={localComments}
			onCommitAndPush={reviewActions?.commitAndPush}
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

/** Mutations for the "Your todos" section, invalidating the todos query. */
function useTodoActions(workspaceId: string): TodoActions {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const onError = useCallback(
		(error: unknown) =>
			toast.error(t('errors:review-todo.failed.title', 'Todo update failed'), {
				description: error instanceof Error ? error.message : undefined,
			}),
		[t],
	);

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
	conflictsSection,
	isAgentWorking,
	localComments,
	onCommitAndPush,
	onUpdatePullRequest,
	state,
	todoActions,
	workspace,
}: {
	children: ReactNode;
	/** Conflicts section, omitted when the branch merges cleanly. */
	conflictsSection?: ReactNode;
	/** Freezes the git actions while an agent turn is in flight. */
	isAgentWorking: boolean;
	/** Ensemblr-local review comments, merged into the Comments section. */
	localComments: readonly PullRequestCommentSummary[];
	onCommitAndPush?: () => void;
	onUpdatePullRequest: () => void;
	state: Extract<ChecksPanelState, { hasPullRequest: true }>;
	todoActions: TodoActions;
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	const { pullRequest } = state;
	const insertIntoComposer = useComposerInsert();
	const gitStatusSection = resolveGitStatusSection(state);

	// GitHub review comments first, then the user's own local notes. The PR model
	// already projects open local comments into its own list, so those are dropped
	// here rather than rendered twice — `localComments` carries the resolution
	// state and authorship the projection leaves behind.
	const comments = useMemo(
		() => [
			...pullRequest.comments.filter((comment) => comment.provider !== 'local'),
			...localComments,
		],
		[pullRequest.comments, localComments],
	);

	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div
				className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'
				data-checks-panel-state={state.kind}
			>
				{pullRequest.syncError ? (
					<PanelAlert
						{...pullRequest.syncError}
						title={t(
							'review:checks.sync-error.title',
							'Could not refresh from GitHub',
						)}
					/>
				) : null}
				{children}

				{gitStatusSection ? (
					<section className='flex min-w-0 flex-col gap-1.5'>
						<ChecksSectionHeader
							actionLabel={
								gitStatusSection.showUpdateAction
									? t('git:pull-request.update-action', 'Update PR')
									: undefined
							}
							disabled={isAgentWorking}
							label={t('review:checks.git-status', 'Git status')}
							onAction={onUpdatePullRequest}
						/>
						<PullRequestStatusRow
							disabled={isAgentWorking}
							hideAction={!gitStatusSection.showCommitAction}
							onAction={onCommitAndPush}
							status={pullRequest.gitStatus}
						/>
					</section>
				) : null}

				{conflictsSection}

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label={t('review:checks.checks', 'Checks')} />
					{pullRequest.checks.length ? (
						pullRequest.checks.map((check) => (
							<PullRequestCheckRow check={check} key={check.id} />
						))
					) : (
						<ChecksEmptyMessage
							label={t('review:checks.no-checks', 'No checks reported')}
						/>
					)}
				</section>

				<CommentsSection
					comments={comments}
					prNumber={pullRequest.number}
					workspaceCwd={workspace.pathLabel}
					workspaceId={workspace.id}
				/>

				<TodoSection
					onAddToChat={(todo) => {
						insertIntoComposer(formatTodoContext(todo));
						toast.success(
							t('review:todo.added-to-chat.title', 'Todo added to chat.'),
						);
					}}
					todoActions={todoActions}
					todos={workspace.pullRequest.todos}
				/>
			</div>
		</ScrollArea>
	);
}

/**
 * "Conflicts" section naming every file that will not merge with the base, with
 * one action that hands the whole resolution to the agent. Rendered only when
 * there is something to say — a conflict, or the reason the check could not run
 * — so a clean branch never carries a dead section. A probe that failed offers
 * no Resolve action, because it never learned what there is to resolve.
 */
function ConflictsSection({
	error,
	isAgentWorking,
	onResolve,
	paths,
}: {
	/** Why the trial merge could not answer; replaces the rows when set. */
	error?: WorkspaceGitFailure;
	isAgentWorking: boolean;
	onResolve: () => void;
	paths: readonly string[];
}) {
	const { t } = useTranslation();

	return (
		<section className='flex min-w-0 flex-col gap-1.5'>
			<ChecksSectionHeader
				actionLabel={error ? undefined : t('common:actions.resolve', 'Resolve')}
				disabled={isAgentWorking}
				label={t('review:checks.conflicts', 'Conflicts')}
				onAction={onResolve}
			/>
			{error ? (
				<PanelAlert {...describeMergeConflictProbeFailure(error)} />
			) : (
				paths.map((path) => <PullRequestConflictRow key={path} path={path} />)
			)}
		</section>
	);
}

/**
 * "Comments" section listing GitHub review comments and Ensemblr-local notes
 * together. Each row opens a read-only preview, adds itself to chat as a chip, or
 * hides for the session; the header adds every visible *outstanding* comment to
 * chat at once, since a resolved thread is work already done and only dilutes the
 * ask. Session hides are keyed by workspace so they never leak across a switch.
 */
function CommentsSection({
	comments,
	prNumber,
	workspaceCwd,
	workspaceId,
}: {
	comments: readonly PullRequestCommentSummary[];
	prNumber?: number;
	/** Absolute workspace root the comment documents are written under. */
	workspaceCwd: string;
	workspaceId: string;
}) {
	const { t } = useTranslation();
	const { attachComment, attachComments } = useReviewCommentAttachments({
		prNumber,
		workspaceCwd,
	});
	const openCommentPreview = useCommentPreviewOpener();
	const openWorkspaceFileDiff = useWorkspaceFileDiffOpener();

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
	const outstandingComments = visibleComments.filter(isOutstandingComment);

	const hideComment = (id: string) => {
		setHidden((current) => ({
			ids: new Set(current.ids).add(id),
			workspaceId: current.workspaceId,
		}));
	};
	// Working-tree scope, left implicit: that is where local comments were
	// authored and where a GitHub thread's line is most likely still live.
	const jumpToLine = (comment: PullRequestCommentSummary) => {
		const { line, path } = comment;
		if (!openWorkspaceFileDiff || !path || line === undefined) {
			return undefined;
		}
		return () => openWorkspaceFileDiff(path, undefined, { revealLine: line });
	};

	return (
		<section className='flex min-w-0 flex-col gap-1.5'>
			<ChecksSectionHeader
				actionLabel={
					outstandingComments.length
						? t('review:checks.add-all-to-chat', 'Add all to chat')
						: undefined
				}
				label={t('review:checks.comments', 'Comments')}
				onAction={() => {
					attachComments(outstandingComments);
				}}
			/>
			{visibleComments.length ? (
				visibleComments.map((comment) => (
					<PullRequestCommentRow
						comment={comment}
						key={comment.id}
						onAddToChat={() => {
							attachComment(comment);
						}}
						onHide={() => hideComment(comment.id)}
						onJumpToLine={jumpToLine(comment)}
						onOpenPreview={
							openCommentPreview
								? (options) =>
										openCommentPreview({ comment, prNumber, ...options })
								: undefined
						}
					/>
				))
			) : (
				<ChecksEmptyMessage
					label={t('review:checks.no-comments', 'No comments yet')}
				/>
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
	const { t } = useTranslation();
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
				actionLabel={t('review:checks.add-todo', '+ Add')}
				label={t('review:checks.todos', 'Your todos')}
				onAction={() => setIsAdding(true)}
			/>
			{isAdding ? (
				<div className='flex items-center gap-1.5 px-1'>
					<Input
						aria-label={t('review:checks.todo-input-label', 'New todo title')}
						autoFocus
						className='h-7 text-xs'
						onBlur={submitDraft}
						onChange={(event) => setDraftTitle(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
								submitDraft();
							}
							if (event.key === 'Escape') {
								setDraftTitle('');
								setIsAdding(false);
							}
						}}
						placeholder={t('review:checks.todo-placeholder', 'Todo title')}
						value={draftTitle}
					/>
					<Button className='h-7 text-xs' onClick={submitDraft} size='xs'>
						{t('common:actions.add', 'Add')}
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
				<ChecksEmptyMessage
					label={t('review:checks.no-todos', 'No todos yet')}
				/>
			)}
		</section>
	);
}
