import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	createMacosKeychainSecretStore,
	createMockSecretStore,
	maskSecret,
	SecretStoreError,
} from '../../src/main/secrets/secret-store.ts';
import { openEnsembleDatabase } from '../../src/main/storage/database.ts';

function createTestDatabasePath(): {
	cleanup: () => void;
	databasePath: string;
} {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-secrets-'));

	return {
		cleanup: () => rmSync(directory, { force: true, recursive: true }),
		databasePath: path.join(directory, 'ensemble-test.db'),
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
		key: 'ENSEMBLE_SECRET',
		scope: 'app',
		value: 'first-secret',
	});

	await assert.rejects(
		() =>
			store.create({
				key: 'ENSEMBLE_SECRET',
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
		process.env.ENSEMBLE_RUN_KEYCHAIN_SMOKE !== '1'
			? 'Set ENSEMBLE_RUN_KEYCHAIN_SMOKE=1 on macOS to run this Keychain smoke test.'
			: false,
}, async (t) => {
	const fixture = createTestDatabasePath();
	const connection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	const serviceName = `com.ensemble.app.test.${randomUUID()}`;
	const key = `ENSEMBLE_SMOKE_${randomUUID()}`;
	const value = `ensemble-smoke-${randomUUID()}`;
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
		displayName: 'Ensemble smoke test secret',
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
