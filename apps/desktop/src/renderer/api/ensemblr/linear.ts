import {
	keepPreviousData,
	type QueryClient,
	queryOptions,
} from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	CreateLinearCommentRequest,
	CreateLinearCommentResult,
	CreateLinearIssueRequest,
	GetLinearIssueResult,
	GetLinearMetadataResult,
	LinearAuthFailure,
	LinearDisconnectResult,
	LinearLoginResult,
	LinearServiceFailure,
	ListLinearIssuesRequest,
	ListLinearIssuesResult,
	MutateLinearIssueResult,
	UpdateLinearIssueRequest,
} from '@/shared/ipc/contracts/linear';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/** Query options for the Linear connection status snapshot. */
export const linearConnectionQuery = queryOptions({
	/** Fetches the Linear connection status over IPC with call profiling. */
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:linear-connection-status', usesDatabase: true },
			() => getEnsemblrApi().linearConnectionStatus(),
		),
	queryKey: ensemblrQueryKeys.linearConnection(),
	staleTime: 2000,
});

/** Starts the interactive Linear OAuth login flow. */
export function startLinearLogin(): Promise<LinearLoginResult> {
	return getEnsemblrApi().linearStartLogin();
}

/** Cancels a pending Linear OAuth login flow. */
export function cancelLinearLogin(): Promise<void> {
	return getEnsemblrApi().linearCancelLogin();
}

/**
 * Wraps a rejection from this boundary in the envelope every caller already
 * renders. The auth service itself never throws, but the main-process handler
 * parses its payload strictly, so a malformed request rejects the `invoke` — and
 * an unhandled rejection would otherwise leave the surface silent.
 * @param error - The value the IPC call rejected with.
 * @returns The failure envelope to display.
 */
export function unexpectedLinearAuthFailure(error: unknown): LinearAuthFailure {
	return {
		code: 'linear-unknown',
		message: error instanceof Error ? error.message : '',
	};
}

/** Disconnects one Linear account and clears its stored tokens. */
export function disconnectLinear(
	accountId: string,
): Promise<LinearDisconnectResult> {
	return getEnsemblrApi().linearDisconnect({ accountId });
}

/**
 * How often to re-read a Linear list the main process answered from cache while
 * a refresh was still running, so the newer rows arrive without the user acting.
 */
const SYNCING_POLL_MS = 1200;

/**
 * Query options for the cached Linear issue list. `keepPreviousData` holds the
 * current rows on screen while a changed filter or search term loads, because
 * every distinct filter is its own cache entry and the list would otherwise fall
 * back to skeletons on each keystroke.
 */
export function linearIssuesQuery(request: ListLinearIssuesRequest = {}) {
	return queryOptions({
		placeholderData: keepPreviousData,
		queryFn: (): Promise<ListLinearIssuesResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:linear-list-issues', usesDatabase: true },
				() => getEnsemblrApi().linearListIssues(request),
			),
		queryKey: ensemblrQueryKeys.linearIssues(request),
		refetchInterval: (query) =>
			query.state.data?.status === 'ok' && query.state.data.syncing
				? SYNCING_POLL_MS
				: false,
		staleTime: 5000,
	});
}

/**
 * The failure envelope a refresh reports when the IPC call itself rejected. The
 * Linear service answers with a typed failure rather than throwing, so anything
 * that reaches here is the transport under it — a handler that threw before the
 * service ran, or a bridge that has gone away.
 * @param error - What the invoke rejected with.
 * @returns The failure to report in place of the answer.
 */
function transportFailure(error: unknown): LinearServiceFailure {
	return {
		code: 'network',
		message: error instanceof Error ? error.message : String(error),
		retryAfterSeconds: null,
	};
}

/**
 * Re-lists Linear issues with `refresh: true`, bypassing the main process's own
 * freshness window, and writes the answer straight into the cache. Backs every
 * manual refresh: a plain `refetch` re-runs the query function, which asks for a
 * cache-first read and is answered from the same SQLite rows, so the button
 * would otherwise do nothing for the whole window.
 *
 * Never rejects. It stands in for `refetch`, which resolves into query error
 * state rather than throwing, and its callers fire it from click handlers where
 * a rejection would go unhandled.
 * @param queryClient - The app's query client.
 * @param request - Filter whose cache entry to refresh.
 * @returns The freshly listed issues, or a typed failure.
 */
export async function refreshLinearIssues(
	queryClient: QueryClient,
	request: ListLinearIssuesRequest = {},
): Promise<ListLinearIssuesResult> {
	const result = await profileElectronIpcCall(
		{ channel: 'ensemblr:linear-list-issues', usesDatabase: true },
		() => getEnsemblrApi().linearListIssues({ ...request, refresh: true }),
	).catch(
		(error: unknown): ListLinearIssuesResult => ({
			accountFailures: [],
			failure: transportFailure(error),
			issues: [],
			status: 'error',
		}),
	);
	queryClient.setQueryData(ensemblrQueryKeys.linearIssues(request), result);

	return result;
}

/**
 * Query options for one Linear issue with comments. `accountId` is optional
 * because a cached issue already names its account; pass it when the caller
 * knows it, so the read still resolves after the cache has been cleared.
 */
export function linearIssueQuery(id: string, accountId?: string) {
	return queryOptions({
		queryFn: (): Promise<GetLinearIssueResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:linear-get-issue', usesDatabase: true },
				() =>
					getEnsemblrApi().linearGetIssue({
						...(accountId ? { accountId } : {}),
						id,
					}),
			),
		queryKey: ensemblrQueryKeys.linearIssue(id, accountId),
		staleTime: 5000,
	});
}

/**
 * Re-reads one Linear issue with `refresh: true`, so the refresh button reaches
 * Linear rather than the main process's cache. Writes into both cache entries an
 * issue can be held under — the account-scoped one the linked-issue badge reads
 * and the unscoped one the issue page reads — so a refresh from either surface
 * updates the other.
 *
 * Never rejects, for the reason {@link refreshLinearIssues} gives.
 * @param queryClient - The app's query client.
 * @param id - Issue UUID or human identifier.
 * @param accountId - Account owning the issue, when the caller knows it.
 * @returns The freshly read issue, or a typed failure.
 */
export async function refreshLinearIssue(
	queryClient: QueryClient,
	id: string,
	accountId?: string,
): Promise<GetLinearIssueResult> {
	const result = await profileElectronIpcCall(
		{ channel: 'ensemblr:linear-get-issue', usesDatabase: true },
		() =>
			getEnsemblrApi().linearGetIssue({
				...(accountId ? { accountId } : {}),
				id,
				refresh: true,
			}),
	).catch(
		(error: unknown): GetLinearIssueResult => ({
			failure: transportFailure(error),
			status: 'error',
		}),
	);
	queryClient.setQueryData(ensemblrQueryKeys.linearIssue(id), result);

	if (accountId) {
		queryClient.setQueryData(
			ensemblrQueryKeys.linearIssue(id, accountId),
			result,
		);
	}

	return result;
}

/** Query options for cached Linear metadata (teams, states, labels, …). */
export const linearMetadataQuery = queryOptions({
	/** Fetches cached Linear metadata over IPC with call profiling. */
	queryFn: (): Promise<GetLinearMetadataResult> =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:linear-metadata', usesDatabase: true },
			() => getEnsemblrApi().linearMetadata({}),
		),
	queryKey: ensemblrQueryKeys.linearMetadata(),
	refetchInterval: (query) =>
		query.state.data?.status === 'ok' && query.state.data.syncing
			? SYNCING_POLL_MS
			: false,
	staleTime: 30_000,
});

/** Creates a Linear issue through the main-process service. */
export function createLinearIssue(
	request: CreateLinearIssueRequest,
): Promise<MutateLinearIssueResult> {
	return getEnsemblrApi().linearCreateIssue(request);
}

/** Updates a Linear issue through the main-process service. */
export function updateLinearIssue(
	request: UpdateLinearIssueRequest,
): Promise<MutateLinearIssueResult> {
	return getEnsemblrApi().linearUpdateIssue(request);
}

/** Adds a comment to a Linear issue. */
export function createLinearComment(
	request: CreateLinearCommentRequest,
): Promise<CreateLinearCommentResult> {
	return getEnsemblrApi().linearCreateComment(request);
}
