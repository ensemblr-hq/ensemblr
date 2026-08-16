import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	AddInfisicalAccountRequest,
	InfisicalAccountMutationResult,
	InfisicalAccountsResult,
	InfisicalFailure,
	InfisicalLinkResult,
	InfisicalLinkScopeRequest,
	InfisicalProjectsResult,
	InfisicalSyncResult,
	SetInfisicalLinkRequest,
} from '@/shared/ipc/contracts/infisical';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Wraps a rejection from this boundary in the envelope every caller already
 * renders. The service itself never throws, but the main-process handlers parse
 * their payload strictly, so a malformed request rejects the `invoke` — and an
 * unhandled rejection would otherwise leave the surface silent. The message is
 * the thrown detail only: the `infisical-unknown` headline the user reads comes
 * from the translated failure map.
 * @param error - The value the IPC call rejected with.
 * @returns The failure envelope to display.
 */
export function unexpectedFailure(error: unknown): InfisicalFailure {
	return {
		code: 'infisical-unknown',
		message: error instanceof Error ? error.message : '',
		retryAfterSeconds: null,
	};
}

/** Query options for the configured Infisical accounts. */
export const infisicalAccountsQuery = queryOptions({
	/** Fetches every configured Infisical account over IPC with call profiling. */
	queryFn: (): Promise<InfisicalAccountsResult> =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:infisical-accounts', usesDatabase: true },
			() => getEnsemblrApi().infisicalAccounts(),
		),
	queryKey: ensemblrQueryKeys.infisicalAccounts(),
	staleTime: 2000,
});

/**
 * Query options for every project reachable across every configured account.
 * One aggregated list means the link picker never asks which account to look
 * in first.
 */
export const infisicalProjectsQuery = queryOptions({
	/** Fetches the aggregated project list over IPC with call profiling. */
	queryFn: (): Promise<InfisicalProjectsResult> =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:infisical-projects', usesDatabase: true },
			() => getEnsemblrApi().infisicalProjects(),
		),
	queryKey: ensemblrQueryKeys.infisicalProjects(),
	staleTime: 30_000,
});

/** Query options for the Infisical link attached to one scope. */
export function infisicalLinkQuery(request: InfisicalLinkScopeRequest) {
	return queryOptions({
		queryFn: (): Promise<InfisicalLinkResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:infisical-link', usesDatabase: true },
				() => getEnsemblrApi().infisicalLink(request),
			),
		queryKey: ensemblrQueryKeys.infisicalLink(request.scope, request.scopeId),
		staleTime: 2000,
	});
}

/** Adds an Infisical account and verifies its credentials once. */
export function addInfisicalAccount(
	request: AddInfisicalAccountRequest,
): Promise<InfisicalAccountMutationResult> {
	return getEnsemblrApi().infisicalAddAccount(request);
}

/** Re-checks that an account's stored credentials still work. */
export function testInfisicalAccount(
	accountId: string,
): Promise<InfisicalAccountMutationResult> {
	return getEnsemblrApi().infisicalTestAccount({ accountId });
}

/** Removes an account and deletes its client secret from the Keychain. */
export function removeInfisicalAccount(
	accountId: string,
): Promise<InfisicalAccountMutationResult> {
	return getEnsemblrApi().infisicalRemoveAccount({ accountId });
}

/** Creates or replaces the Infisical link attached to a scope. */
export function setInfisicalLink(
	request: SetInfisicalLinkRequest,
): Promise<InfisicalLinkResult> {
	return getEnsemblrApi().infisicalSetLink(request);
}

/** Removes the Infisical link attached to a scope and clears its cached values. */
export function clearInfisicalLink(
	request: InfisicalLinkScopeRequest,
): Promise<InfisicalLinkResult> {
	return getEnsemblrApi().infisicalClearLink(request);
}

/** Forces a refetch of a link's secrets, returning the variable names it resolved. */
export function syncInfisicalLink(
	request: InfisicalLinkScopeRequest,
): Promise<InfisicalSyncResult> {
	return getEnsemblrApi().infisicalSync(request);
}
