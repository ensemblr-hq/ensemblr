import type { DatabaseSync } from 'node:sqlite';

import { type AppLanguage, FALLBACK_LANGUAGE } from '../../shared/i18n.ts';
import type {
	LinearAccountSnapshot,
	LinearConnectionState,
	LinearConnectionSummary,
	LinearDisconnectResult,
	LinearLoginResult,
} from '../../shared/ipc/contracts/linear';
import type { EnsemblrConfigService } from '../config';
import type { SecretStore } from '../secrets';
import type { EnsemblrDatabaseService } from '../storage';
import {
	createLinearAccountStore,
	type LinearAccountRecord,
	type LinearAccountStore,
	toAccountSnapshot,
} from './linear-account-store.ts';
import { LinearAuthError } from './linear-auth-error.ts';
import { formatError, toFailure, truncate } from './linear-auth-failures.ts';
import {
	adoptLegacyConnection,
	nullViewer,
	UNRESOLVED_ORGANIZATION_ID,
	type ViewerIdentity,
} from './linear-legacy-adoption.ts';
import {
	BUILT_IN_LINEAR_CLIENT_ID,
	buildLinearAuthorizeUrl,
	createOauthState,
	createPkcePair,
	DEFAULT_LINEAR_SCOPES,
	LINEAR_REVOKE_URL,
	LINEAR_TOKEN_URL,
	parseOauthCallback,
} from './linear-oauth.ts';
import { startLinearOauthCallbackServer } from './linear-oauth-callback-server.ts';

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
/**
 * User-managed secret for custom confidential OAuth apps. Never written by the
 * app and deliberately survives disconnect, like `app.linear.clientId`. It
 * belongs to the OAuth client rather than to any one account, so it stays
 * app-scoped even though tokens are now per-account.
 */
const CLIENT_SECRET_KEY = 'linear-client-secret';
const EXPIRY_SKEW_MS = 60_000;

/** Linear OAuth client settings declared in `~/.config/ensemblr/config.json`. */
export interface LinearOauthConfig {
	clientId: string;
	scopes: readonly string[];
}

/** Public surface of the Linear auth service. */
export interface LinearAuthService {
	cancelLogin: () => Promise<void>;
	disconnect: (accountId: string) => Promise<LinearDisconnectResult>;
	getAccessToken: (accountId: string) => Promise<string>;
	getConnectionSummary: () => Promise<LinearConnectionSummary>;
	listAccounts: () => Promise<LinearAccountSnapshot[]>;
	startLogin: () => Promise<LinearLoginResult>;
}

/** Options for {@link createLinearAuthService}. */
export interface CreateLinearAuthServiceOptions {
	builtInClientId?: string;
	callbackPorts?: readonly number[];
	callbackTimeoutMs?: number;
	configService: EnsemblrConfigService;
	databaseService: EnsemblrDatabaseService;
	fetchImpl?: typeof fetch;
	/** Language the browser-facing OAuth callback page is served in. */
	getLanguage?: () => AppLanguage;
	idFactory?: () => string;
	now?: () => Date;
	/** Notified after an account's grant is revoked, so caches keyed on it can drop it. */
	onDisconnect?: (accountId: string) => void;
	openExternal: (url: string) => Promise<void>;
	secretStoreFactory: (database: DatabaseSync) => SecretStore | null;
}

/** Normalized OAuth token set returned by the Linear token endpoint. */
interface TokenResponse {
	accessToken: string;
	expiresAt: string | null;
	refreshToken: string | null;
	scopes: string[];
}

/** Handle to an in-flight login, exposing a way to cancel it. */
interface PendingLogin {
	cancel: () => Promise<void>;
}

/**
 * Builds the Linear OAuth service that owns login, refresh, disconnect, and
 * per-account status reporting. Several accounts may be connected at once; each
 * one's tokens live exclusively in the secret store, and SQLite only ever holds
 * non-secret identity and grant metadata.
 * @param options - Service dependencies (config, database, secrets, browser opener).
 * @returns A fresh {@link LinearAuthService}.
 */
export function createLinearAuthService({
	builtInClientId = BUILT_IN_LINEAR_CLIENT_ID,
	callbackPorts,
	callbackTimeoutMs,
	configService,
	databaseService,
	fetchImpl = fetch,
	getLanguage = () => FALLBACK_LANGUAGE,
	idFactory,
	now = () => new Date(),
	onDisconnect,
	openExternal,
	secretStoreFactory,
}: CreateLinearAuthServiceOptions): LinearAuthService {
	let pendingLogin: PendingLogin | null = null;
	const refreshInFlight = new Map<string, Promise<string>>();

	/**
	 * Clear the in-progress login only when the caller still owns the slot. A
	 * login that lost the slot to a later attempt must not free that attempt's
	 * claim on its way out, or the guard stops holding and `cancelLogin` cancels
	 * a flow that already finished.
	 * @param slot - The claim the finishing login took
	 */
	function releasePendingLogin(slot: PendingLogin): void {
		if (pendingLogin === slot) {
			pendingLogin = null;
		}
	}

	/**
	 * Return the open database connection, throwing when it is not available.
	 * @returns The open SQLite database
	 */
	function getDatabase(): DatabaseSync {
		const database = databaseService.getConnection()?.database;

		if (!database) {
			throw new LinearAuthError(
				'database-error',
				'The Ensemblr database is not open.',
			);
		}

		return database;
	}

	/**
	 * Return the platform secret store, throwing when no backend is available.
	 * @returns The secret store for app-scoped secrets
	 */
	function requireSecretStore(): SecretStore {
		const store = secretStoreFactory(getDatabase());

		if (!store) {
			throw new LinearAuthError(
				'secret-store-error',
				'No secret store backend is available on this platform.',
			);
		}

		return store;
	}

	/**
	 * Build the account store over the current database and secret backend.
	 * @returns A store bound to the open connection
	 */
	function getAccountStore(): LinearAccountStore {
		const database = getDatabase();

		return createLinearAccountStore({
			database,
			...(idFactory ? { idFactory } : {}),
			now,
			secretStore: secretStoreFactory(database),
		});
	}

	/**
	 * Resolve the Linear OAuth client config from app settings, falling back to
	 * the built-in client id and default scopes.
	 * @returns The resolved OAuth config, or null when no client id is available
	 */
	function getOauthConfig(): LinearOauthConfig | null {
		const app = configService.getConfig().app;
		const linear = app.linear;
		const record =
			typeof linear === 'object' && linear !== null
				? (linear as Record<string, unknown>)
				: {};
		const configuredId =
			typeof record.clientId === 'string' ? record.clientId.trim() : '';
		const clientId =
			configuredId === '' ? builtInClientId.trim() : configuredId;

		if (clientId === '') {
			return null;
		}

		const scopes = Array.isArray(record.scopes)
			? record.scopes.filter(
					(scope): scope is string => typeof scope === 'string',
				)
			: DEFAULT_LINEAR_SCOPES;

		return { clientId, scopes };
	}

	/**
	 * Read the app-scoped OAuth client secret, if the user configured one.
	 * @returns The stored client secret, or null when it is not set
	 */
	async function readClientSecret(): Promise<string | null> {
		try {
			return await requireSecretStore().read({
				key: CLIENT_SECRET_KEY,
				scope: 'app',
			});
		} catch (error) {
			throw new LinearAuthError(
				'secret-store-error',
				'Reading the Linear client secret failed.',
				{ cause: error },
			);
		}
	}

	/**
	 * Report whether an access token is expired, applying a clock-skew margin.
	 * @param expiresAt - ISO expiry timestamp, or null when the token never expires
	 * @returns True when the token is at or past its skew-adjusted expiry
	 */
	function isExpired(expiresAt: string | null): boolean {
		if (!expiresAt) {
			return false;
		}

		return now().getTime() + EXPIRY_SKEW_MS >= Date.parse(expiresAt);
	}

	/**
	 * Project a stored account onto the snapshot the renderer reads.
	 * @param record - Stored account record
	 * @returns The account snapshot with its resolved state
	 */
	function snapshotOf(record: LinearAccountRecord): LinearAccountSnapshot {
		return toAccountSnapshot(record, isExpired(record.expiresAt));
	}

	/**
	 * Return the account store with the legacy connection already adopted.
	 * @returns A store whose account list reflects any pre-upgrade connection
	 */
	async function getAdoptedStore(): Promise<LinearAccountStore> {
		const store = getAccountStore();
		await adoptLegacyConnection(
			{ fetchViewer, getDatabase, secretStoreFactory },
			store,
		);

		return store;
	}

	/**
	 * Reduce every account's state to the single word the setup check and the
	 * onboarding gate ask for.
	 * @param accounts - Snapshots of every connected account
	 * @returns The aggregate connection state
	 */
	function summarizeState(
		accounts: LinearAccountSnapshot[],
	): LinearConnectionState {
		if (!getOauthConfig()) {
			return 'not-configured';
		}

		if (accounts.length === 0) {
			return 'disconnected';
		}

		return accounts.some((account) => account.state === 'connected')
			? 'connected'
			: 'reconnect-required';
	}

	/**
	 * Exchange a form body at the Linear token endpoint and normalize the response,
	 * throwing typed errors on network or non-OK responses.
	 * @param body - Form fields for the token request (grant type, code, etc.)
	 * @returns The normalized token set
	 */
	async function requestToken(
		body: Record<string, string>,
	): Promise<TokenResponse> {
		let response: Response;

		try {
			response = await fetchImpl(LINEAR_TOKEN_URL, {
				body: new URLSearchParams(body).toString(),
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				method: 'POST',
			});
		} catch (error) {
			throw new LinearAuthError(
				'network-error',
				'Could not reach the Linear token endpoint.',
				{ cause: error },
			);
		}

		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new LinearAuthError(
				body.grant_type === 'refresh_token'
					? 'refresh-failed'
					: 'exchange-failed',
				`The Linear token endpoint responded with HTTP ${response.status}${
					detail ? `: ${truncate(detail, 200)}` : '.'
				}`,
			);
		}

		const payload = (await response.json()) as {
			access_token?: string;
			expires_in?: number;
			refresh_token?: string;
			scope?: string;
		};

		if (!payload.access_token) {
			throw new LinearAuthError(
				'exchange-failed',
				'The Linear token response did not include an access token.',
			);
		}

		return {
			accessToken: payload.access_token,
			expiresAt:
				typeof payload.expires_in === 'number'
					? new Date(now().getTime() + payload.expires_in * 1000).toISOString()
					: null,
			refreshToken: payload.refresh_token ?? null,
			scopes: payload.scope
				? payload.scope.split(/[\s,]+/).filter(Boolean)
				: [],
		};
	}

	/**
	 * Fetch the authenticated viewer and organization details from Linear's
	 * GraphQL API, returning all-null values on any failure. The ids matter as
	 * much as the names: they key the account row.
	 * @param accessToken - Bearer access token for the request
	 * @returns The viewer and organization fields, each null when unavailable
	 */
	async function fetchViewer(accessToken: string): Promise<ViewerIdentity> {
		try {
			const response = await fetchImpl(LINEAR_GRAPHQL_URL, {
				body: JSON.stringify({
					query: '{ viewer { id email name } organization { id name urlKey } }',
				}),
				headers: {
					authorization: `Bearer ${accessToken}`,
					'content-type': 'application/json',
				},
				method: 'POST',
			});

			if (!response.ok) {
				return nullViewer();
			}

			const payload = (await response.json()) as {
				data?: {
					organization?: { id?: string; name?: string; urlKey?: string };
					viewer?: { email?: string; id?: string; name?: string };
				};
			};

			return {
				organizationId: payload.data?.organization?.id ?? null,
				organizationName: payload.data?.organization?.name ?? null,
				organizationUrlKey: payload.data?.organization?.urlKey ?? null,
				userEmail: payload.data?.viewer?.email ?? null,
				userId: payload.data?.viewer?.id ?? null,
				userName: payload.data?.viewer?.name ?? null,
			};
		} catch {
			return nullViewer();
		}
	}

	/**
	 * Best-effort revocation of a token at Linear; swallows errors so a local
	 * disconnect still succeeds offline.
	 * @param token - Token value to revoke
	 * @param hint - Whether the token is an access or refresh token
	 */
	async function revokeToken(
		token: string,
		hint: 'access_token' | 'refresh_token',
	): Promise<void> {
		await fetchImpl(LINEAR_REVOKE_URL, {
			body: new URLSearchParams({
				token,
				token_type_hint: hint,
			}).toString(),
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			method: 'POST',
		}).catch(() => {
			// Best-effort revocation: local disconnect must succeed offline.
		});
	}

	/**
	 * Exchange one account's refresh token for a new access token and update its
	 * stored tokens and grant metadata.
	 * @param accountId - Account whose grant is being refreshed
	 * @returns The freshly issued access token
	 */
	async function refreshAccessToken(accountId: string): Promise<string> {
		const config = getOauthConfig();

		if (!config) {
			throw new LinearAuthError(
				'not-configured',
				'Linear OAuth is not configured. Set app.linear.clientId in the Ensemblr config.',
			);
		}

		const store = getAccountStore();
		const refreshToken = await store.readRefreshToken(accountId);

		if (!refreshToken) {
			store.recordError(accountId, 'refresh-failed');
			throw new LinearAuthError(
				'refresh-failed',
				'No Linear refresh token is stored for this account. Reconnect it to continue.',
			);
		}

		const clientSecret = await readClientSecret();

		try {
			const tokens = await requestToken({
				client_id: config.clientId,
				...(clientSecret ? { client_secret: clientSecret } : {}),
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
			});

			await store.writeTokens(accountId, tokens);
			store.recordGrant(accountId, {
				canRefresh:
					tokens.refreshToken !== null ||
					store.get(accountId)?.canRefresh === true,
				expiresAt: tokens.expiresAt,
				scopes:
					tokens.scopes.length > 0
						? tokens.scopes
						: (store.get(accountId)?.scopes ?? []),
			});

			return tokens.accessToken;
		} catch (error) {
			store.recordError(
				accountId,
				error instanceof LinearAuthError ? error.code : 'refresh-failed',
			);
			throw error;
		}
	}

	/**
	 * Drop an account adopted without a resolved identity once the real identity
	 * for the same organization arrives, so adoption offline cannot leave a
	 * duplicate behind.
	 *
	 * Matching requires a url key on both sides. An adopted row whose organization
	 * could not be named at all matches nothing: deleting it on the strength of
	 * "it is unidentified and so is any organization" would take an unrelated
	 * account's row, its Keychain entries, and — through the cascade — its whole
	 * cached issue list, on the user's next login to a different organization.
	 * @param store - Account store to clean up
	 * @param viewer - Identity resolved by the completed login
	 */
	async function replaceUnresolvedAccount(
		store: LinearAccountStore,
		viewer: ViewerIdentity,
	): Promise<void> {
		if (viewer.organizationUrlKey === null) {
			return;
		}

		const stale = store
			.list()
			.find(
				(account) =>
					account.organizationId === UNRESOLVED_ORGANIZATION_ID &&
					account.organizationUrlKey === viewer.organizationUrlKey,
			);

		if (stale) {
			await store.delete(stale.id);
		}
	}

	/**
	 * Finish the OAuth login: validate the callback, exchange the code for tokens,
	 * persist them against the resolved account, and return its snapshot.
	 * @param searchParams - Query params from the OAuth callback URL
	 * @param expectedState - State value expected to match the callback
	 * @param verifier - PKCE code verifier for the token exchange
	 * @param redirectUri - Redirect URI used in the authorization request
	 * @param config - Resolved Linear OAuth client config
	 * @returns The snapshot of the account that was connected
	 */
	async function completeLogin(
		searchParams: URLSearchParams,
		expectedState: string,
		verifier: string,
		redirectUri: string,
		config: LinearOauthConfig,
	): Promise<LinearAccountSnapshot> {
		const parsed = parseOauthCallback({ expectedState, searchParams });

		if (!parsed.ok) {
			throw new LinearAuthError(
				parsed.error === 'state-mismatch'
					? 'state-mismatch'
					: 'callback-failed',
				parsed.description,
			);
		}

		requireSecretStore();

		const clientSecret = await readClientSecret();
		const tokens = await requestToken({
			client_id: config.clientId,
			...(clientSecret ? { client_secret: clientSecret } : {}),
			code: parsed.code,
			code_verifier: verifier,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri,
		});

		const viewer = await fetchViewer(tokens.accessToken);

		if (!viewer.organizationId || !viewer.userId) {
			throw new LinearAuthError(
				'exchange-failed',
				'Linear did not identify the signed-in user, so the account could not be saved.',
			);
		}

		const store = await getAdoptedStore();
		await replaceUnresolvedAccount(store, viewer);

		const account = store.upsertIdentity({
			canRefresh: tokens.refreshToken !== null,
			expiresAt: tokens.expiresAt,
			organizationId: viewer.organizationId,
			organizationName: viewer.organizationName,
			organizationUrlKey: viewer.organizationUrlKey,
			scopes: tokens.scopes.length > 0 ? tokens.scopes : [...config.scopes],
			userEmail: viewer.userEmail,
			userId: viewer.userId,
			userName: viewer.userName,
		});

		await store.writeTokens(account.id, tokens);

		if (tokens.refreshToken === null) {
			await store.clearRefreshToken(account.id);
		}

		return snapshotOf(account);
	}

	return {
		cancelLogin: async () => {
			await pendingLogin?.cancel();
		},

		disconnect: async (accountId) => {
			try {
				const store = await getAdoptedStore();
				const accessToken = await store.readAccessToken(accountId);
				const refreshToken = await store.readRefreshToken(accountId);

				// Refresh token first: revoking it invalidates the whole grant.
				if (refreshToken) {
					await revokeToken(refreshToken, 'refresh_token');
				}

				if (accessToken) {
					await revokeToken(accessToken, 'access_token');
				}

				await store.delete(accountId);
				refreshInFlight.delete(accountId);
				onDisconnect?.(accountId);

				const accounts = store.list().map(snapshotOf);

				return {
					status: 'disconnected',
					summary: { accounts, state: summarizeState(accounts) },
				};
			} catch (error) {
				return { failure: toFailure(error), status: 'error' };
			}
		},

		getAccessToken: async (accountId) => {
			const store = await getAdoptedStore();
			const accessToken = await store.readAccessToken(accountId);

			if (!accessToken) {
				throw new LinearAuthError(
					'not-connected',
					'This Linear account is not connected. Sign in from integration settings.',
				);
			}

			if (!isExpired(store.get(accountId)?.expiresAt ?? null)) {
				return accessToken;
			}

			const inFlight =
				refreshInFlight.get(accountId) ??
				refreshAccessToken(accountId).finally(() => {
					refreshInFlight.delete(accountId);
				});
			refreshInFlight.set(accountId, inFlight);

			return inFlight;
		},

		getConnectionSummary: async () => {
			if (!getOauthConfig()) {
				return { accounts: [], state: 'not-configured' };
			}

			const accounts = (await getAdoptedStore()).list().map(snapshotOf);

			return { accounts, state: summarizeState(accounts) };
		},

		listAccounts: async () => (await getAdoptedStore()).list().map(snapshotOf),

		startLogin: async () => {
			const config = getOauthConfig();

			if (!config) {
				return {
					failure: {
						code: 'not-configured',
						message:
							'Linear OAuth is not configured. Set app.linear.clientId in ~/.config/ensemblr/config.json.',
					},
					status: 'error',
				};
			}

			if (pendingLogin) {
				return {
					failure: {
						code: 'login-in-progress',
						message: 'A Linear login attempt is already in progress.',
					},
					status: 'error',
				};
			}

			const slot: PendingLogin = { cancel: async () => undefined };
			pendingLogin = slot;

			const { challenge, verifier } = createPkcePair();
			const state = createOauthState();

			let server: Awaited<ReturnType<typeof startLinearOauthCallbackServer>>;

			try {
				server = await startLinearOauthCallbackServer({
					language: getLanguage(),
					...(callbackPorts === undefined ? {} : { ports: callbackPorts }),
					...(callbackTimeoutMs === undefined
						? {}
						: { timeoutMs: callbackTimeoutMs }),
				});
			} catch (error) {
				releasePendingLogin(slot);

				return {
					failure: {
						code: 'callback-failed',
						message: `Starting the local OAuth callback server failed: ${formatError(error)}`,
					},
					status: 'error',
				};
			}

			slot.cancel = () => server.close();

			try {
				await openExternal(
					buildLinearAuthorizeUrl({
						challenge,
						clientId: config.clientId,
						redirectUri: server.redirectUri,
						scopes: config.scopes,
						state,
					}),
				);

				const searchParams = await server.waitForCallback();
				const account = await completeLogin(
					searchParams,
					state,
					verifier,
					server.redirectUri,
					config,
				);

				return { account, status: 'connected' };
			} catch (error) {
				return { failure: toFailure(error), status: 'error' };
			} finally {
				releasePendingLogin(slot);
				await server.close();
			}
		},
	};
}

/** Re-exported so callers keep importing the auth error from the service. */
export { LinearAuthError } from './linear-auth-error.ts';
