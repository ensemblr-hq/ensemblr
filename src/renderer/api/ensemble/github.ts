import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { CommitWorkspaceChangesRequest, CommitWorkspaceChangesResult, CreatePullRequestRequest, CreatePullRequestResult, MergePullRequestRequest, MergePullRequestResult, PushWorkspaceBranchRequest, PushWorkspaceBranchResult } from '@/shared/ipc/contracts/github';
import type { DeleteReviewCommentRequest, DeleteReviewCommentResult, DeleteReviewTodoRequest, DeleteReviewTodoResult, SaveReviewCommentRequest, SaveReviewCommentResult, SaveReviewTodoRequest, SaveReviewTodoResult } from '@/shared/ipc/contracts/review-comments';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

const PR_SNAPSHOT_REFETCH_INTERVAL_MS = 30_000;

/** Query options for the workspace's gh-backed PR snapshot, with polling. */
export function pullRequestSnapshotQuery({
	workspaceCwd,
	workspaceId,
}: {
	workspaceCwd: string | null;
	workspaceId: string;
}) {
	return queryOptions({
		enabled: !!workspaceCwd && !!workspaceId,
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemble:get-pull-request-snapshot', usesDatabase: true },
				() =>
					getEnsembleApi().getPullRequestSnapshot({
						workspaceCwd: workspaceCwd ?? '',
						workspaceId,
					}),
			),
		queryKey: ensembleQueryKeys.pullRequestSnapshot(workspaceId),
		refetchInterval: PR_SNAPSHOT_REFETCH_INTERVAL_MS,
		staleTime: 10_000,
	});
}

/** Query options for Ensemble-local review comments. */
export function reviewCommentsQuery(workspaceId: string) {
	return queryOptions({
		enabled: !!workspaceId,
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemble:list-review-comments', usesDatabase: true },
				() => getEnsembleApi().listReviewComments({ workspaceId }),
			),
		queryKey: ensembleQueryKeys.reviewComments(workspaceId),
		staleTime: 5_000,
	});
}

/** Query options for workspace review todos. */
export function reviewTodosQuery(workspaceId: string) {
	return queryOptions({
		enabled: !!workspaceId,
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemble:list-review-todos', usesDatabase: true },
				() => getEnsembleApi().listReviewTodos({ workspaceId }),
			),
		queryKey: ensembleQueryKeys.reviewTodos(workspaceId),
		staleTime: 5_000,
	});
}

export function commitWorkspaceChanges(
	request: CommitWorkspaceChangesRequest,
): Promise<CommitWorkspaceChangesResult> {
	return getEnsembleApi().commitWorkspaceChanges(request);
}

export function pushWorkspaceBranch(
	request: PushWorkspaceBranchRequest,
): Promise<PushWorkspaceBranchResult> {
	return getEnsembleApi().pushWorkspaceBranch(request);
}

export function createPullRequest(
	request: CreatePullRequestRequest,
): Promise<CreatePullRequestResult> {
	return getEnsembleApi().createPullRequest(request);
}

export function mergePullRequest(
	request: MergePullRequestRequest,
): Promise<MergePullRequestResult> {
	return getEnsembleApi().mergePullRequest(request);
}

export function saveReviewComment(
	request: SaveReviewCommentRequest,
): Promise<SaveReviewCommentResult> {
	return getEnsembleApi().saveReviewComment(request);
}

export function deleteReviewComment(
	request: DeleteReviewCommentRequest,
): Promise<DeleteReviewCommentResult> {
	return getEnsembleApi().deleteReviewComment(request);
}

export function saveReviewTodo(
	request: SaveReviewTodoRequest,
): Promise<SaveReviewTodoResult> {
	return getEnsembleApi().saveReviewTodo(request);
}

export function deleteReviewTodo(
	request: DeleteReviewTodoRequest,
): Promise<DeleteReviewTodoResult> {
	return getEnsembleApi().deleteReviewTodo(request);
}
