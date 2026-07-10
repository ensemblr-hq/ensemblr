import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	CreateLinearCommentRequest,
	CreateLinearCommentResult,
	CreateLinearIssueRequest,
	GetLinearIssueResult,
	GetLinearMetadataResult,
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

/** Disconnects the Linear integration and clears stored tokens. */
export function disconnectLinear(): Promise<LinearDisconnectResult> {
	return getEnsemblrApi().linearDisconnect();
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

/** Query options for one Linear issue with comments. */
export function linearIssueQuery(id: string) {
	return queryOptions({
		queryFn: (): Promise<GetLinearIssueResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:linear-get-issue', usesDatabase: true },
				() => getEnsemblrApi().linearGetIssue({ id }),
			),
		queryKey: ensemblrQueryKeys.linearIssue(id),
		staleTime: 5000,
	});
}

/** Query options for cached Linear metadata (teams, states, labels, …). */
export const linearMetadataQuery = queryOptions({
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
