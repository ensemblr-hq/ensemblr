import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	ENSEMBLE_CONFIG_SCHEMA_VERSION,
	type EnsembleConfig,
	type EnsembleConfigService,
} from '../../src/main/config/config-loader.ts';
import {
	createLinearAuthService,
	LinearAuthError,
} from '../../src/main/linear/linear-auth-service.ts';
import { createMockSecretStore } from '../../src/main/secrets/mock-backend.ts';
import type { SecretStore } from '../../src/main/secrets/secret-store-types.ts';
import {
	type EnsembleDatabaseService,
	openEnsembleDatabase,
} from '../../src/main/storage/database.ts';

const NOW = new Date('2026-06-11T00:00:00.000Z');
const CLIENT_ID = 'linear-client-1';

function createConfigService(
	app: Record<string, unknown>,
): EnsembleConfigService {
	const config: EnsembleConfig = {
		app,
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
	};
	const snapshot = {
		blocksReadiness: false,
		diagnostics: [],
		displayPath: '~/.config/ensemble/config.json',
		loadedAt: NOW.toISOString(),
		path: '/Users/alice/.config/ensemble/config.json',
		schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
		status: 'ok',
	} as const;

	return {
		getConfig: () => config,
		getSnapshot: () => snapshot,
		load: () => snapshot,
	};
}

function createDatabaseServiceFixture(t: TestContext): EnsembleDatabaseService {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-linear-auth-'));
	const connection = openEnsembleDatabase({
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
}: {
	expiresInSeconds?: number;
	failRefresh?: boolean;
	failToken?: boolean;
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
					organization: { name: 'Swiss Cheese', urlKey: 'swiss-cheese' },
					viewer: { email: 'alice@example.com', name: 'Alice' },
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
	assert.strictEqual(result.snapshot.state, 'connected');
	assert.strictEqual(result.snapshot.userName, 'Alice');
	assert.strictEqual(result.snapshot.organizationName, 'Swiss Cheese');

	const accessToken = await secretStore.read({
		key: 'linear-access-token',
		scope: 'app',
	});
	const refreshToken = await secretStore.read({
		key: 'linear-refresh-token',
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
	const rows = database
		.prepare(
			`SELECT metadata_json FROM integration_metadata WHERE provider = 'linear'`,
		)
		.all() as Array<{ metadata_json: string }>;
	assert.strictEqual(rows.length, 1);
	assert.ok(!rows[0]?.metadata_json.includes('access-1'));
	assert.ok(!rows[0]?.metadata_json.includes('refresh-1'));
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
	assert.strictEqual(
		await secretStore.read({ key: 'linear-access-token', scope: 'app' }),
		null,
	);
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

test('getConnectionStatus: reports not-configured, disconnected, and connected', async (t) => {
	const unconfigured = createServiceFixture(t, {
		app: {},
		builtInClientId: '',
	});
	assert.strictEqual(
		(await unconfigured.service.getConnectionStatus()).state,
		'not-configured',
	);

	const { service } = createServiceFixture(t);
	assert.strictEqual(
		(await service.getConnectionStatus()).state,
		'disconnected',
	);

	await service.startLogin();
	const connected = await service.getConnectionStatus();
	assert.strictEqual(connected.state, 'connected');
	assert.deepStrictEqual(connected.scopes, ['read', 'write']);
});

test('getAccessToken: returns the stored token while it is fresh', async (t) => {
	const { service } = createServiceFixture(t);
	await service.startLogin();

	assert.strictEqual(await service.getAccessToken(), 'access-1');
});

test('getAccessToken: refreshes an expired token through the refresh grant', async (t) => {
	// expires_in 30s sits inside the 60s expiry skew, so the token is already stale.
	const fetchStub = createFetchStub({ expiresInSeconds: 30 });
	const { service } = createServiceFixture(t, { fetchStub });
	await service.startLogin();

	const token = await service.getAccessToken();

	assert.strictEqual(token, 'access-2');
	const refreshCall = fetchStub.calls.find((call) =>
		String(call.body).includes('grant_type=refresh_token'),
	);
	assert.ok(refreshCall);
});

test('getAccessToken: throws not-connected without a stored token', async (t) => {
	const { service } = createServiceFixture(t);

	await assert.rejects(service.getAccessToken(), (error: unknown) => {
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
	await service.startLogin();

	await assert.rejects(service.getAccessToken(), (error: unknown) => {
		assert.ok(error instanceof LinearAuthError);
		assert.strictEqual(error.code, 'refresh-failed');
		return true;
	});
});

test('disconnect: revokes, clears secrets, and removes connection metadata', async (t) => {
	const { databaseService, fetchStub, secretStore, service } =
		createServiceFixture(t);
	await service.startLogin();

	const result = await service.disconnect();

	assert.ok(result.status === 'disconnected');
	assert.strictEqual(result.snapshot.state, 'disconnected');
	assert.strictEqual(
		await secretStore.read({ key: 'linear-access-token', scope: 'app' }),
		null,
	);
	assert.strictEqual(
		await secretStore.read({ key: 'linear-refresh-token', scope: 'app' }),
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
	const rows = database
		.prepare(`SELECT id FROM integration_metadata WHERE provider = 'linear'`)
		.all();
	assert.strictEqual(rows.length, 0);
	assert.strictEqual(
		(await service.getConnectionStatus()).state,
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
