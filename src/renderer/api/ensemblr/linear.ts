import { queryOptions } from '@tanstack/react-query';

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

/** Query options for the cached Linear issue list. */
export function linearIssuesQuery(request: ListLinearIssuesRequest = {}) {
	return queryOptions({
		queryFn: (): Promise<ListLinearIssuesResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:linear-list-issues', usesDatabase: true },
				() => getEnsemblrApi().linearListIssues(request),
			),
		queryKey: ensemblrQueryKeys.linearIssues(request),
		staleTime: 5000,
	});
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

/** Query options for cached Linear metadata (teams, states, labels, …). */
export const linearMetadataQuery = queryOptions({
	/** Fetches cached Linear metadata over IPC with call profiling. */
	queryFn: (): Promise<GetLinearMetadataResult> =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:linear-metadata', usesDatabase: true },
			() => getEnsemblrApi().linearMetadata({}),
		),
	queryKey: ensemblrQueryKeys.linearMetadata(),
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
