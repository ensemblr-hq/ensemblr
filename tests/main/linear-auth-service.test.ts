import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import {
	type ConfigStatusSnapshot,
	ENSEMBLR_CONFIG_SCHEMA_VERSION,
	type EnsemblrConfig,
	type EnsemblrConfigService,
} from '../../src/main/config/config-loader.ts';
import {
	createLinearAuthService,
	LinearAuthError,
} from '../../src/main/linear/linear-auth-service.ts';
import { createMockSecretStore } from '../../src/main/secrets/mock-backend.ts';
import type { SecretStore } from '../../src/main/secrets/secret-store-types.ts';
import {
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';

const NOW = new Date('2026-06-11T00:00:00.000Z');
const CLIENT_ID = 'linear-client-1';

function createConfigService(
	app: Record<string, unknown>,
): EnsemblrConfigService {
	const config: EnsemblrConfig = {
		app,
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLR_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
	};
	const snapshot: ConfigStatusSnapshot = {
		blocksReadiness: false,
		diagnostics: [],
		displayPath: '~/.config/ensemblr/config.json',
		loadedAt: NOW.toISOString(),
		path: '/Users/alice/.config/ensemblr/config.json',
		schemaVersion: ENSEMBLR_CONFIG_SCHEMA_VERSION,
		status: 'ok',
	};

	return {
		getConfig: () => config,
		getSnapshot: () => snapshot,
		load: () => snapshot,
		startWatching: () => {},
		stop: () => {},
	};
}

function createDatabaseServiceFixture(t: TestContext): EnsemblrDatabaseService {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-linear-auth-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'linear-auth-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	return {
		close: () => {},
		getConnection: () => connection,
		getHealth: () => ({
			path: connection.path,
			schemaVersion: connection.schemaVersion,
			status: 'ok',
		}),
		open: () => ({
			path: connection.path,
			schemaVersion: connection.schemaVersion,
			status: 'ok',
		}),
	};
}

interface FetchCall {
	body: string | null;
	url: string;
}

function createFetchStub({
	expiresInSeconds = 3600,
	failRefresh = false,
	failToken = false,
	organizationId = 'org-1',
	organizationName = 'Example Org',
	userId = 'viewer-1',
}: {
	expiresInSeconds?: number;
	failRefresh?: boolean;
	failToken?: boolean;
	organizationId?: string;
	organizationName?: string;
	userId?: string;
} = {}) {
	const calls: FetchCall[] = [];
	let tokenCounter = 0;

	const fetchImpl = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const url = String(input);
		calls.push({
			body: typeof init?.body === 'string' ? init.body : null,
			url,
		});

		if (url.includes('/oauth/token')) {
			const isRefresh = String(init?.body ?? '').includes('refresh_token');

			if (failToken || (isRefresh && failRefresh)) {
				return new Response('invalid_grant', { status: 400 });
			}

			tokenCounter += 1;
			return Response.json({
				access_token: `access-${tokenCounter}`,
				expires_in: expiresInSeconds,
				refresh_token: `refresh-${tokenCounter}`,
				scope: 'read write',
				token_type: 'Bearer',
			});
		}

		if (url.includes('/oauth/revoke')) {
			return new Response(null, { status: 200 });
		}

		if (url.includes('/graphql')) {
			return Response.json({
				data: {
					organization: {
						id: organizationId,
						name: organizationName,
						urlKey: 'example-org',
					},
					viewer: { email: 'alice@example.com', id: userId, name: 'Alice' },
				},
			});
		}

		return new Response('unexpected url', { status: 500 });
	}) as typeof fetch;

	return { calls, fetchImpl };
}

function createServiceFixture(
	t: TestContext,
	{
		app = { linear: { clientId: CLIENT_ID } },
		builtInClientId,
		callbackTimeoutMs,
		fetchStub = createFetchStub(),
		openExternal,
		secretStore = createMockSecretStore({ now: () => NOW }),
	}: {
		app?: Record<string, unknown>;
		builtInClientId?: string;
		callbackTimeoutMs?: number;
		fetchStub?: ReturnType<typeof createFetchStub>;
		openExternal?: (url: string) => Promise<void>;
		secretStore?: SecretStore;
	} = {},
) {
	const databaseService = createDatabaseServiceFixture(t);
	const service = createLinearAuthService({
		...(builtInClientId === undefined ? {} : { builtInClientId }),
		...(callbackTimeoutMs === undefined ? {} : { callbackTimeoutMs }),
		// Port 0 keeps tests on random loopback ports so parallel test files
		// never contend for the fixed production callback ports.
		callbackPorts: [0],
		configService: createConfigService(app),
		databaseService,
		fetchImpl: fetchStub.fetchImpl,
		now: () => NOW,
		openExternal: openExternal ?? (async (url) => approveLoginInBrowser(url)),
		secretStoreFactory: () => secretStore,
	});

	return { databaseService, fetchStub, secretStore, service };
}

/** Simulates the user approving consent: hits the loopback callback with the issued state. */
async function approveLoginInBrowser(
	authorizeUrl: string,
	overrides: Record<string, string> = {},
): Promise<void> {
	const url = new URL(authorizeUrl);
	const redirectUri = url.searchParams.get('redirect_uri');
	const state = url.searchParams.get('state');
	assert.ok(redirectUri && state);

	const callback = new URL(redirectUri);
	callback.searchParams.set('code', 'auth-code-1');
	callback.searchParams.set('state', state);
	for (const [key, value] of Object.entries(overrides)) {
		callback.searchParams.set(key, value);
	}

	const response = await fetch(callback);
	assert.strictEqual(response.status, 200);
}

test('startLogin: completes the PKCE flow and stores tokens outside SQLite', async (t) => {
	const { databaseService, fetchStub, secretStore, service } =
		createServiceFixture(t);

	const result = await service.startLogin();

	assert.strictEqual(result.status, 'connected');
	assert.ok(result.status === 'connected');
	assert.strictEqual(result.account.state, 'connected');
	assert.strictEqual(result.account.userName, 'Alice');
	assert.strictEqual(result.account.organizationName, 'Example Org');

	const accessToken = await secretStore.read({
		key: `linear-access-token:${result.account.id}`,
		scope: 'app',
	});
	const refreshToken = await secretStore.read({
		key: `linear-refresh-token:${result.account.id}`,
		scope: 'app',
	});
	assert.strictEqual(accessToken, 'access-1');
	assert.strictEqual(refreshToken, 'refresh-1');

	const tokenCall = fetchStub.calls.find((call) =>
		call.url.includes('/oauth/token'),
	);
	assert.ok(tokenCall?.body);
	const tokenBody = new URLSearchParams(tokenCall.body);
	assert.strictEqual(tokenBody.get('grant_type'), 'authorization_code');
	assert.strictEqual(tokenBody.get('client_id'), CLIENT_ID);
	assert.ok(tokenBody.get('code_verifier'));

	const database = databaseService.getConnection()?.database;
	assert.ok(database);
	const rows = database.prepare('SELECT * FROM linear_accounts').all() as Array<
		Record<string, unknown>
	>;
	assert.strictEqual(rows.length, 1);
	const serialized = JSON.stringify(rows[0]);
	assert.ok(!serialized.includes('access-1'));
	assert.ok(!serialized.includes('refresh-1'));
});

test('startLogin: rejects a callback whose state does not match', async (t) => {
	const { secretStore, service } = createServiceFixture(t, {
		openExternal: (url) =>
			approveLoginInBrowser(url, { state: 'forged-state' }),
	});

	const result = await service.startLogin();

	assert.strictEqual(result.status, 'error');
	assert.ok(result.status === 'error');
	assert.strictEqual(result.failure.code, 'state-mismatch');
	assert.deepStrictEqual(await service.listAccounts(), []);
	assert.deepStrictEqual(await secretStore.listMetadata({ scope: 'app' }), []);
});

test('startLogin: fails with not-configured when neither config nor built-in id is set', async (t) => {
	const { service } = createServiceFixture(t, {
		app: {},
		builtInClientId: '',
	});

	const result = await service.startLogin();

	assert.ok(result.status === 'error');
	assert.strictEqual(result.failure.code, 'not-configured');
});

test('startLogin: falls back to the built-in client id without config', async (t) => {
	const fetchStub = createFetchStub();
	const { service } = createServiceFixture(t, {
		app: {},
		builtInClientId: 'built-in-client',
		fetchStub,
	});

	const result = await service.startLogin();

	assert.ok(result.status === 'connected');
	const tokenCall = fetchStub.calls.find((call) =>
		call.url.includes('/oauth/token'),
	);
	assert.ok(tokenCall?.body);
	assert.strictEqual(
		new URLSearchParams(tokenCall.body).get('client_id'),
		'built-in-client',
	);
});

test('startLogin: config clientId overrides the built-in client id', async (t) => {
	const fetchStub = createFetchStub();
	const { service } = createServiceFixture(t, {
		builtInClientId: 'built-in-client',
		fetchStub,
	});

	const result = await service.startLogin();

	assert.ok(result.status === 'connected');
	const tokenCall = fetchStub.calls.find((call) =>
		call.url.includes('/oauth/token'),
	);
	assert.ok(tokenCall?.body);
	assert.strictEqual(
		new URLSearchParams(tokenCall.body).get('client_id'),
		CLIENT_ID,
	);
});

test('startLogin: times out when no callback ever arrives', async (t) => {
	const { service } = createServiceFixture(t, {
		callbackTimeoutMs: 50,
		openExternal: async () => {},
	});

	const result = await service.startLogin();

	assert.ok(result.status === 'error');
	assert.strictEqual(result.failure.code, 'callback-timeout');
});

test('cancelLogin: aborts a pending login attempt', async (t) => {
	const { service } = createServiceFixture(t, {
		openExternal: async () => {},
	});

	const loginPromise = service.startLogin();
	await new Promise((resolve) => setTimeout(resolve, 25));
	await service.cancelLogin();

	const result = await loginPromise;
	assert.ok(result.status === 'error');
	assert.strictEqual(result.failure.code, 'login-canceled');
});

test('startLogin: surfaces token-exchange failures', async (t) => {
	const { service } = createServiceFixture(t, {
		fetchStub: createFetchStub({ failToken: true }),
	});

	const result = await service.startLogin();

	assert.ok(result.status === 'error');
	assert.strictEqual(result.failure.code, 'exchange-failed');
});

test('getConnectionSummary: reports not-configured, disconnected, and connected', async (t) => {
	const unconfigured = createServiceFixture(t, {
		app: {},
		builtInClientId: '',
	});
	assert.strictEqual(
		(await unconfigured.service.getConnectionSummary()).state,
		'not-configured',
	);

	const { service } = createServiceFixture(t);
	const empty = await service.getConnectionSummary();
	assert.strictEqual(empty.state, 'disconnected');
	assert.deepStrictEqual(empty.accounts, []);

	await service.startLogin();
	const connected = await service.getConnectionSummary();
	assert.strictEqual(connected.state, 'connected');
	assert.strictEqual(connected.accounts.length, 1);
	assert.deepStrictEqual(connected.accounts[0]?.scopes, ['read', 'write']);
});

test('getAccessToken: returns the stored token while it is fresh', async (t) => {
	const { service } = createServiceFixture(t);
	const login = await service.startLogin();
	assert.ok(login.status === 'connected');

	assert.strictEqual(
		await service.getAccessToken(login.account.id),
		'access-1',
	);
});

test('getAccessToken: refreshes an expired token through the refresh grant', async (t) => {
	// expires_in 30s sits inside the 60s expiry skew, so the token is already stale.
	const fetchStub = createFetchStub({ expiresInSeconds: 30 });
	const { service } = createServiceFixture(t, { fetchStub });
	const login = await service.startLogin();
	assert.ok(login.status === 'connected');

	const token = await service.getAccessToken(login.account.id);

	assert.strictEqual(token, 'access-2');
	const refreshCall = fetchStub.calls.find((call) =>
		String(call.body).includes('grant_type=refresh_token'),
	);
	assert.ok(refreshCall);
});

test('getAccessToken: throws not-connected without a stored token', async (t) => {
	const { service } = createServiceFixture(t);

	await assert.rejects(service.getAccessToken('missing'), (error: unknown) => {
		assert.ok(error instanceof LinearAuthError);
		assert.strictEqual(error.code, 'not-connected');
		return true;
	});
});

test('getAccessToken: surfaces refresh failures as typed errors', async (t) => {
	const fetchStub = createFetchStub({
		expiresInSeconds: 30,
		failRefresh: true,
	});
	const { service } = createServiceFixture(t, { fetchStub });
	const login = await service.startLogin();
	assert.ok(login.status === 'connected');

	await assert.rejects(
		service.getAccessToken(login.account.id),
		(error: unknown) => {
			assert.ok(error instanceof LinearAuthError);
			assert.strictEqual(error.code, 'refresh-failed');
			return true;
		},
	);
});

test('disconnect: revokes, clears secrets, and removes the account row', async (t) => {
	const { databaseService, fetchStub, secretStore, service } =
		createServiceFixture(t);
	const login = await service.startLogin();
	assert.ok(login.status === 'connected');
	const accountId = login.account.id;

	const result = await service.disconnect(accountId);

	assert.ok(result.status === 'disconnected');
	assert.strictEqual(result.summary.state, 'disconnected');
	assert.deepStrictEqual(result.summary.accounts, []);
	assert.strictEqual(
		await secretStore.read({
			key: `linear-access-token:${accountId}`,
			scope: 'app',
		}),
		null,
	);
	assert.strictEqual(
		await secretStore.read({
			key: `linear-refresh-token:${accountId}`,
			scope: 'app',
		}),
		null,
	);
	const revokeCalls = fetchStub.calls.filter((call) =>
		call.url.includes('/oauth/revoke'),
	);
	assert.strictEqual(revokeCalls.length, 2);
	const refreshRevoke = new URLSearchParams(revokeCalls[0]?.body ?? '');
	assert.strictEqual(refreshRevoke.get('token'), 'refresh-1');
	assert.strictEqual(refreshRevoke.get('token_type_hint'), 'refresh_token');
	const accessRevoke = new URLSearchParams(revokeCalls[1]?.body ?? '');
	assert.strictEqual(accessRevoke.get('token'), 'access-1');
	assert.strictEqual(accessRevoke.get('token_type_hint'), 'access_token');

	const database = databaseService.getConnection()?.database;
	assert.ok(database);
	const rows = database.prepare('SELECT id FROM linear_accounts').all();
	assert.strictEqual(rows.length, 0);
	assert.strictEqual(
		(await service.getConnectionSummary()).state,
		'disconnected',
	);
});

test('startLogin: includes a stored client secret in the token exchange', async (t) => {
	const secretStore = createMockSecretStore({ now: () => NOW });
	await secretStore.create({
		key: 'linear-client-secret',
		scope: 'app',
		value: 'shhh-secret',
	});
	const fetchStub = createFetchStub();
	const { service } = createServiceFixture(t, { fetchStub, secretStore });

	const result = await service.startLogin();

	assert.ok(result.status === 'connected');
	const tokenCall = fetchStub.calls.find((call) =>
		call.url.includes('/oauth/token'),
	);
	assert.ok(tokenCall?.body);
	assert.strictEqual(
		new URLSearchParams(tokenCall.body).get('client_secret'),
		'shhh-secret',
	);
});

test('startLogin: keeps two organizations as separate accounts', async (t) => {
	const first = createFetchStub();
	const { databaseService, secretStore, service } = createServiceFixture(t, {
		fetchStub: first,
	});
	const acme = await service.startLogin();
	assert.ok(acme.status === 'connected');

	// The same service, signed in again against a different organization: the
	// fixture's own fetch stub is swapped by rebuilding the service over the same
	// database and secret store, which is what two connected accounts look like.
	const second = createFetchStub({
		organizationId: 'org-2',
		organizationName: 'Client Co',
		userId: 'viewer-2',
	});
	const clientService = createLinearAuthService({
		callbackPorts: [0],
		configService: createConfigService({ linear: { clientId: CLIENT_ID } }),
		databaseService,
		fetchImpl: second.fetchImpl,
		now: () => NOW,
		openExternal: (url) => approveLoginInBrowser(url),
		secretStoreFactory: () => secretStore,
	});
	const client = await clientService.startLogin();
	assert.ok(client.status === 'connected');

	assert.notStrictEqual(acme.account.id, client.account.id);
	const summary = await clientService.getConnectionSummary();
	assert.strictEqual(summary.accounts.length, 2);
	assert.deepStrictEqual(
		summary.accounts.map((account) => account.organizationName).sort(),
		['Client Co', 'Example Org'],
	);
});

test('startLogin: signing in again as the same identity refreshes one account', async (t) => {
	const { service } = createServiceFixture(t);
	const first = await service.startLogin();
	const second = await service.startLogin();

	assert.ok(first.status === 'connected' && second.status === 'connected');
	assert.strictEqual(first.account.id, second.account.id);
	assert.strictEqual((await service.listAccounts()).length, 1);
});

test('disconnect: leaves the other account connected', async (t) => {
	const { databaseService, secretStore, service } = createServiceFixture(t);
	const acme = await service.startLogin();
	assert.ok(acme.status === 'connected');

	const second = createFetchStub({
		organizationId: 'org-2',
		organizationName: 'Client Co',
		userId: 'viewer-2',
	});
	const clientService = createLinearAuthService({
		callbackPorts: [0],
		configService: createConfigService({ linear: { clientId: CLIENT_ID } }),
		databaseService,
		fetchImpl: second.fetchImpl,
		now: () => NOW,
		openExternal: (url) => approveLoginInBrowser(url),
		secretStoreFactory: () => secretStore,
	});
	const client = await clientService.startLogin();
	assert.ok(client.status === 'connected');

	const result = await clientService.disconnect(acme.account.id);

	assert.ok(result.status === 'disconnected');
	assert.strictEqual(result.summary.state, 'connected');
	assert.deepStrictEqual(
		result.summary.accounts.map((account) => account.id),
		[client.account.id],
	);
	assert.strictEqual(
		await secretStore.read({
			key: `linear-access-token:${client.account.id}`,
			scope: 'app',
		}),
		'access-1',
	);
});

// A user connected before ADR 0052 must not be signed out by the upgrade: the
// tokens are still valid, they just live under the old, unsuffixed keys.
test('adoption: takes the pre-0052 single connection as the first account', async (t) => {
	const secretStore = createMockSecretStore({ now: () => NOW });
	await secretStore.create({
		key: 'linear-access-token',
		scope: 'app',
		value: 'legacy-access',
	});
	await secretStore.create({
		key: 'linear-refresh-token',
		scope: 'app',
		value: 'legacy-refresh',
	});
	const { databaseService, service } = createServiceFixture(t, { secretStore });
	const database = databaseService.getConnection()?.database;
	assert.ok(database);
	database
		.prepare(
			`INSERT INTO integration_metadata
				(id, provider, resource_type, resource_id, external_id, synced_at, metadata_json)
			 VALUES ('legacy', 'linear', 'connection', 'default', '', ?, ?)`,
		)
		.run(
			NOW.toISOString(),
			JSON.stringify({
				expiresAt: null,
				hasRefreshToken: true,
				organizationName: 'Example Org',
				organizationUrlKey: 'example-org',
				scopes: ['read', 'write'],
				userEmail: 'alice@example.com',
				userName: 'Alice',
			}),
		);

	const accounts = await service.listAccounts();

	assert.strictEqual(accounts.length, 1);
	const adopted = accounts[0];
	assert.ok(adopted);
	assert.strictEqual(adopted.organizationName, 'Example Org');
	assert.strictEqual(adopted.state, 'connected');
	assert.strictEqual(await service.getAccessToken(adopted.id), 'legacy-access');
	assert.strictEqual(
		await secretStore.read({ key: 'linear-access-token', scope: 'app' }),
		null,
	);
	const legacyRows = database
		.prepare(
			`SELECT id FROM integration_metadata
			 WHERE provider = 'linear' AND resource_type = 'connection'`,
		)
		.all();
	assert.strictEqual(legacyRows.length, 0);
});

test('adoption: does nothing when there was never a legacy connection', async (t) => {
	const { service } = createServiceFixture(t);

	assert.deepStrictEqual(await service.listAccounts(), []);
});

/**
 * A fetch stub whose token endpoint works but whose GraphQL endpoint is
 * unreachable, so adoption resolves tokens and fails to resolve an identity.
 * That is the offline-adoption path ADR 0052 keeps the user connected through.
 * @returns The stub, shaped like {@link createFetchStub}
 */
function createOfflineGraphqlFetchStub(): ReturnType<typeof createFetchStub> {
	const base = createFetchStub();
	const fetchImpl = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		if (String(input).includes('/graphql')) {
			throw new TypeError('fetch failed');
		}

		return base.fetchImpl(input, init);
	}) as typeof fetch;

	return { calls: base.calls, fetchImpl };
}

/**
 * A secret store whose reads throw, standing in for a Keychain the user has
 * locked or denied. Distinct from an empty store: nothing may be deleted on the
 * strength of a read that never happened.
 */
function createUnreadableSecretStore(): SecretStore {
	return {
		create: async () => undefined,
		delete: async () => undefined,
		list: async () => [],
		read: async () => {
			throw new Error('The user denied Keychain access.');
		},
		update: async () => undefined,
	} as unknown as SecretStore;
}

/** Writes the pre-0052 connection row the adoption pass reads. */
function seedLegacyConnectionRow(
	database: DatabaseSync,
	metadata: Record<string, unknown>,
): void {
	database
		.prepare(
			`INSERT INTO integration_metadata
				(id, provider, resource_type, resource_id, external_id, synced_at, metadata_json)
			 VALUES ('legacy', 'linear', 'connection', 'default', '', ?, ?)`,
		)
		.run(NOW.toISOString(), JSON.stringify(metadata));
}

/** Counts the surviving pre-0052 connection rows. */
function countLegacyRows(database: DatabaseSync): number {
	return database
		.prepare(
			`SELECT id FROM integration_metadata
			 WHERE provider = 'linear' AND resource_type = 'connection'`,
		)
		.all().length;
}

// A locked Keychain reads as an absent connection. Deleting the identity row on
// that basis strands the tokens — they stay in the Keychain with nothing left
// that will ever remove them — and leaves an account nothing can identify.
test('adoption: keeps the legacy row when the Keychain cannot be read', async (t) => {
	const { databaseService, service } = createServiceFixture(t, {
		secretStore: createUnreadableSecretStore(),
	});
	const database = databaseService.getConnection()?.database;
	assert.ok(database);
	seedLegacyConnectionRow(database, {
		organizationName: 'Example Org',
		organizationUrlKey: 'example-org',
		scopes: ['read'],
	});

	assert.deepStrictEqual(await service.listAccounts(), []);
	assert.strictEqual(countLegacyRows(database), 1);
});

test('adoption: drops the legacy row when the Keychain answers and holds nothing', async (t) => {
	const { databaseService, service } = createServiceFixture(t);
	const database = databaseService.getConnection()?.database;
	assert.ok(database);
	seedLegacyConnectionRow(database, { organizationName: 'Example Org' });

	assert.deepStrictEqual(await service.listAccounts(), []);
	assert.strictEqual(countLegacyRows(database), 0);
});

// Adoption can run with no network. The account is kept under a sentinel so the
// user stays connected, and the next login for that same organization replaces
// it rather than adding a duplicate.
test('adoption: offline keeps the connection under a sentinel identity', async (t) => {
	const secretStore = createMockSecretStore({ now: () => NOW });
	await secretStore.create({
		key: 'linear-access-token',
		scope: 'app',
		value: 'legacy-access',
	});
	const { databaseService, service } = createServiceFixture(t, {
		fetchStub: createOfflineGraphqlFetchStub(),
		secretStore,
	});
	const database = databaseService.getConnection()?.database;
	assert.ok(database);
	seedLegacyConnectionRow(database, {
		organizationName: 'Example Org',
		organizationUrlKey: 'example-org',
		scopes: ['read'],
	});

	const accounts = await service.listAccounts();

	assert.strictEqual(accounts.length, 1);
	assert.strictEqual(accounts[0]?.organizationId, 'legacy:organization');
	assert.strictEqual(accounts[0]?.organizationUrlKey, 'example-org');
});

// The sentinel is replaced only on a positive url-key match. Deleting it because
// "it is unidentified and so is any organization" would take an unrelated
// account's row, its Keychain entries, and — through the cascade — its cache.
test('adoption: a login to a different organization leaves the sentinel alone', async (t) => {
	const secretStore = createMockSecretStore({ now: () => NOW });
	await secretStore.create({
		key: 'linear-access-token',
		scope: 'app',
		value: 'legacy-access',
	});
	const { databaseService, service } = createServiceFixture(t, {
		fetchStub: createOfflineGraphqlFetchStub(),
		secretStore,
	});
	const database = databaseService.getConnection()?.database;
	assert.ok(database);
	seedLegacyConnectionRow(database, {});

	const adopted = await service.listAccounts();
	assert.strictEqual(adopted.length, 1);
	assert.strictEqual(adopted[0]?.organizationUrlKey, null);

	database
		.prepare(
			`INSERT INTO linear_accounts (id, organization_id, organization_name, organization_url_key, user_id)
			 VALUES ('other', 'org-other', 'Client Co', 'client-co', 'viewer-other')`,
		)
		.run();

	const after = await service.listAccounts();

	assert.strictEqual(after.length, 2);
});
