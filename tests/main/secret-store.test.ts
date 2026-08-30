import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	createMacosKeychainSecretStore,
	createMockSecretStore,
	createSafeStorageSecretStore,
	maskSecret,
	SecretStoreError,
} from '../../src/main/secrets/index.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';

function createTestDatabasePath(): {
	cleanup: () => void;
	databasePath: string;
} {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-secrets-'));

	return {
		cleanup: () => rmSync(directory, { force: true, recursive: true }),
		databasePath: path.join(directory, 'ensemblr-test.db'),
	};
}

function createFixedClock() {
	return {
		idFactory: () => 'secret-1',
		now: () => new Date('2026-06-04T12:00:00.000Z'),
	};
}

test('masks secret values without exposing full raw values', () => {
	assert.equal(maskSecret(''), '****');
	assert.equal(maskSecret('abc'), '****');
	assert.equal(maskSecret('abcdef'), '****cdef');
});

test('mock store creates, reads, lists, updates, and deletes secrets', async () => {
	const store = createMockSecretStore(createFixedClock());

	const metadata = await store.create({
		displayName: 'Linear access token',
		key: 'LINEAR_ACCESS_TOKEN',
		metadata: { provider: 'linear' },
		scope: 'app',
		value: 'lin-test-token-123456',
	});

	assert.equal(metadata.id, 'secret-1');
	assert.equal(metadata.scope, 'app');
	assert.equal(metadata.scopeId, '');
	assert.equal(metadata.key, 'LINEAR_ACCESS_TOKEN');
	assert.equal(metadata.backend, 'mock');
	assert.equal(metadata.characterCount, 'lin-test-token-123456'.length);
	assert.equal(metadata.maskedDisplay, '****3456');
	assert.equal(metadata.createdAt, '2026-06-04T12:00:00.000Z');
	assert.equal(metadata.updatedAt, '2026-06-04T12:00:00.000Z');
	assert.deepEqual(metadata.metadata, { provider: 'linear' });
	assert.equal(
		JSON.stringify(metadata).includes('lin-test-token-123456'),
		false,
	);
	assert.equal(
		await store.read({ key: 'LINEAR_ACCESS_TOKEN', scope: 'app' }),
		'lin-test-token-123456',
	);
	assert.deepEqual(await store.listMetadata({ scope: 'app' }), [metadata]);

	const updated = await store.update({
		displayName: 'Linear access token',
		key: 'LINEAR_ACCESS_TOKEN',
		metadata: { provider: 'linear', rotated: true },
		scope: 'app',
		value: 'lin-rotated-token-987654',
	});

	assert.equal(updated.id, metadata.id);
	assert.equal(updated.createdAt, metadata.createdAt);
	assert.equal(updated.maskedDisplay, '****7654');
	assert.deepEqual(updated.metadata, { provider: 'linear', rotated: true });
	assert.equal(
		await store.read({ key: 'LINEAR_ACCESS_TOKEN', scope: 'app' }),
		'lin-rotated-token-987654',
	);

	await store.delete({ key: 'LINEAR_ACCESS_TOKEN', scope: 'app' });
	await store.delete({ key: 'LINEAR_ACCESS_TOKEN', scope: 'app' });

	assert.equal(
		await store.read({ key: 'LINEAR_ACCESS_TOKEN', scope: 'app' }),
		null,
	);
	assert.deepEqual(await store.listMetadata(), []);
});

test('mock store filters metadata by scope and scope id', async () => {
	const store = createMockSecretStore();

	await store.create({
		key: 'GLOBAL_SECRET',
		scope: 'app',
		value: 'global-secret',
	});
	await store.create({
		key: 'REPO_SECRET',
		scope: 'repository',
		scopeId: 'repo-1',
		value: 'repo-secret',
	});
	await store.create({
		key: 'WORKSPACE_SECRET',
		scope: 'workspace',
		scopeId: 'workspace-1',
		value: 'workspace-secret',
	});

	assert.deepEqual(
		(await store.listMetadata({ scope: 'repository', scopeId: 'repo-1' })).map(
			(metadata) => metadata.key,
		),
		['REPO_SECRET'],
	);
	assert.deepEqual(
		(await store.listMetadata({ scope: 'workspace' })).map(
			(metadata) => metadata.key,
		),
		['WORKSPACE_SECRET'],
	);
});

test('mock store reports duplicate, missing, and invalid operations with typed errors', async () => {
	const store = createMockSecretStore();

	await store.create({
		key: 'ENSEMBLR_SECRET',
		scope: 'app',
		value: 'first-secret',
	});

	await assert.rejects(
		() =>
			store.create({
				key: 'ENSEMBLR_SECRET',
				scope: 'app',
				value: 'second-secret',
			}),
		(error) =>
			error instanceof SecretStoreError && error.code === 'already-exists',
	);
	await assert.rejects(
		() =>
			store.update({
				key: 'MISSING_SECRET',
				scope: 'app',
				value: 'missing-secret',
			}),
		(error) => error instanceof SecretStoreError && error.code === 'not-found',
	);
	await assert.rejects(
		() =>
			store.create({
				key: 'REPO_SECRET',
				scope: 'repository',
				value: 'repo-secret',
			}),
		(error) =>
			error instanceof SecretStoreError && error.code === 'invalid-input',
	);
});

test('macOS keychain smoke stores values outside SQLite when explicitly enabled', {
	skip:
		process.platform !== 'darwin' ||
		process.env.ENSEMBLR_RUN_KEYCHAIN_SMOKE !== '1'
			? 'Set ENSEMBLR_RUN_KEYCHAIN_SMOKE=1 on macOS to run this Keychain smoke test.'
			: false,
}, async (t) => {
	const fixture = createTestDatabasePath();
	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	const serviceName = `dev.ensemblr.app.test.${randomUUID()}`;
	const key = `ENSEMBLR_SMOKE_${randomUUID()}`;
	const value = `ensemblr-smoke-${randomUUID()}`;
	const store = createMacosKeychainSecretStore({
		database: connection.database,
		serviceName,
	});

	t.after(async () => {
		await store.delete({ key, scope: 'app' });
		connection.database.close();
		fixture.cleanup();
	});

	const metadata = await store.create({
		displayName: 'Ensemblr smoke test secret',
		key,
		scope: 'app',
		value,
	});

	assert.equal(metadata.service, serviceName);
	assert.equal(await store.read({ key, scope: 'app' }), value);

	const rows = connection.database
		.prepare('SELECT * FROM secret_metadata')
		.all();

	assert.equal(JSON.stringify(rows).includes(value), false);

	await store.delete({ key, scope: 'app' });
	assert.equal(await store.read({ key, scope: 'app' }), null);
});

/**
 * A stand-in for Electron's `safeStorage`. The real one is unreachable outside
 * an Electron process, which is why the backend takes this as an option — with
 * a reversible transform standing in for the keyring so a round-trip is
 * observable, and switches for each failure the Linux path has to survive.
 */
function createFakeSafeStorage(
	overrides: {
		available?: boolean;
		backend?: 'basic_text' | 'gnome_libsecret' | 'kwallet6';
		failDecrypt?: boolean;
		failEncrypt?: boolean;
	} = {},
) {
	const {
		available = true,
		backend = 'kwallet6',
		failDecrypt = false,
		failEncrypt = false,
	} = overrides;

	return {
		decryptString: (buffer: Buffer) => {
			if (failDecrypt) {
				throw new Error('keyring refused to decrypt');
			}
			return Buffer.from(buffer).reverse().toString('utf8');
		},
		encryptString: (value: string) => {
			if (failEncrypt) {
				throw new Error('keyring refused to encrypt');
			}
			return Buffer.from(value, 'utf8').reverse();
		},
		getSelectedStorageBackend: () => backend,
		isEncryptionAvailable: () => available,
	};
}

function openSafeStorageFixture(
	t: { after: (fn: () => void) => void },
	safeStorage = createFakeSafeStorage(),
) {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	return {
		database: connection.database,
		store: createSafeStorageSecretStore({
			database: connection.database,
			...createFixedClock(),
			safeStorage,
		}),
	};
}

test('safe storage round-trips a value through the keyring', async (t) => {
	const { store } = openSafeStorageFixture(t);

	const metadata = await store.create({
		key: 'LINEAR_TOKEN',
		scope: 'app',
		value: 'lin_api_supersecret',
	});

	assert.equal(metadata.backend, 'safe-storage');
	assert.equal(metadata.maskedDisplay, maskSecret('lin_api_supersecret'));
	assert.equal(
		await store.read({ key: 'LINEAR_TOKEN', scope: 'app' }),
		'lin_api_supersecret',
	);
});

test('safe storage keeps the ciphertext out of the metadata row it returns', async (t) => {
	const { database, store } = openSafeStorageFixture(t);

	await store.create({ key: 'GH_TOKEN', scope: 'app', value: 'ghp_secret' });

	const row = database
		.prepare(
			"SELECT secret_value, secret_keyring_backend FROM secret_metadata WHERE name = 'GH_TOKEN'",
		)
		.get() as { secret_keyring_backend: string; secret_value: Uint8Array };

	assert.ok(row.secret_value instanceof Uint8Array);
	assert.notEqual(Buffer.from(row.secret_value).toString('utf8'), 'ghp_secret');
	assert.equal(row.secret_keyring_backend, 'unknown');
});

test('safe storage reads null for a lookup that was never stored', async (t) => {
	const { store } = openSafeStorageFixture(t);

	assert.equal(await store.read({ key: 'ABSENT', scope: 'app' }), null);
});

test('safe storage refuses when the session offers no keyring', async (t) => {
	const { store } = openSafeStorageFixture(
		t,
		createFakeSafeStorage({ available: false }),
	);

	await assert.rejects(
		store.create({ key: 'K', scope: 'app', value: 'v' }),
		(error: unknown) =>
			error instanceof SecretStoreError && error.code === 'encryption-error',
	);
});

test('safe storage surfaces an encrypt failure as a typed error', async (t) => {
	const { store } = openSafeStorageFixture(
		t,
		createFakeSafeStorage({ failEncrypt: true }),
	);

	await assert.rejects(
		store.create({ key: 'K', scope: 'app', value: 'v' }),
		(error: unknown) =>
			error instanceof SecretStoreError && error.code === 'encryption-error',
	);
});

test('safe storage surfaces a decrypt failure as a typed error', async (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	const stored = createSafeStorageSecretStore({
		database: connection.database,
		...createFixedClock(),
		safeStorage: createFakeSafeStorage(),
	});
	await stored.create({ key: 'K', scope: 'app', value: 'v' });

	const broken = createSafeStorageSecretStore({
		database: connection.database,
		...createFixedClock(),
		safeStorage: createFakeSafeStorage({ failDecrypt: true }),
	});

	await assert.rejects(
		broken.read({ key: 'K', scope: 'app' }),
		(error: unknown) =>
			error instanceof SecretStoreError && error.code === 'encryption-error',
	);
});

test('safe storage rejects a duplicate create and a missing update', async (t) => {
	const { store } = openSafeStorageFixture(t);

	await store.create({ key: 'K', scope: 'app', value: 'first' });

	await assert.rejects(
		store.create({ key: 'K', scope: 'app', value: 'second' }),
		(error: unknown) =>
			error instanceof SecretStoreError && error.code === 'already-exists',
	);
	await assert.rejects(
		store.update({ key: 'MISSING', scope: 'app', value: 'x' }),
		(error: unknown) =>
			error instanceof SecretStoreError && error.code === 'not-found',
	);
});

test('safe storage update persists the new value and the new display name', async (t) => {
	const { store } = openSafeStorageFixture(t);

	await store.create({
		displayName: 'Old name',
		key: 'K',
		scope: 'app',
		value: 'first',
	});
	const updated = await store.update({
		displayName: 'New name',
		key: 'K',
		metadata: { origin: 'settings' },
		scope: 'app',
		value: 'second',
	});

	assert.equal(updated.displayName, 'New name');
	assert.deepEqual(updated.metadata, { origin: 'settings' });
	assert.equal(await store.read({ key: 'K', scope: 'app' }), 'second');
});

test('safe storage delete removes the ciphertext with the row', async (t) => {
	const { database, store } = openSafeStorageFixture(t);

	await store.create({ key: 'K', scope: 'app', value: 'v' });
	await store.delete({ key: 'K', scope: 'app' });

	assert.equal(await store.read({ key: 'K', scope: 'app' }), null);
	assert.equal(
		(
			database
				.prepare('SELECT COUNT(*) AS total FROM secret_metadata')
				.get() as { total: number }
		).total,
		0,
	);
});

test('safe storage scopes its listing the same way the Keychain backend does', async (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	const store = createSafeStorageSecretStore({
		database: connection.database,
		idFactory: randomUUID,
		now: () => new Date('2026-06-04T12:00:00.000Z'),
		safeStorage: createFakeSafeStorage(),
	});

	await store.create({ key: 'A', scope: 'app', value: '1' });
	await store.create({
		key: 'B',
		scope: 'workspace',
		scopeId: 'ws-1',
		value: '2',
	});

	assert.deepEqual(
		(await store.listMetadata({ scope: 'workspace', scopeId: 'ws-1' })).map(
			(entry) => entry.key,
		),
		['B'],
	);
});
