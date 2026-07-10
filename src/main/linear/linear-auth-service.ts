import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
	LinearAuthFailure,
	LinearAuthFailureCode,
	LinearConnectionSnapshot,
	LinearDisconnectResult,
	LinearLoginResult,
} from '../../shared/ipc/contracts/linear';
import type { EnsemblrConfigService } from '../config/config-loader';
import type { SecretStore } from '../secrets';
import type { EnsemblrDatabaseService } from '../storage/database';
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
import {
	LinearOauthCallbackError,
	startLinearOauthCallbackServer,
} from './linear-oauth-callback-server.ts';

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
const ACCESS_TOKEN_KEY = 'linear-access-token';
const REFRESH_TOKEN_KEY = 'linear-refresh-token';
/**
 * User-managed secret for custom confidential OAuth apps. Never written by the
 * app and deliberately survives disconnect, like `app.linear.clientId`.
 */
const CLIENT_SECRET_KEY = 'linear-client-secret';
const CONNECTION_RESOURCE_TYPE = 'connection';
const CONNECTION_RESOURCE_ID = 'default';
const EXPIRY_SKEW_MS = 60_000;

/** Typed error thrown by every Linear auth operation. */
export class LinearAuthError extends Error {
	readonly code: LinearAuthFailureCode;

	/**
	 * @param code - Machine-readable failure category.
	 * @param message - Human-readable description.
	 * @param options - Optional cause for diagnostics.
	 */
	constructor(
		code: LinearAuthFailureCode,
		message: string,
		options: { cause?: unknown } = {},
	) {
		super(message, { cause: options.cause });
		this.name = 'LinearAuthError';
		this.code = code;
	}
}

/** Linear OAuth client settings declared in `~/.config/ensemblr/config.json`. */
export interface LinearOauthConfig {
	clientId: string;
	scopes: readonly string[];
}

/** Public surface of the Linear auth service. */
export interface LinearAuthService {
	cancelLogin: () => Promise<void>;
	disconnect: () => Promise<LinearDisconnectResult>;
	getAccessToken: () => Promise<string>;
	getConnectionStatus: () => Promise<LinearConnectionSnapshot>;
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
	now?: () => Date;
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

/** Non-secret Linear connection metadata persisted in SQLite alongside the stored tokens. */
interface ConnectionMetadata {
	expiresAt: string | null;
	hasRefreshToken: boolean;
	organizationName: string | null;
	organizationUrlKey: string | null;
	scopes: string[];
	userEmail: string | null;
	userName: string | null;
}

/** Handle to an in-flight login, exposing a way to cancel it. */
interface PendingLogin {
	cancel: () => Promise<void>;
}

/**
 * Builds the Linear OAuth service that owns login, refresh, disconnect, and
 * connection-status reporting. Tokens live exclusively in the secret store;
 * SQLite only ever holds non-secret connection metadata.
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
	now = () => new Date(),
	openExternal,
	secretStoreFactory,
}: CreateLinearAuthServiceOptions): LinearAuthService {
	let pendingLogin: PendingLogin | null = null;
	let refreshInFlight: Promise<string> | null = null;

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
	function getSecretStore(): SecretStore {
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
	 * Read an app-scoped secret, wrapping backend failures as a Linear auth error.
	 * @param key - Secret key to read
	 * @returns The stored secret value, or null when it is not set
	 */
	async function readSecret(key: string): Promise<string | null> {
		try {
			return await getSecretStore().read({ key, scope: 'app' });
		} catch (error) {
			throw new LinearAuthError(
				'secret-store-error',
				`Reading the "${key}" secret failed.`,
				{ cause: error },
			);
		}
	}

	/**
	 * Create or update an app-scoped secret, wrapping backend failures as an error.
	 * @param key - Secret key to persist
	 * @param value - Secret value to store
	 */
	async function writeSecret(key: string, value: string): Promise<void> {
		const store = getSecretStore();
		const input = {
			displayName: `Linear ${key}`,
			key,
			scope: 'app' as const,
			value,
		};

		try {
			const existing = await store.read({ key, scope: 'app' });

			if (existing === null) {
				await store.create(input);
			} else {
				await store.update(input);
			}
		} catch (error) {
			throw new LinearAuthError(
				'secret-store-error',
				`Persisting the "${key}" secret failed.`,
				{ cause: error },
			);
		}
	}

	/**
	 * Best-effort deletion of an app-scoped secret; never throws so disconnect can proceed.
	 * @param key - Secret key to delete
	 */
	async function deleteSecret(key: string): Promise<void> {
		try {
			await getSecretStore().delete({ key, scope: 'app' });
		} catch {
			// Best-effort: missing entries and keychain errors must not block disconnect.
		}
	}

	/**
	 * Read and parse the stored Linear connection metadata row.
	 * @returns The parsed metadata, or null when absent or malformed
	 */
	function readConnectionMetadata(): ConnectionMetadata | null {
		const row = getDatabase()
			.prepare(
				`SELECT metadata_json FROM integration_metadata
				 WHERE provider = 'linear' AND resource_type = ? AND resource_id = ?`,
			)
			.get(CONNECTION_RESOURCE_TYPE, CONNECTION_RESOURCE_ID) as
			| { metadata_json: string }
			| undefined;

		if (!row) {
			return null;
		}

		try {
			const parsed = JSON.parse(
				row.metadata_json,
			) as Partial<ConnectionMetadata>;

			return {
				expiresAt: parsed.expiresAt ?? null,
				hasRefreshToken: parsed.hasRefreshToken ?? false,
				organizationName: parsed.organizationName ?? null,
				organizationUrlKey: parsed.organizationUrlKey ?? null,
				scopes: parsed.scopes ?? [],
				userEmail: parsed.userEmail ?? null,
				userName: parsed.userName ?? null,
			};
		} catch {
			return null;
		}
	}

	/**
	 * Upsert the Linear connection metadata row, stamping the sync time.
	 * @param metadata - Connection metadata to persist
	 */
	function writeConnectionMetadata(metadata: ConnectionMetadata): void {
		const timestamp = now().toISOString();
		getDatabase()
			.prepare(
				`INSERT INTO integration_metadata
					(id, provider, resource_type, resource_id, external_id, synced_at, metadata_json)
				 VALUES (?, 'linear', ?, ?, '', ?, ?)
				 ON CONFLICT(provider, resource_type, resource_id, external_id)
				 DO UPDATE SET metadata_json = excluded.metadata_json,
					synced_at = excluded.synced_at,
					updated_at = excluded.synced_at`,
			)
			.run(
				randomUUID(),
				CONNECTION_RESOURCE_TYPE,
				CONNECTION_RESOURCE_ID,
				timestamp,
				JSON.stringify(metadata),
			);
	}

	/** Delete the stored Linear connection metadata row. */
	function deleteConnectionMetadata(): void {
		getDatabase()
			.prepare(
				`DELETE FROM integration_metadata
				 WHERE provider = 'linear' AND resource_type = ? AND resource_id = ?`,
			)
			.run(CONNECTION_RESOURCE_TYPE, CONNECTION_RESOURCE_ID);
	}

	/**
	 * Read the last-updated timestamp of the connection metadata row.
	 * @returns The ISO `updated_at` value, or null when no row exists
	 */
	function readConnectionUpdatedAt(): string | null {
		const row = getDatabase()
			.prepare(
				`SELECT updated_at FROM integration_metadata
				 WHERE provider = 'linear' AND resource_type = ? AND resource_id = ?`,
			)
			.get(CONNECTION_RESOURCE_TYPE, CONNECTION_RESOURCE_ID) as
			| { updated_at: string }
			| undefined;

		return row?.updated_at ?? null;
	}

	/**
	 * Compose a connection snapshot for the renderer from a state and metadata.
	 * @param state - Connection state to report
	 * @param metadata - Stored metadata to project, when present
	 * @returns The connection snapshot
	 */
	function buildSnapshot(
		state: LinearConnectionSnapshot['state'],
		metadata: ConnectionMetadata | null,
	): LinearConnectionSnapshot {
		return {
			expiresAt: metadata?.expiresAt ?? null,
			organizationName: metadata?.organizationName ?? null,
			organizationUrlKey: metadata?.organizationUrlKey ?? null,
			scopes: metadata?.scopes ?? [],
			state,
			updatedAt: readConnectionUpdatedAt(),
			userEmail: metadata?.userEmail ?? null,
			userName: metadata?.userName ?? null,
		};
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
	 * GraphQL API, returning all-null values on any failure.
	 * @param accessToken - Bearer access token for the request
	 * @returns The viewer and organization fields, each null when unavailable
	 */
	async function fetchViewer(accessToken: string): Promise<{
		organizationName: string | null;
		organizationUrlKey: string | null;
		userEmail: string | null;
		userName: string | null;
	}> {
		try {
			const response = await fetchImpl(LINEAR_GRAPHQL_URL, {
				body: JSON.stringify({
					query: '{ viewer { email name } organization { name urlKey } }',
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
					organization?: { name?: string; urlKey?: string };
					viewer?: { email?: string; name?: string };
				};
			};

			return {
				organizationName: payload.data?.organization?.name ?? null,
				organizationUrlKey: payload.data?.organization?.urlKey ?? null,
				userEmail: payload.data?.viewer?.email ?? null,
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
	 * Persist an access token, plus the refresh token when the response carries one.
	 * @param tokens - Token set to write to the secret store
	 */
	async function persistTokens(tokens: TokenResponse): Promise<void> {
		await writeSecret(ACCESS_TOKEN_KEY, tokens.accessToken);

		if (tokens.refreshToken) {
			await writeSecret(REFRESH_TOKEN_KEY, tokens.refreshToken);
		}
	}

	/**
	 * Exchange the stored refresh token for a new access token and update the
	 * persisted tokens and connection metadata.
	 * @returns The freshly issued access token
	 */
	async function refreshAccessToken(): Promise<string> {
		const config = getOauthConfig();

		if (!config) {
			throw new LinearAuthError(
				'not-configured',
				'Linear OAuth is not configured. Set app.linear.clientId in the Ensemblr config.',
			);
		}

		const refreshToken = await readSecret(REFRESH_TOKEN_KEY);

		if (!refreshToken) {
			throw new LinearAuthError(
				'refresh-failed',
				'No Linear refresh token is stored. Reconnect Linear to continue.',
			);
		}

		const clientSecret = await readSecret(CLIENT_SECRET_KEY);
		const tokens = await requestToken({
			client_id: config.clientId,
			...(clientSecret ? { client_secret: clientSecret } : {}),
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
		});

		await persistTokens(tokens);

		const existing = readConnectionMetadata();
		writeConnectionMetadata({
			expiresAt: tokens.expiresAt,
			hasRefreshToken:
				tokens.refreshToken !== null || existing?.hasRefreshToken === true,
			organizationName: existing?.organizationName ?? null,
			organizationUrlKey: existing?.organizationUrlKey ?? null,
			scopes:
				tokens.scopes.length > 0 ? tokens.scopes : (existing?.scopes ?? []),
			userEmail: existing?.userEmail ?? null,
			userName: existing?.userName ?? null,
		});

		return tokens.accessToken;
	}

	/**
	 * Finish the OAuth login: validate the callback, exchange the code for tokens,
	 * persist them with viewer metadata, and return the connection snapshot.
	 * @param searchParams - Query params from the OAuth callback URL
	 * @param expectedState - State value expected to match the callback
	 * @param verifier - PKCE code verifier for the token exchange
	 * @param redirectUri - Redirect URI used in the authorization request
	 * @param config - Resolved Linear OAuth client config
	 * @returns The connection snapshot after a successful login
	 */
	async function completeLogin(
		searchParams: URLSearchParams,
		expectedState: string,
		verifier: string,
		redirectUri: string,
		config: LinearOauthConfig,
	): Promise<LinearConnectionSnapshot> {
		const parsed = parseOauthCallback({ expectedState, searchParams });

		if (!parsed.ok) {
			throw new LinearAuthError(
				parsed.error === 'state-mismatch'
					? 'state-mismatch'
					: 'callback-failed',
				parsed.description,
			);
		}

		const clientSecret = await readSecret(CLIENT_SECRET_KEY);
		const tokens = await requestToken({
			client_id: config.clientId,
			...(clientSecret ? { client_secret: clientSecret } : {}),
			code: parsed.code,
			code_verifier: verifier,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri,
		});

		await persistTokens(tokens);

		const viewer = await fetchViewer(tokens.accessToken);
		writeConnectionMetadata({
			expiresAt: tokens.expiresAt,
			hasRefreshToken: tokens.refreshToken !== null,
			scopes: tokens.scopes.length > 0 ? tokens.scopes : [...config.scopes],
			...viewer,
		});

		return buildSnapshot('connected', readConnectionMetadata());
	}

	return {
		cancelLogin: async () => {
			await pendingLogin?.cancel();
		},

		disconnect: async () => {
			try {
				const accessToken = await readSecret(ACCESS_TOKEN_KEY).catch(
					() => null,
				);
				const refreshToken = await readSecret(REFRESH_TOKEN_KEY).catch(
					() => null,
				);

				// Refresh token first: revoking it invalidates the whole grant.
				if (refreshToken) {
					await revokeToken(refreshToken, 'refresh_token');
				}

				if (accessToken) {
					await revokeToken(accessToken, 'access_token');
				}

				await deleteSecret(ACCESS_TOKEN_KEY);
				await deleteSecret(REFRESH_TOKEN_KEY);
				deleteConnectionMetadata();

				const state = getOauthConfig() ? 'disconnected' : 'not-configured';

				return {
					snapshot: buildSnapshot(
						state === 'disconnected' ? 'disconnected' : 'not-configured',
						null,
					),
					status: 'disconnected',
				};
			} catch (error) {
				return { failure: toFailure(error), status: 'error' };
			}
		},

		getAccessToken: async () => {
			const accessToken = await readSecret(ACCESS_TOKEN_KEY);

			if (!accessToken) {
				throw new LinearAuthError(
					'not-connected',
					'Linear is not connected. Sign in from integration settings.',
				);
			}

			const metadata = readConnectionMetadata();

			if (!isExpired(metadata?.expiresAt ?? null)) {
				return accessToken;
			}

			refreshInFlight ??= refreshAccessToken().finally(() => {
				refreshInFlight = null;
			});

			return refreshInFlight;
		},

		getConnectionStatus: async () => {
			if (!getOauthConfig()) {
				return buildSnapshot('not-configured', readConnectionMetadata());
			}

			const accessToken = await readSecret(ACCESS_TOKEN_KEY).catch(() => null);

			if (!accessToken) {
				return buildSnapshot('disconnected', null);
			}

			const metadata = readConnectionMetadata();

			if (
				isExpired(metadata?.expiresAt ?? null) &&
				!metadata?.hasRefreshToken
			) {
				return buildSnapshot('reconnect-required', metadata);
			}

			return buildSnapshot('connected', metadata);
		},

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

			const { challenge, verifier } = createPkcePair();
			const state = createOauthState();

			let server: Awaited<ReturnType<typeof startLinearOauthCallbackServer>>;

			try {
				server = await startLinearOauthCallbackServer({
					...(callbackPorts === undefined ? {} : { ports: callbackPorts }),
					...(callbackTimeoutMs === undefined
						? {}
						: { timeoutMs: callbackTimeoutMs }),
				});
			} catch (error) {
				return {
					failure: {
						code: 'callback-failed',
						message: `Starting the local OAuth callback server failed: ${formatError(error)}`,
					},
					status: 'error',
				};
			}

			pendingLogin = { cancel: () => server.close() };

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
				const snapshot = await completeLogin(
					searchParams,
					state,
					verifier,
					server.redirectUri,
					config,
				);

				return { snapshot, status: 'connected' };
			} catch (error) {
				return { failure: toFailure(error), status: 'error' };
			} finally {
				pendingLogin = null;
				await server.close();
			}
		},
	};
}

/**
 * Build an all-null viewer/organization record used as a fallback.
 * @returns A viewer record with every field set to null
 */
function nullViewer() {
	return {
		organizationName: null,
		organizationUrlKey: null,
		userEmail: null,
		userName: null,
	};
}

/**
 * Map a thrown error to a structured Linear auth failure for the renderer.
 * @param error - The caught error
 * @returns The corresponding failure with a code and message
 */
function toFailure(error: unknown): LinearAuthFailure {
	if (error instanceof LinearAuthError) {
		return { code: error.code, message: error.message };
	}

	if (error instanceof LinearOauthCallbackError) {
		return {
			code:
				error.code === 'callback-timeout'
					? 'callback-timeout'
					: 'login-canceled',
			message: error.message,
		};
	}

	return { code: 'callback-failed', message: formatError(error) };
}

/**
 * Extract a human-readable message from an unknown error value.
 * @param error - The value to format
 * @returns The error message, or the value stringified
 */
function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Truncate text to a maximum length, appending an ellipsis when shortened.
 * @param text - Text to truncate
 * @param maxLength - Maximum length before truncation
 * @returns The original text, or a truncated copy with a trailing ellipsis
 */
function truncate(text: string, maxLength: number): string {
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
