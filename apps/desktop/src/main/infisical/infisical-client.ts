import type {
	InfisicalAccountRecord,
	InfisicalAccountStore,
} from './infisical-account-store.ts';
import {
	type InfisicalAccessToken,
	type InfisicalApiClient,
	InfisicalApiError,
	type InfisicalProjectData,
	type InfisicalSecretData,
	type ListInfisicalSecretsQuery,
} from './infisical-api.ts';

/** Secret listing scoped to an account, with the project half supplied by the link. */
export type InfisicalSecretsQuery = ListInfisicalSecretsQuery;

/**
 * Account-aware boundary over Infisical. Callers name an account; this module
 * resolves its credentials, holds the short-lived access token, and re-logs in
 * when the token expires or is revoked.
 */
export interface InfisicalClient {
	/** Drops any cached token for an account, forcing the next call to log in again. */
	invalidate: (accountId: string) => void;
	listProjects: (accountId: string) => Promise<InfisicalProjectData[]>;
	listSecrets: (input: {
		accountId: string;
		query: InfisicalSecretsQuery;
	}) => Promise<InfisicalSecretData[]>;
	/** Logs in to confirm the stored credentials still work. */
	verify: (accountId: string) => Promise<void>;
}

/** Options for {@link createInfisicalClient}. */
export interface CreateInfisicalClientOptions {
	accountStore: InfisicalAccountStore;
	api: InfisicalApiClient;
	now?: () => number;
}

/**
 * Builds the account-aware Infisical client. Access tokens are short-lived, so
 * they are cached in memory only and never persisted.
 * @param options - Account store, raw API boundary, and injectable clock.
 * @returns A fresh {@link InfisicalClient}.
 */
export function createInfisicalClient({
	accountStore,
	api,
	now = () => Date.now(),
}: CreateInfisicalClientOptions): InfisicalClient {
	const tokensByAccountId = new Map<string, InfisicalAccessToken>();

	/**
	 * Resolves an account record, throwing a typed failure when it is gone.
	 * @param accountId - Account to resolve.
	 * @returns The account record.
	 */
	function requireAccount(accountId: string): InfisicalAccountRecord {
		const account = accountStore.get(accountId);

		if (!account) {
			throw new InfisicalApiError(
				'infisical-account-not-found',
				'That Infisical account is no longer configured.',
			);
		}

		return account;
	}

	/**
	 * Returns a usable access token for an account, logging in when none is
	 * cached or the cached one has expired.
	 * @param account - Account to authenticate.
	 * @returns A valid bearer token.
	 */
	async function resolveAccessToken(
		account: InfisicalAccountRecord,
	): Promise<string> {
		const cached = tokensByAccountId.get(account.id);

		if (cached && cached.expiresAtMs > now()) {
			return cached.token;
		}

		const clientSecret = await accountStore.readClientSecret(account.id);
		const issued = await api.login({
			clientId: account.clientId,
			clientSecret,
			siteUrl: account.siteUrl,
		});

		tokensByAccountId.set(account.id, issued);

		return issued.token;
	}

	/**
	 * Runs an authenticated call, retrying once against a fresh token when the
	 * cached one is rejected — an identity's token can be revoked server-side
	 * well before its stated expiry.
	 * @param accountId - Account to authenticate as.
	 * @param call - Operation to run with a bearer token.
	 * @returns The operation's result.
	 */
	async function withAccessToken<T>(
		accountId: string,
		call: (input: { accessToken: string; siteUrl: string }) => Promise<T>,
	): Promise<T> {
		const account = requireAccount(accountId);
		const accessToken = await resolveAccessToken(account);

		try {
			return await call({ accessToken, siteUrl: account.siteUrl });
		} catch (error) {
			if (!isStaleTokenError(error) || !tokensByAccountId.has(accountId)) {
				throw error;
			}

			tokensByAccountId.delete(accountId);
			const refreshed = await resolveAccessToken(account);

			return call({ accessToken: refreshed, siteUrl: account.siteUrl });
		}
	}

	return {
		invalidate: (accountId) => {
			tokensByAccountId.delete(accountId);
		},

		listProjects: (accountId) =>
			withAccessToken(accountId, (auth) => api.listProjects(auth)),

		listSecrets: ({ accountId, query }) =>
			withAccessToken(accountId, (auth) => api.listSecrets({ ...auth, query })),

		verify: async (accountId) => {
			const account = requireAccount(accountId);

			tokensByAccountId.delete(accountId);
			await resolveAccessToken(account);
		},
	};
}

/**
 * Tests whether a failure means the bearer token itself was rejected, which a
 * fresh login can fix — as opposed to a permission or request problem, which it
 * cannot.
 * @param error - Thrown value.
 * @returns True when retrying with a new token is worthwhile.
 */
function isStaleTokenError(error: unknown): boolean {
	return (
		error instanceof InfisicalApiError &&
		(error.code === 'infisical-invalid-credentials' ||
			error.code === 'infisical-permission-denied')
	);
}
