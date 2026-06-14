import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { CreateLinearCommentRequest, CreateLinearCommentResult, CreateLinearIssueRequest, GetLinearIssueResult, GetLinearMetadataResult, LinearDisconnectResult, LinearLoginResult, ListLinearIssuesRequest, ListLinearIssuesResult, MutateLinearIssueResult, UpdateLinearIssueRequest } from '@/shared/ipc/contracts/linear';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

/** Query options for the Linear connection status snapshot. */
export const linearConnectionQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:linear-connection-status', usesDatabase: true },
			() => getEnsembleApi().linearConnectionStatus(),
		),
	queryKey: ensembleQueryKeys.linearConnection(),
	staleTime: 2000,
});

/** Starts the interactive Linear OAuth login flow. */
export function startLinearLogin(): Promise<LinearLoginResult> {
	return getEnsembleApi().linearStartLogin();
}

/** Cancels a pending Linear OAuth login flow. */
export function cancelLinearLogin(): Promise<void> {
	return getEnsembleApi().linearCancelLogin();
}

/** Disconnects the Linear integration and clears stored tokens. */
export function disconnectLinear(): Promise<LinearDisconnectResult> {
	return getEnsembleApi().linearDisconnect();
}

/** Query options for the cached Linear issue list. */
export function linearIssuesQuery(request: ListLinearIssuesRequest = {}) {
	return queryOptions({
		queryFn: (): Promise<ListLinearIssuesResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemble:linear-list-issues', usesDatabase: true },
				() => getEnsembleApi().linearListIssues(request),
			),
		queryKey: ensembleQueryKeys.linearIssues(request),
		staleTime: 5000,
	});
}

/** Query options for one Linear issue with comments. */
export function linearIssueQuery(id: string) {
	return queryOptions({
		queryFn: (): Promise<GetLinearIssueResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemble:linear-get-issue', usesDatabase: true },
				() => getEnsembleApi().linearGetIssue({ id }),
			),
		queryKey: ensembleQueryKeys.linearIssue(id),
		staleTime: 5000,
	});
}

/** Query options for cached Linear metadata (teams, states, labels, …). */
export const linearMetadataQuery = queryOptions({
	queryFn: (): Promise<GetLinearMetadataResult> =>
		profileElectronIpcCall(
			{ channel: 'ensemble:linear-metadata', usesDatabase: true },
			() => getEnsembleApi().linearMetadata({}),
		),
	queryKey: ensembleQueryKeys.linearMetadata(),
	staleTime: 30_000,
});

/** Creates a Linear issue through the main-process service. */
export function createLinearIssue(
	request: CreateLinearIssueRequest,
): Promise<MutateLinearIssueResult> {
	return getEnsembleApi().linearCreateIssue(request);
}

/** Updates a Linear issue through the main-process service. */
export function updateLinearIssue(
	request: UpdateLinearIssueRequest,
): Promise<MutateLinearIssueResult> {
	return getEnsembleApi().linearUpdateIssue(request);
}

/** Adds a comment to a Linear issue. */
export function createLinearComment(
	request: CreateLinearCommentRequest,
): Promise<CreateLinearCommentResult> {
	return getEnsembleApi().linearCreateComment(request);
}
