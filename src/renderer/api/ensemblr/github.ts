import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	MergePullRequestRequest,
	MergePullRequestResult,
} from '@/shared/ipc/contracts/github';
import type {
	DeleteReviewCommentRequest,
	DeleteReviewCommentResult,
	DeleteReviewTodoRequest,
	DeleteReviewTodoResult,
	SaveReviewCommentRequest,
	SaveReviewCommentResult,
	SaveReviewTodoRequest,
	SaveReviewTodoResult,
} from '@/shared/ipc/contracts/review-comments';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/** Poll fast while a PR is open — checks, reviews, and merge state move on
 * GitHub's side, out of band from the agent-idle refresh. */
const PR_SNAPSHOT_ACTIVE_INTERVAL_MS = 10_000;
/** Back off when there is no PR or it is already merged/closed. */
const PR_SNAPSHOT_IDLE_INTERVAL_MS = 60_000;

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
				{ channel: 'ensemblr:get-pull-request-snapshot', usesDatabase: true },
				() =>
					getEnsemblrApi().getPullRequestSnapshot({
						workspaceCwd: workspaceCwd ?? '',
						workspaceId,
					}),
			),
		queryKey: ensemblrQueryKeys.pullRequestSnapshot(workspaceId),
		refetchInterval: (query) => {
			const pullRequest = query.state.data?.snapshot?.pullRequest;
			return pullRequest?.state === 'open'
				? PR_SNAPSHOT_ACTIVE_INTERVAL_MS
				: PR_SNAPSHOT_IDLE_INTERVAL_MS;
		},
		staleTime: 5_000,
	});
}

/**
 * Forces a cache-bypassing PR-snapshot fetch (`refresh: true`) and writes the
 * result straight into the query cache. Used by the agent-idle auto-refresh,
 * the manual refresh button, and the create/merge mutations so the panel
 * reflects new PR state immediately instead of waiting for the next poll (and
 * the main-process snapshot TTL, which a plain refetch would hit).
 */
export async function refreshPullRequestSnapshot({
	queryClient,
	workspaceCwd,
	workspaceId,
}: {
	queryClient: QueryClient;
	workspaceCwd: string;
	workspaceId: string;
}): Promise<void> {
	const result = await profileElectronIpcCall(
		{ channel: 'ensemblr:get-pull-request-snapshot', usesDatabase: true },
		() =>
			getEnsemblrApi().getPullRequestSnapshot({
				refresh: true,
				workspaceCwd,
				workspaceId,
			}),
	);
	queryClient.setQueryData(
		ensemblrQueryKeys.pullRequestSnapshot(workspaceId),
		result,
	);
}

/** Query options for Ensemblr-local review comments. */
export function reviewCommentsQuery(workspaceId: string) {
	return queryOptions({
		enabled: !!workspaceId,
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-review-comments', usesDatabase: true },
				() => getEnsemblrApi().listReviewComments({ workspaceId }),
			),
		queryKey: ensemblrQueryKeys.reviewComments(workspaceId),
		staleTime: 5_000,
	});
}

/** Query options for workspace review todos. */
export function reviewTodosQuery(workspaceId: string) {
	return queryOptions({
		enabled: !!workspaceId,
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-review-todos', usesDatabase: true },
				() => getEnsemblrApi().listReviewTodos({ workspaceId }),
			),
		queryKey: ensemblrQueryKeys.reviewTodos(workspaceId),
		staleTime: 5_000,
	});
}

export function mergePullRequest(
	request: MergePullRequestRequest,
): Promise<MergePullRequestResult> {
	return getEnsemblrApi().mergePullRequest(request);
}

export function saveReviewComment(
	request: SaveReviewCommentRequest,
): Promise<SaveReviewCommentResult> {
	return getEnsemblrApi().saveReviewComment(request);
}

export function deleteReviewComment(
	request: DeleteReviewCommentRequest,
): Promise<DeleteReviewCommentResult> {
	return getEnsemblrApi().deleteReviewComment(request);
}

export function saveReviewTodo(
	request: SaveReviewTodoRequest,
): Promise<SaveReviewTodoResult> {
	return getEnsemblrApi().saveReviewTodo(request);
}

export function deleteReviewTodo(
	request: DeleteReviewTodoRequest,
): Promise<DeleteReviewTodoResult> {
	return getEnsemblrApi().deleteReviewTodo(request);
}
