import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import {
	ENSEMBLE_CONFIG_SCHEMA_VERSION,
	type EnsembleConfig,
	type EnsembleConfigService,
} from '../../src/main/config/config-loader.ts';
import {
	createEnvironmentVariablesService,
	EnvironmentVariablesError,
	isEnvironmentVariableKey,
} from '../../src/main/environment/environment-variables.ts';
import { createMockSecretStore } from '../../src/main/secrets/secret-store.ts';
import { openEnsembleDatabase } from '../../src/main/storage/database.ts';
import type {
	EnvironmentVariableSnapshot,
	EnvironmentVariablesSnapshot,
} from '../../src/shared/ipc.ts';

const NOW = new Date('2026-06-05T00:00:00.000Z');

function createConfigService(
	environment: Record<string, unknown> = {},
): EnsembleConfigService {
	const config: EnsembleConfig = {
		app: {},
		environment,
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
	};

	return {
		getConfig: () => config,
		getSnapshot: () => ({
			blocksReadiness: false,
			diagnostics: [],
			displayPath: '~/.config/ensemble/config.json',
			loadedAt: NOW.toISOString(),
			path: '/Users/alice/.config/ensemble/config.json',
			schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
			status: 'ok',
		}),
		load: () => ({
			blocksReadiness: false,
			diagnostics: [],
			displayPath: '~/.config/ensemble/config.json',
			loadedAt: NOW.toISOString(),
			path: '/Users/alice/.config/ensemble/config.json',
			schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
			status: 'ok',
		}),
	};
}

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-env-'));
	const connection = openEnsembleDatabase({
		databasePath: path.join(directory, 'ensemble-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	return connection.database;
}

function createService({
	database,
	environment,
	secretStore = createMockSecretStore({
		idFactory: () => 'secret-1',
		now: () => NOW,
	}),
}: {
	database?: DatabaseSync;
	environment?: Record<string, unknown>;
	secretStore?: ReturnType<typeof createMockSecretStore>;
} = {}) {
	return createEnvironmentVariablesService({
		configService: createConfigService(environment),
		database: database ?? null,
		now: () => NOW,
		secretStore,
	});
}

function getVariable(
	snapshot: EnvironmentVariablesSnapshot,
	key: string,
): EnvironmentVariableSnapshot {
	const variable = snapshot.variables.find(
		(candidate) => candidate.key === key,
	);

	if (!variable) {
		assert.fail(`Expected environment variable ${key}`);
	}

	return variable;
}

test('validates environment variable keys', () => {
	assert.equal(isEnvironmentVariableKey('OPENAI_API_KEY'), true);
	assert.equal(isEnvironmentVariableKey('_CUSTOM'), true);
	assert.equal(isEnvironmentVariableKey('1_BAD'), false);
	assert.equal(isEnvironmentVariableKey('BAD-NAME'), false);
});

test('catalog snapshot includes unset, secret, and reserved variables', async () => {
	const snapshot = await createService().getSnapshot();

	assert.equal(getVariable(snapshot, 'PI_CODING_AGENT_DIR').status, 'unset');
	assert.equal(getVariable(snapshot, 'OPENAI_API_KEY').valueKind, 'secret');
	assert.equal(getVariable(snapshot, 'OPENAI_API_KEY').status, 'unset');
	assert.deepEqual(
		{
			source: getVariable(snapshot, 'ENSEMBLE_PORT').source,
			status: getVariable(snapshot, 'ENSEMBLE_PORT').status,
			valueKind: getVariable(snapshot, 'ENSEMBLE_PORT').valueKind,
		},
		{
			source: 'runtime',
			status: 'reserved',
			valueKind: 'runtime',
		},
	);
});

test('uses non-secret config defaults and rejects secret config values', async () => {
	const snapshot = await createService({
		environment: {
			DEBUG: 'ensemble:*',
			OPENAI_API_KEY: 'sk-raw-config-secret',
		},
	}).getSnapshot();

	assert.deepEqual(
		{
			displayValue: getVariable(snapshot, 'DEBUG').displayValue,
			source: getVariable(snapshot, 'DEBUG').source,
			status: getVariable(snapshot, 'DEBUG').status,
		},
		{
			displayValue: 'ensemble:*',
			source: 'config-default',
			status: 'set',
		},
	);
	assert.equal(getVariable(snapshot, 'OPENAI_API_KEY').status, 'invalid');
	assert.equal(
		snapshot.diagnostics.some(
			(diagnostic) =>
				diagnostic.code === 'secret-config-variable-ignored' &&
				diagnostic.key === 'OPENAI_API_KEY',
		),
		true,
	);
});

test('stores and assembles non-secret sqlite values', async (t) => {
	const database = createDatabaseFixture(t);
	const service = createService({ database });

	const stored = await service.setPlainValue({
		key: 'DEBUG',
		value: 'ensemble:setup',
	});
	const snapshot = await service.getSnapshot();
	const assembly = await service.assembleEnvironment();
	const rows = database.prepare('SELECT key, value_json FROM settings').all();

	assert.equal(stored.status, 'set');
	assert.equal(getVariable(snapshot, 'DEBUG').source, 'sqlite');
	assert.equal(getVariable(snapshot, 'DEBUG').displayValue, 'ensemble:setup');
	assert.deepEqual(assembly.env, { DEBUG: 'ensemble:setup' });
	assert.deepEqual(assembly.redactValues, []);
	assert.equal(JSON.stringify(rows).includes('ensemble:setup'), true);
});

test('stores secret values through secret metadata without exposing raw values in snapshots or sqlite', async (t) => {
	const database = createDatabaseFixture(t);
	const secretStore = createMockSecretStore({
		idFactory: () => 'secret-env-1',
		now: () => NOW,
	});
	const service = createService({ database, secretStore });
	const rawSecret = 'sk-env-secret-123456';

	const stored = await service.setSecretValue({
		key: 'OPENAI_API_KEY',
		value: rawSecret,
	});
	const snapshot = await service.getSnapshot();
	const variable = getVariable(snapshot, 'OPENAI_API_KEY');
	const assembly = await service.assembleEnvironment();
	const sqliteRows = [
		...database.prepare('SELECT * FROM settings').all(),
		...database.prepare('SELECT * FROM secret_metadata').all(),
	];

	assert.equal(stored.maskedDisplay, '****3456');
	assert.equal(variable.status, 'masked');
	assert.equal(variable.maskedDisplay, '****3456');
	assert.equal(JSON.stringify(snapshot).includes(rawSecret), false);
	assert.deepEqual(assembly.env, { OPENAI_API_KEY: rawSecret });
	assert.deepEqual(assembly.redactValues, [rawSecret]);
	assert.equal(JSON.stringify(sqliteRows).includes(rawSecret), false);
});

test('keeps plain and secret storage mutually exclusive when value kind changes', async (t) => {
	const database = createDatabaseFixture(t);
	const secretStore = createMockSecretStore({
		idFactory: () => 'secret-env-1',
		now: () => NOW,
	});
	const service = createService({ database, secretStore });

	await service.setPlainValue({
		key: 'DEBUG',
		value: 'ensemble:plain',
	});
	await service.setSecretValue({
		key: 'DEBUG',
		value: 'ensemble-secret',
	});

	assert.deepEqual((await service.assembleEnvironment()).env, {
		DEBUG: 'ensemble-secret',
	});
	assert.deepEqual(
		(await service.assembleEnvironment({ includeSecrets: false })).env,
		{},
	);

	await service.setPlainValue({
		key: 'DEBUG',
		value: 'ensemble:plain-again',
	});

	const snapshot = await service.getSnapshot();

	assert.deepEqual((await service.assembleEnvironment()).env, {
		DEBUG: 'ensemble:plain-again',
	});
	assert.equal(getVariable(snapshot, 'DEBUG').status, 'set');
	assert.equal(getVariable(snapshot, 'DEBUG').source, 'sqlite');
});

test('reports missing required variables without printing values', async () => {
	const snapshot = await createService().getSnapshot({
		requiredKeys: ['ENSEMBLE_REQUIRED_TOKEN'],
	});
	const variable = getVariable(snapshot, 'ENSEMBLE_REQUIRED_TOKEN');

	assert.equal(snapshot.requiredCount, 1);
	assert.equal(snapshot.missingRequiredCount, 1);
	assert.equal(variable.required, true);
	assert.equal(variable.status, 'unset');
	assert.equal(
		snapshot.diagnostics.some(
			(diagnostic) =>
				diagnostic.code === 'required-variable-missing' &&
				diagnostic.key === 'ENSEMBLE_REQUIRED_TOKEN',
		),
		true,
	);
});

test('rejects invalid, reserved, and secret-classified plain writes', async (t) => {
	const database = createDatabaseFixture(t);
	const service = createService({ database });

	await assert.rejects(
		service.setPlainValue({ key: 'BAD-NAME', value: 'x' }),
		(error) =>
			error instanceof EnvironmentVariablesError &&
			error.code === 'invalid-key',
	);
	await assert.rejects(
		service.setPlainValue({ key: 'ENSEMBLE_PORT', value: '5173' }),
		(error) =>
			error instanceof EnvironmentVariablesError &&
			error.code === 'reserved-key',
	);
	await assert.rejects(
		service.setPlainValue({ key: 'OPENAI_API_KEY', value: 'sk-test' }),
		(error) =>
			error instanceof EnvironmentVariablesError &&
			error.code === 'secret-value-required',
	);
});
