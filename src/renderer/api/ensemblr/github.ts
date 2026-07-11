import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	GetPullRequestSnapshotResult,
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
 * Backoff delays (ms) between retries when a just-created PR has not yet
 * surfaced through `gh pr view`. GitHub's read-after-write consistency can make
 * the first post-creation snapshot come back empty; each entry is one extra
 * attempt, stopping as soon as the PR appears.
 */
const PR_PRESENCE_RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;

/**
 * Forces a cache-bypassing PR-snapshot fetch (`refresh: true`) and writes the
 * result straight into the query cache. Used by the agent-idle auto-refresh,
 * the manual refresh button, and the create/merge mutations so the panel
 * reflects new PR state immediately instead of waiting for the next poll (and
 * the main-process snapshot TTL, which a plain refetch would hit).
 * @returns The freshly fetched snapshot result written into the cache.
 */
export async function refreshPullRequestSnapshot({
	queryClient,
	workspaceCwd,
	workspaceId,
}: {
	queryClient: QueryClient;
	workspaceCwd: string;
	workspaceId: string;
}): Promise<GetPullRequestSnapshotResult> {
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
	return result;
}

/**
 * Resolves after the given delay, or early when the signal aborts, so the retry
 * loop stops promptly if the caller unmounts mid-backoff.
 * @param ms - Milliseconds to wait.
 * @param signal - Optional abort signal that resolves the wait early.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * Forces a PR-snapshot refresh and, when the snapshot still reports no PR,
 * retries with bounded backoff until one appears. Absorbs the read-after-create
 * race where `gh pr view` momentarily returns "no pull requests found" right
 * after an agent runs `gh pr create` — a plain single refresh would cache that
 * false empty and leave the panel blank until the next poll. Each successful
 * attempt re-asserts the snapshot via `setQueryData`, which also heals a
 * concurrent poll that clobbered a good result with a raced empty one. Stops
 * early when the signal aborts (e.g. the caller unmounts), leaving no dangling
 * timer or trailing `gh` fetch.
 * @returns The final snapshot result (the first non-empty one, or the last).
 */
export async function refreshPullRequestSnapshotUntilPresent({
	delaysMs = PR_PRESENCE_RETRY_DELAYS_MS,
	queryClient,
	signal,
	workspaceCwd,
	workspaceId,
}: {
	delaysMs?: readonly number[];
	queryClient: QueryClient;
	signal?: AbortSignal;
	workspaceCwd: string;
	workspaceId: string;
}): Promise<GetPullRequestSnapshotResult> {
	let result = await refreshPullRequestSnapshot({
		queryClient,
		workspaceCwd,
		workspaceId,
	});
	for (const wait of delaysMs) {
		if (result.snapshot?.pullRequest || signal?.aborted) {
			return result;
		}
		await delay(wait, signal);
		if (signal?.aborted) {
			return result;
		}
		result = await refreshPullRequestSnapshot({
			queryClient,
			workspaceCwd,
			workspaceId,
		});
	}
	return result;
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

/**
 * Merges a pull request through the main-process GitHub service.
 * @param request - Pull request identity and merge method
 * @returns Outcome of the merge attempt
 */
export function mergePullRequest(
	request: MergePullRequestRequest,
): Promise<MergePullRequestResult> {
	return getEnsemblrApi().mergePullRequest(request);
}

/**
 * Persists a local review comment through the main-process service.
 * @param request - Comment fields to upsert
 * @returns The saved comment result
 */
export function saveReviewComment(
	request: SaveReviewCommentRequest,
): Promise<SaveReviewCommentResult> {
	return getEnsemblrApi().saveReviewComment(request);
}

/**
 * Deletes a local review comment through the main-process service.
 * @param request - Identifies the comment to delete
 * @returns The deletion result
 */
export function deleteReviewComment(
	request: DeleteReviewCommentRequest,
): Promise<DeleteReviewCommentResult> {
	return getEnsemblrApi().deleteReviewComment(request);
}

/**
 * Persists a local review todo through the main-process service.
 * @param request - Todo fields to upsert
 * @returns The saved todo result
 */
export function saveReviewTodo(
	request: SaveReviewTodoRequest,
): Promise<SaveReviewTodoResult> {
	return getEnsemblrApi().saveReviewTodo(request);
}

/**
 * Deletes a local review todo through the main-process service.
 * @param request - Identifies the todo to delete
 * @returns The deletion result
 */
export function deleteReviewTodo(
	request: DeleteReviewTodoRequest,
): Promise<DeleteReviewTodoResult> {
	return getEnsemblrApi().deleteReviewTodo(request);
}
